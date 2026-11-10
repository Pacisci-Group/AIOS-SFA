import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AgencyPermission,
  DataScope,
  isEditableStatementStatus,
  PAYOUT_RUN_GENERATING,
  PAYOUT_STATEMENT_CHANGED,
  PAYOUT_STATEMENT_NOT_EDITABLE,
  PAYOUT_STATEMENT_NOT_SENT,
  statementPdfFilename,
  type AccessContext,
  type PayStatementPdfLinkResponse,
  type PayStatementStatus,
  type PayStatementView,
  type SendAllDraftsResponse,
} from '@sfa/shared';
import type { Response } from 'express';
import { Types, type FilterQuery } from 'mongoose';
import { mapWithConcurrency } from '../common/async/map-with-concurrency';
import { displayNamesFor } from '../common/domain/user-names';
import { sha256Hex } from '../common/payouts/pdf/hash';
import { usableLogo } from '../common/payouts/pdf/probe-logo';
import { readAll } from '../common/payouts/pdf/read-all';
import { renderStatementPdf } from '../common/payouts/pdf/render-statement-pdf';
import {
  buildStatementPdfModel,
  type StatementPdfContext,
  type StatementPdfIssue,
  type StatementPdfLogo,
} from '../common/payouts/pdf/statement-pdf-model';
import { statementSentNotification } from '../common/payouts/statement-sent';
import { notificationRequested } from '../inngest/events';
import {
  deterministicEventId,
  InngestService,
} from '../inngest/inngest.service';
import { StorageService } from '../storage/storage.service';
import { TenantBrandingService } from '../tenant-branding/tenant-branding.service';
import type { SendAllDraftsQueryDto } from './dto/payouts.dto';
import { PayoutModelsService } from './payout-models.service';
import { statementView, type LeanStatement } from './payout-views';
import type { PayStatement } from './schemas/pay-statement.schema';
import {
  agencyOf,
  assertNotOwnStatement,
  loadVisibleStatement,
  readsOthersPay,
  statementVisibility,
} from './statement-visibility';

/** The `buildObjectKey` purpose of issued statements. */
export const PAY_STATEMENTS_PURPOSE = 'pay-statements';

const PDF_TYPE = 'application/pdf';

/** A logo larger than this is not embedded (the name stands in). */
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const EMBEDDABLE_LOGO_TYPES = new Set(['image/png', 'image/jpeg']);

/**
 * How long an agency's logo bytes are reused, keyed by the logo's storage
 * key. The key is read on every render, so a new logo shows at once; only the
 * download (up to 2 MB) is saved, for previews and a Send all.
 */
const LOGO_CACHE_MS = 60_000;

/** Statements Send all renders, stores and writes at once. */
export const SEND_ALL_CONCURRENCY = 4;

/** What Send all reports for a statement it could not send (the detail is logged). */
export const SEND_ALL_FAILED_MESSAGE =
  'It could not be sent. Try sending it on its own.';

/** What every statement of one agency is rendered with — read once per batch. */
interface IssueContext {
  agencyId: string;
  agencyName: string;
  logo: StatementPdfLogo | null;
  senderName: string | null;
}

type SendOutcome =
  | { kind: 'sent' }
  | { kind: 'skipped' }
  | { kind: 'failed'; statementId: string; userName: string };

/**
 * Issuing commission statements (PAC-181): render the Commission Statement
 * PDF, store it and mark the statement sent (one, or every draft of a
 * month); reopen a sent one; hand out a link to an issued file; stream a
 * draft's preview.
 *
 * **Version.** `version === history.length + 1`, always: every issued
 * version that is no longer current has one `history` row, written in the
 * same update that bumps `version`. A first send issues v1; reopening moves
 * v1 into history and makes the draft v2; re-sending a disputed statement
 * (PAC-182) does both in the send. So each issued version has its own file,
 * and the notification's dedupe key — which carries the version — tells the
 * employee once per version.
 *
 * **Own statement.** A reviewer does not send, reopen or recalculate their
 * own statement without `agency:payouts:admin` (403
 * `PAYOUT_STATEMENT_OWN_STATEMENT`); Send all leaves it out.
 *
 * Rendering happens in the request (a statement is one page, a month is
 * tens of them); Send all renders `SEND_ALL_CONCURRENCY` at a time.
 */
@Injectable()
export class StatementIssueService {
  private readonly logger = new Logger(StatementIssueService.name);
  private readonly logoCache = new Map<
    string,
    { key: string; logo: StatementPdfLogo | null; expiresAt: number }
  >();

