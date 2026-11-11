import { ConflictException, Injectable, Logger } from '@nestjs/common';
import {
  MAX_STATEMENT_USER_AGENT_LENGTH,
  PAYOUT_STATEMENT_CHANGED,
  PAYOUT_STATEMENT_NOT_SENT,
  statementSignedPdfFilename,
  type AccessContext,
  type PayStatementStatus,
  type PayStatementView,
} from '@sfa/shared';
import { Types } from 'mongoose';
import { peopleModels } from '../common/payouts/generate-run';
import { sha256Hex } from '../common/payouts/pdf/hash';
import { renderStatementPdf } from '../common/payouts/pdf/render-statement-pdf';
import { buildStatementPdfModel } from '../common/payouts/pdf/statement-pdf-model';
import {
  activeAccountIds,
  statementAnswerNotification,
  statementReviewerIds,
} from '../common/payouts/statement-answered';
import { notificationRequested } from '../inngest/events';
import {
  deterministicEventId,
  InngestService,
} from '../inngest/inngest.service';
import { StorageService } from '../storage/storage.service';
import type {
  AcceptPayStatementDto,
  RejectPayStatementDto,
} from './dto/payouts.dto';
import { PayoutModelsService } from './payout-models.service';
import { statementView, type LeanStatement } from './payout-views';
import type { PayStatementAcceptance } from './schemas/pay-statement.schema';
import {
  PAY_STATEMENTS_PURPOSE,
  PDF_TYPE,
  StatementIssueService,
} from './statement-issue.service';
import { agencyOf, loadOwnSentStatement } from './statement-visibility';

/**
 * The employee's answer to a sent commission statement (PAC-182): accept it
 * — final, with a signed copy of the PDF — or dispute it, with notes, for a
 * reviewer to correct and send again as the next version.
 *
 * **Only the statement's own employee answers it** (`loadOwnSentStatement`:
 * 403 `PAYOUT_STATEMENT_NOT_YOURS` for anyone else who can see it, the admin
 * included), and only while it is `sent` (409 `PAYOUT_STATEMENT_NOT_SENT`).
 *
 * **Neither touches `version` or `history`.** A dispute keeps the issued
 * file and sender in place: sending it again builds the `superseded` history
 * row from them, and moves the dispute onto that row.
 *
 * Both writes are conditional on the statement as it was read (status,
 * version, last write), as a send is: a reviewer who reopened it meanwhile
 * wins, and the answer is a 409.
 */
@Injectable()
export class StatementSignoffService {
  private readonly logger = new Logger(StatementSignoffService.name);

  constructor(
    private readonly payoutModels: PayoutModelsService,
    private readonly storage: StorageService,
    private readonly inngest: InngestService,
    private readonly issuing: StatementIssueService,
  ) {}

  private get models() {
    return this.payoutModels.models;
  }

  /**
   * Accept a sent statement. The issued PDF is rendered again with the
   * acknowledgment filled — the box ticked, the typed name, the day, and an
   * audit line (account, browser, the issued file's SHA-256) — and stored
   * beside it as `signedPdf`. Final: nothing reopens, recalculates or sends
   * an accepted statement; a late correction is an adjustment on a later
   * month (decision A10).
   */
  async accept(
    access: AccessContext,
    branchId: string | null,
    id: string,
    dto: AcceptPayStatementDto,
    userAgent: string | undefined,
  ): Promise<PayStatementView> {
    const doc = await loadOwnSentStatement(
      this.models.payStatement,
      access,
      branchId,
      id,
    );
    const agencyId = agencyOf(access);
    const now = new Date();
    const account = await this.models.user
      .findById(access.userId)
      .select({ email: 1 })
      .lean<{ email?: string } | null>();
    const acceptance: PayStatementAcceptance = {
      acceptedAt: now,
      typedName: dto.typedName,
      accountEmail: account?.email ?? '',
      userAgent: (userAgent ?? '').slice(0, MAX_STATEMENT_USER_AGENT_LENGTH),
    };

    // The issued statement, as issued on the day it was sent and with the
    // branding it printed, signed.
    const context = await this.issuing.renderContext(
      agencyId,
      { kind: 'issued', at: doc.sentAt ?? doc.pdf?.renderedAt ?? now },
      doc.pdf,
    );
    const rendered = await renderStatementPdf(
      buildStatementPdfModel({ ...doc, acceptance }, context),
    );
    // Unique per attempt, as a send's: losing a race deletes only our own.
    const key = this.storage.buildObjectKey({
      agencyId,
      purpose: PAY_STATEMENTS_PURPOSE,
      filename: statementSignedPdfFilename(doc.month, doc.version),
      parts: [String(doc._id)],
    });
    const stored = await this.storage.putObject(key, rendered.buffer, PDF_TYPE);
    const signedPdf = {
      key,
      sha256: sha256Hex(rendered.buffer),
      size: stored.size,
      renderedAt: now,
      agencyName: context.agencyName,
      logoKey: context.logoKey,
    };

    const updated = await this.models.payStatement
      .findOneAndUpdate(
        {
          _id: doc._id,
          agencyId,
          userId: doc.userId,
          status: 'sent',
          version: doc.version,
          updatedAt: doc.updatedAt ?? null,
        },
        { $set: { status: 'accepted', acceptance, signedPdf } },
        { new: true },
      )
      .lean<LeanStatement | null>();
    if (!updated) {
      await this.storage
        .deleteObject(key)
        .catch((error: unknown) =>
          this.logger.warn(
            `Could not remove the unused signed PDF ${key}: ${String(error)}`,
          ),
        );
      throw await this.missed(doc._id);
    }
    await this.notify('payouts.statement_accepted', access, updated, [
      ...(updated.sentBy ? [String(updated.sentBy)] : []),
    ]);
    return statementView(updated);
  }