  constructor(
    private readonly payoutModels: PayoutModelsService,
    private readonly storage: StorageService,
    private readonly inngest: InngestService,
    private readonly branding: TenantBrandingService,
  ) {}

  private get models() {
    return this.payoutModels.models;
  }

  // --- Send ----------------------------------------------------------------

  /**
   * Send one draft or disputed statement. 403 `PAYOUT_STATEMENT_OWN_STATEMENT`
   * for one's own without `agency:payouts:admin`; 409
   * `PAYOUT_STATEMENT_NOT_EDITABLE` once sent; 409 `PAYOUT_STATEMENT_CHANGED`
   * when it changed while it was being rendered; 409 `PAYOUT_RUN_GENERATING`
   * while its month is being calculated.
   */
  async send(
    access: AccessContext,
    branchId: string | null,
    id: string,
  ): Promise<PayStatementView> {
    const doc = await loadVisibleStatement(
      this.models.payStatement,
      access,
      branchId,
      id,
    );
    assertNotOwnStatement(access, doc);
    if (!isEditableStatementStatus(doc.status)) throw notEditable();
    const agencyId = agencyOf(access);
    await this.assertRunIdle(agencyId, doc.runId);
    const context = await this.issueContext(agencyId, access.userId);
    return statementView(await this.issue(access, doc, context));
  }

  /**
   * Send every draft of a month the caller may see — a branch manager their
   * branch's, the owner the agency's or, with `branchId`, one branch's —
   * except the caller's own without `agency:payouts:admin`. Drafts that
   * stopped being drafts, or changed, meanwhile are `skipped`; ones that
   * could not be sent are listed in `failed` (with a fixed message — the
   * detail is logged), and the rest still go.
   *
   * Only ids are read up front; each draft is loaded, rendered, stored and
   * written `SEND_ALL_CONCURRENCY` at a time.
   */
  async sendAll(
    access: AccessContext,
    branchId: string | null,
    runId: string,
    query: SendAllDraftsQueryDto,
  ): Promise<SendAllDraftsResponse> {
    const started = Date.now();
    const agencyId = agencyOf(access);
    const run = await this.models.payoutRun
      .findOne({ _id: new Types.ObjectId(runId), agencyId })
      .select({ status: 1 })
      .lean();
    if (!run) throw new NotFoundException('Payout run not found');
    if (run.status === 'generating') throw generating();

    const filter: FilterQuery<PayStatement> = {
      ...statementVisibility(access, branchId),
      runId: run._id,
      status: 'draft',
    };
    // Narrows an agency-wide reviewer to the branch the page shows, as the
    // statements list does; a branch manager is already pinned to theirs.
    if (
      query.branchId &&
      readsOthersPay(access) &&
      access.dataScope === DataScope.Agency
    ) {
      filter.branchId = query.branchId;
    }
    // Never one's own without the admin permission (`issuesOwnStatement`).
    // `$and`, because the scope filter may already constrain `userId`.
    if (!access.permissions.includes(AgencyPermission.PayoutsAdmin)) {
      filter.$and = [
        ...(filter.$and ?? []),
        { userId: { $ne: new Types.ObjectId(access.userId) } },
      ];
    }
    const drafts = await this.models.payStatement
      .find(filter)
      .select({ _id: 1, userName: 1 })
      .sort({ userName: 1, _id: 1 })
      .lean<{ _id: Types.ObjectId; userName: string }[]>();

    const result: SendAllDraftsResponse = { sent: 0, skipped: 0, failed: [] };
    if (drafts.length === 0) return result;
    const context = await this.issueContext(agencyId, access.userId);
    const outcomes = await mapWithConcurrency(
      drafts,
      SEND_ALL_CONCURRENCY,
      (draft) => this.sendOneOfAll(access, agencyId, draft, context),
    );
    for (const outcome of outcomes) {
      if (outcome.kind === 'sent') result.sent += 1;
      else if (outcome.kind === 'skipped') result.skipped += 1;
      else {
        result.failed.push({
          statementId: outcome.statementId,
          userName: outcome.userName,
          message: SEND_ALL_FAILED_MESSAGE,
        });
      }
    }
    this.logger.log(
      `Send all (run ${runId}, agency ${agencyId}): ${result.sent} sent, ` +
        `${result.skipped} skipped, ${result.failed.length} failed ` +
        `in ${Date.now() - started} ms`,
    );
    return result;
  }

  /** One draft of a Send all; never throws — the outcome says what happened. */
  private async sendOneOfAll(
    access: AccessContext,
    agencyId: string,
    draft: { _id: Types.ObjectId; userName: string },
    context: IssueContext,
  ): Promise<SendOutcome> {
    try {
      const doc = await this.models.payStatement
        .findOne({ _id: draft._id, agencyId, status: 'draft' })
        .lean<LeanStatement | null>();
      if (!doc) return { kind: 'skipped' };
      await this.issue(access, doc, context);
      return { kind: 'sent' };
    } catch (error) {
      if (error instanceof ConflictException) return { kind: 'skipped' };
      this.logger.warn(
        `Could not send statement ${String(draft._id)}: ${
          error instanceof Error
            ? (error.stack ?? error.message)
            : String(error)
        }`,
      );
      return {
        kind: 'failed',
        statementId: String(draft._id),
        userName: draft.userName,
      };
    }
  }

  /**
   * Render, store and mark one statement sent. The conditional write is the
   * guard: the statement must still be the one that was rendered (same
   * status, version, calculation **and last write** — `updatedAt` moves on
   * every statement write, new figures included), or the upload is removed
   * and it is a 409.
   */
  private async issue(
    access: AccessContext,
    doc: LeanStatement,
    context: IssueContext,
  ): Promise<LeanStatement> {
    if (!isEditableStatementStatus(doc.status)) throw notEditable();
    const now = new Date();
    // A disputed statement goes out as the next version; a draft is already
    // the version it will be issued as.
    const supersedes = doc.status === 'rejected';
    const version = supersedes ? doc.version + 1 : doc.version;
    const statementId = String(doc._id);

    const rendered = await renderStatementPdf(
      buildStatementPdfModel(
        { ...doc, version },
        pdfContext(context, { kind: 'issued', at: now }),
      ),
    );
    // Unique per attempt: a send that loses a race deletes its own upload,
    // never the winner's.
    const key = this.storage.buildObjectKey({
      agencyId: context.agencyId,
      purpose: PAY_STATEMENTS_PURPOSE,
      filename: statementPdfFilename(doc.month, version),
      parts: [statementId],
    });
    const stored = await this.storage.putObject(key, rendered.buffer, PDF_TYPE);
    const pdf = {
      key,
      sha256: sha256Hex(rendered.buffer),
      size: stored.size,
      renderedAt: now,
    };
    const sentBy = new Types.ObjectId(access.userId);

    const updated = await this.models.payStatement
      .findOneAndUpdate(
        {
          _id: doc._id,
          agencyId: context.agencyId,
          status: doc.status,
          version: doc.version,
          computedAt: doc.computedAt,
          // New figures are saved before the statement is recalculated, in
          // two writes; a send between them must not go out with the old
          // figures and leave the new ones on a sent statement.
          updatedAt: doc.updatedAt ?? null,
        },
        {
          $set: {
            status: 'sent',
            version,
            pdf,
            sentAt: now,
            sentBy,
            sentByName: context.senderName,
          },
          ...(supersedes
            ? {
                $push: {
                  history: {
                    version: doc.version,
                    outcome: 'superseded',
                    pdf: doc.pdf ?? null,
                    sentAt: doc.sentAt ?? null,
                    sentBy: doc.sentBy ?? null,
                    sentByName: doc.sentByName ?? null,
                    at: now,
                  },
                },
              }
            : {}),
        },
        { new: true },
      )
      .lean<LeanStatement | null>();

    if (!updated) {
      await this.storage
        .deleteObject(key)
        .catch((error: unknown) =>
          this.logger.warn(
            `Could not remove unsent PDF ${key}: ${String(error)}`,
          ),
        );
      throw (await this.isEditableNow(doc._id))
        ? changed(
            'It changed while it was being sent. Review it and send again.',
          )
        : notEditable();
    }
    await this.notifySent(access, updated, context);
    return updated;
  }

  /** After a conditional write missed: is the statement still editable? */
  private async isEditableNow(id: Types.ObjectId): Promise<boolean> {
    const now = await this.models.payStatement
      .findById(id)
      .select({ status: 1 })
      .lean<{ status: PayStatementStatus } | null>();
    return now ? isEditableStatementStatus(now.status) : false;
  }

  /** Best effort: a lost notification must not undo a sent statement. */
  private async notifySent(
    access: AccessContext,
    doc: LeanStatement,
    context: IssueContext,
  ): Promise<void> {
    const statementId = String(doc._id);
    try {
      await this.inngest.send(
        notificationRequested,
        statementSentNotification({
          agencyId: context.agencyId,
          statementId,
          month: doc.month,
          version: doc.version,
          recipientId: String(doc.userId),
          actorId: access.userId,
          senderName: context.senderName,
        }),
        {
          id: deterministicEventId(
            'payouts.statement_sent',
            `${statementId}:v${doc.version}`,
          ),
        },
      );
    } catch (error) {
      this.logger.warn(
        `Could not request the statement-sent notification for ${statementId}: ${String(error)}`,
      );
    }
  }