  /**
   * Dispute a sent statement, with notes. It becomes `rejected` (shown as
   * Disputed) and editable: a reviewer corrects it and sends it again.
   */
  async reject(
    access: AccessContext,
    branchId: string | null,
    id: string,
    dto: RejectPayStatementDto,
  ): Promise<PayStatementView> {
    const doc = await loadOwnSentStatement(
      this.models.payStatement,
      access,
      branchId,
      id,
    );
    const updated = await this.models.payStatement
      .findOneAndUpdate(
        {
          _id: doc._id,
          agencyId: agencyOf(access),
          userId: doc.userId,
          status: 'sent',
          version: doc.version,
          updatedAt: doc.updatedAt ?? null,
        },
        {
          $set: {
            status: 'rejected',
            rejection: { rejectedAt: new Date(), notes: dto.notes },
          },
        },
        { new: true },
      )
      .lean<LeanStatement | null>();
    if (!updated) throw await this.missed(doc._id);
    await this.notify('payouts.statement_rejected', access, updated);
    return statementView(updated);
  }

  /** After a conditional write missed: why. */
  private async missed(id: Types.ObjectId): Promise<ConflictException> {
    const now = await this.models.payStatement
      .findById(id)
      .select({ status: 1 })
      .lean<{ status: PayStatementStatus } | null>();
    return now?.status === 'sent'
      ? new ConflictException({
          code: PAYOUT_STATEMENT_CHANGED,
          message:
            'It changed while you were answering. Open it again and try again.',
        })
      : new ConflictException({
          code: PAYOUT_STATEMENT_NOT_SENT,
          message:
            'It is no longer waiting for your answer. Open it again to see where it stands.',
        });
  }

  /**
   * Best effort, as the sent notification: a lost notification must not
   * undo an answer. Once per answer per version (`deterministicEventId`).
   */
  private async notify(
    type: 'payouts.statement_rejected' | 'payouts.statement_accepted',
    access: AccessContext,
    doc: LeanStatement,
    alsoTell: string[] = [],
  ): Promise<void> {
    const statementId = String(doc._id);
    const employeeId = String(doc.userId);
    try {
      const [reviewers, others] = await Promise.all([
        statementReviewerIds(peopleModels(this.models), {
          agencyId: doc.agencyId,
          branchId: doc.branchId ?? null,
          employeeId,
        }),
        // A sender deactivated since is not told.
        activeAccountIds(this.models.user, doc.agencyId, alsoTell),
      ]);
      const recipientIds = [...new Set([...others, ...reviewers])].filter(
        (recipient) => recipient !== employeeId && recipient !== access.userId,
      );
      // A sole owner answering their own statement has nobody to tell, and
      // the event needs one recipient.
      if (recipientIds.length === 0) return;
      await this.inngest.send(
        notificationRequested,
        statementAnswerNotification({
          type,
          agencyId: doc.agencyId,
          statementId,
          month: doc.month,
          version: doc.version,
          employeeName: doc.userName,
          recipientIds,
          actorId: access.userId,
        }),
        { id: deterministicEventId(type, `${statementId}:v${doc.version}`) },
      );
    } catch (error) {
      this.logger.warn(
        `Could not request the ${type} notification for ${statementId}: ${String(error)}`,
      );
    }
  }
}