  // --- Reopen --------------------------------------------------------------

  /**
   * Take a sent statement back to draft, before the employee answers. The
   * issued version moves into `history` (its file is kept) and the draft
   * becomes the next version. 409 `PAYOUT_STATEMENT_NOT_SENT` for anything
   * but a sent statement — an accepted one is final; 409
   * `PAYOUT_STATEMENT_CHANGED` when it changed meanwhile and is still sent;
   * 403 `PAYOUT_STATEMENT_OWN_STATEMENT` for one's own without
   * `agency:payouts:admin`.
   */
  async reopen(
    access: AccessContext,
    branchId: string | null,
    id: string,
  ): Promise<PayStatementView> {
    const doc = await loadVisibleStatement(
      this.models.payStatement,
      access,
      branchId,
      id,
      {
        userId: 1,
        status: 1,
        version: 1,
        pdf: 1,
        sentAt: 1,
        sentBy: 1,
        sentByName: 1,
        updatedAt: 1,
      },
    );
    assertNotOwnStatement(access, doc);
    if (doc.status !== 'sent') throw notSent();
    const now = new Date();
    const updated = await this.models.payStatement
      .findOneAndUpdate(
        {
          _id: doc._id,
          agencyId: agencyOf(access),
          status: 'sent',
          version: doc.version,
          updatedAt: doc.updatedAt ?? null,
        },
        {
          $set: {
            status: 'draft',
            pdf: null,
            sentAt: null,
            sentBy: null,
            sentByName: null,
          },
          $inc: { version: 1 },
          $push: {
            history: {
              version: doc.version,
              outcome: 'reopened',
              pdf: doc.pdf ?? null,
              sentAt: doc.sentAt ?? null,
              sentBy: doc.sentBy ?? null,
              sentByName: doc.sentByName ?? null,
              at: now,
            },
          },
        },
        { new: true },
      )
      .lean<LeanStatement | null>();
    if (!updated) {
      const current = await this.models.payStatement
        .findById(doc._id)
        .select({ status: 1 })
        .lean<{ status: PayStatementStatus } | null>();
      throw current?.status === 'sent'
        ? changed(
            'It changed while it was being reopened. Review it and try again.',
          )
        : notSent();
    }
    return statementView(updated);
  }

  // --- The file ------------------------------------------------------------

  /**
   * A short-lived inline link to an issued PDF — the current version's, or
   * an earlier one's with `version`. Minted for this read and never stored.
   * 404 when that version has no file (a draft, or a version never issued).
   */
  async pdfLink(
    access: AccessContext,
    branchId: string | null,
    id: string,
    version?: number,
  ): Promise<PayStatementPdfLinkResponse> {
    const doc = await loadVisibleStatement(
      this.models.payStatement,
      access,
      branchId,
      id,
      {
        month: 1,
        version: 1,
        pdf: 1,
        // Earlier versions' files are only looked up when one is asked for.
        ...(version === undefined ? {} : { history: 1 as const }),
      },
    );
    const wanted = version ?? doc.version;
    const pdf =
      wanted === doc.version
        ? (doc.pdf ?? null)
        : ((doc.history ?? []).find((entry) => entry.version === wanted)?.pdf ??
          null);
    if (!pdf) {
      throw new NotFoundException(
        'No PDF has been issued for this version of the statement.',
      );
    }
    const filename = statementPdfFilename(doc.month, wanted);
    const url = await this.storage.createPresignedDownload(pdf.key, {
      disposition: 'inline',
      filename,
      contentType: PDF_TYPE,
    });
    return { url, filename, expiresIn: this.storage.downloadUrlTtlSeconds };
  }

  /**
   * A fresh render of a draft or disputed statement, streamed and never
   * stored. Its Generated Date box reads "Draft · not issued", so a preview
   * cannot pass for an issued statement. 409 once it has been sent.
   */
  async streamPreview(
    access: AccessContext,
    branchId: string | null,
    id: string,
    res: Response,
  ): Promise<void> {
    const doc = await loadVisibleStatement(
      this.models.payStatement,
      access,
      branchId,
      id,
    );
    if (!isEditableStatementStatus(doc.status)) {
      throw new ConflictException({
        code: PAYOUT_STATEMENT_NOT_EDITABLE,
        message:
          'This statement has been sent: open its PDF rather than a preview.',
      });
    }
    const agencyId = agencyOf(access);
    const context = await this.issueContext(agencyId, null);
    const version = doc.status === 'rejected' ? doc.version + 1 : doc.version;
    const issue: StatementPdfIssue = { kind: 'draft' };
    const rendered = await renderStatementPdf(
      buildStatementPdfModel({ ...doc, version }, pdfContext(context, issue)),
    );
    const filename = `preview-${statementPdfFilename(doc.month, version)}`;
    res.setHeader('Content-Type', PDF_TYPE);
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Content-Length', rendered.buffer.byteLength);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).end(rendered.buffer);
  }

  // --- Context -------------------------------------------------------------

  private async assertRunIdle(
    agencyId: string,
    runId: Types.ObjectId,
  ): Promise<void> {
    const run = await this.models.payoutRun
      .findOne({ _id: runId, agencyId })
      .select({ status: 1 })
      .lean();
    if (run?.status === 'generating') throw generating();
  }

  /**
   * The agency's branded name and dark-surface logo — by
   * `TenantBrandingService`'s rules, as the app and the email masthead —
   * and the sender's name. The logo is embedded only as a PNG or JPEG under
   * 2 MB that pdfkit can decode; anything else falls back to the name.
   */
  private async issueContext(
    agencyId: string,
    senderId: string | null,
  ): Promise<IssueContext> {
    const [brand, logoKey, names] = await Promise.all([
      this.branding.forAgency(agencyId),
      // The band is navy: the logo made for dark surfaces, else the main one.
      this.branding.logoKeyFor(agencyId, 'dark'),
      senderId
        ? displayNamesFor(this.models.user, [senderId])
        : Promise.resolve(new Map<string, string>()),
    ]);
    return {
      agencyId,
      agencyName: brand.name,
      logo: await this.cachedLogo(agencyId, logoKey),
      senderName: senderId ? (names.get(senderId) ?? null) : null,
    };
  }

  private async cachedLogo(
    agencyId: string,
    key: string | null,
  ): Promise<StatementPdfLogo | null> {
    if (!key) return null;
    const now = Date.now();
    const hit = this.logoCache.get(agencyId);
    if (hit && hit.key === key && hit.expiresAt > now) return hit.logo;
    const logo = await this.logo(key);
    for (const [id, entry] of this.logoCache) {
      if (entry.expiresAt <= now) this.logoCache.delete(id);
    }
    this.logoCache.set(agencyId, {
      key,
      logo,
      expiresAt: now + LOGO_CACHE_MS,
    });
    return logo;
  }

  private async logo(key: string): Promise<StatementPdfLogo | null> {
    try {
      const stat = await this.storage.statObject(key);
      if (
        !stat?.contentType ||
        !EMBEDDABLE_LOGO_TYPES.has(stat.contentType) ||
        stat.size > MAX_LOGO_BYTES
      ) {
        return null;
      }
      const bytes = await readAll(
        await this.storage.getObjectStream(key),
        MAX_LOGO_BYTES,
      );
      const logo = usableLogo({
        bytes,
        contentType: stat.contentType as StatementPdfLogo['contentType'],
      });
      if (!logo) {
        this.logger.warn(
          `The agency logo ${key} cannot be decoded; statements print the agency's name instead.`,
        );
      }
      return logo;
    } catch (error) {
      this.logger.warn(
        `Could not read the agency logo ${key}: ${String(error)}`,
      );
      return null;
    }
  }
}

/**
 * What a statement is rendered with besides itself. Its Generated Date is
 * a day in the statement's own zone, which the model reads off it.
 */
function pdfContext(
  context: IssueContext,
  issue: StatementPdfIssue,
): StatementPdfContext {
  return { agencyName: context.agencyName, logo: context.logo, issue };
}

function notEditable(): ConflictException {
  return new ConflictException({
    code: PAYOUT_STATEMENT_NOT_EDITABLE,
    message: 'This statement has already been sent.',
  });
}

function changed(message: string): ConflictException {
  return new ConflictException({ code: PAYOUT_STATEMENT_CHANGED, message });
}

function notSent(): ConflictException {
  return new ConflictException({
    code: PAYOUT_STATEMENT_NOT_SENT,
    message: 'Only a sent statement can be reopened.',
  });
}

function generating(): ConflictException {
  return new ConflictException({
    code: PAYOUT_RUN_GENERATING,
    message: 'This month is being calculated right now. Try again in a minute.',
  });
}
