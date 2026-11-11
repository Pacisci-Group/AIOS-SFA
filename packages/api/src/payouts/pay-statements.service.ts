import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  carrierSlug,
  DataScope,
  ENTERED_ADJUSTMENT_KEYS,
  ENTERED_ADJUSTMENTS,
  isEditableStatementStatus,
  normalizeCarrier,
  normalizeStatementText,
  PAYOUT_CHARGEBACK_ALREADY_CHARGED,
  PAYOUT_NO_CARRIER,
  PAYOUT_STATEMENT_CHANGED,
  PAYOUT_STATEMENT_NOT_EDITABLE,
  PAYOUT_STATEMENT_OWN_INPUTS,
  policyNumberKey,
  type AccessContext,
  type PayStatementsResponse,
  type PayStatementView,
} from '@sfa/shared';
import { Types, type ClientSession, type FilterQuery } from 'mongoose';
import {
  businessDateInstant,
  businessDay,
} from '../common/dates/business-dates';
import { escapeRegex } from '../common/mongo/escape-regex';
import { TransactionRunner } from '../common/mongo/transaction.runner';
import {
  lockChargebackLedger,
  writeManualChargeback,
} from '../common/payouts/chargeback-writers';
import {
  recomputeStatement,
  type StatementEdit,
} from '../common/payouts/generate-run';
import {
  existingChargebacks,
  findPolicyByNumber,
  type ExistingChargeback,
} from '../common/payouts/match-import-rows';
import { monthLabel } from '../common/payouts/month-window';
import type {
  AddStatementAdjustmentDto,
  ListPayStatementsQueryDto,
  UpdateStatementAdjustmentsDto,
  UpdateStatementInputsDto,
} from './dto/payouts.dto';
import { PayoutModelsService } from './payout-models.service';
import {
  statementSummary,
  statementView,
  type LeanStatement,
} from './payout-views';
import type { PayStatement } from './schemas/pay-statement.schema';
import {
  agencyOf,
  assertNotOwnStatement,
  issuesOwnStatement,
  loadVisibleStatement,
  readsOthersPay,
  statementVisibility,
} from './statement-visibility';

/**
 * Pay statements (PAC-178): the Payouts table, My Pay, one statement, and
 * recalculating one. Issuing them — the PDF, send, reopen — is
 * `StatementIssueService`'s (PAC-181). Every read starts from `statementVisibility` — the
 * employee sees their own sent statements, a reviewer what their scope
 * reaches — and a statement the caller may not see is a 404, never a 403,
 * so its existence is not given away.
 */
@Injectable()
export class PayStatementsService {
  constructor(
    private readonly payoutModels: PayoutModelsService,
    private readonly transactions: TransactionRunner,
  ) {}

  private get models() {
    return this.payoutModels.models;
  }

  async list(
    access: AccessContext,
    branchId: string | null,
    query: ListPayStatementsQueryDto,
  ): Promise<PayStatementsResponse> {
    const filter: FilterQuery<PayStatement> = {
      ...statementVisibility(access, branchId, {
        mine: query.mine === 'true',
      }),
    };
    if (query.month) filter.month = query.month;
    if (query.status) {
      // Never lets the employee rule's "no drafts" be asked back in.
      filter.status =
        filter.status !== undefined
          ? { $eq: query.status, ...(filter.status as object) }
          : query.status;
    }
    // A branch filter only narrows an agency-wide view; a branch manager is
    // already pinned to their own (and the branch guard refuses another).
    if (
      query.branchId &&
      readsOthersPay(access) &&
      access.dataScope === DataScope.Agency &&
      query.mine !== 'true'
    ) {
      filter.branchId = query.branchId;
    }
    if (query.q) {
      filter.userName = { $regex: escapeRegex(query.q), $options: 'i' };
    }

    const [total, rows] = await Promise.all([
      this.models.payStatement.countDocuments(filter),
      this.models.payStatement
        .find(filter)
        // The heavy arrays are the detail page's; a row needs the totals
        // (and `sentAt`, not the issued versions' history).
        .select({ premiumLines: 0, deals: 0, chargebacks: 0, history: 0 })
        .sort({ month: -1, userName: 1, _id: 1 })
        .skip((query.page - 1) * query.pageSize)
        .limit(query.pageSize)
        .lean<LeanStatement[]>(),
    ]);
    return {
      statements: rows.map(statementSummary),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  private findVisible(
    access: AccessContext,
    branchId: string | null,
    id: string,
  ): Promise<LeanStatement> {
    return loadVisibleStatement(this.models.payStatement, access, branchId, id);
  }

  async detail(
    access: AccessContext,
    branchId: string | null,
    id: string,
  ): Promise<PayStatementView> {
    return statementView(await this.findVisible(access, branchId, id));
  }

  /**
   * Recompute one draft or disputed statement from today's data. 409
   * `PAYOUT_STATEMENT_NOT_EDITABLE` once it has been sent or accepted; 403
   * `PAYOUT_STATEMENT_OWN_STATEMENT` on one's own without
   * `agency:payouts:admin` (PAC-181 review fixes, widening the inputs rule).
   */
  async recalculate(
    access: AccessContext,
    branchId: string | null,
    id: string,
  ): Promise<PayStatementView> {
    const doc = await this.findVisible(access, branchId, id);
    assertNotOwnStatement(access, doc);
    const notEditable = () =>
      new ConflictException({
        code: PAYOUT_STATEMENT_NOT_EDITABLE,
        message:
          'This statement has been sent, so it can no longer be recalculated.',
      });
    if (!isEditableStatementStatus(doc.status)) throw notEditable();
    await this.moved(doc, notEditable, () => this.saveEdit(access, doc, null));
    return this.detail(access, branchId, id);
  }

  /**
   * The figures the manager enters (2026 comp plans) — compliance rate,
   * retention, life referrals, meeting attendance — saved whole, then the
   * statement is recalculated as Recalculate does: against the month's stored
   * team split and Salesperson of the Month. When the figures change who
   * shares the pool or can win the month, the statement says to recalculate
   * the month.
   *
   * Draft and disputed statements only (409 `PAYOUT_STATEMENT_NOT_EDITABLE`).
   * Not on one's own statement without `agency:payouts:admin` (403
   * `PAYOUT_STATEMENT_OWN_INPUTS`): they decide one's own pay. Saved with
   * the figures computed from them, in one write on the statement as it was
   * read (409 `PAYOUT_STATEMENT_CHANGED` if it changed meanwhile).
   */
  async updateInputs(
    access: AccessContext,
    branchId: string | null,
    id: string,
    dto: UpdateStatementInputsDto,
  ): Promise<PayStatementView> {
    const doc = await this.findVisible(access, branchId, id);
    if (issuesOwnStatement(access, doc)) {
      throw new ForbiddenException({
        code: PAYOUT_STATEMENT_OWN_INPUTS,
        message: 'Someone else enters the figures on your own statement.',
      });
    }
    const notEditable = () =>
      new ConflictException({
        code: PAYOUT_STATEMENT_NOT_EDITABLE,
        message:
          'This statement has been sent, so its figures can no longer change.',
      });
    if (!isEditableStatementStatus(doc.status)) throw notEditable();
    await this.moved(doc, notEditable, () =>
      this.saveEdit(access, doc, {
        inputs: {
          compliancePercent: dto.compliancePercent,
          retentionPercent: dto.retentionPercent,
          lifeReferrals: dto.lifeReferrals,
          meetingAttendance: dto.meetingAttendance,
        },
      }),
    );
    return this.detail(access, branchId, id);
  }

  /**
   * The amounts a reviewer works out outside the app and enters (owner,
   * 10 Nov 2026): Other bonuses / SPIFFs (added), the compliance adjustment
   * and other adjustments (deducted), whole — each replaces the statement's
   * adjustments of its kind (`spiff`, `compliance`, `manual`) with one row,
   * or none for `null`, carrying its optional note (PAC-182). The chargeback
   * lines (`exclude_chargeback`, `add_chargeback`) are never touched. Then
   * the statement is recalculated.
   *
   * `payouts:write`, draft and disputed statements only (409
   * `PAYOUT_STATEMENT_NOT_EDITABLE`); not one's own without
   * `agency:payouts:admin` (403 `PAYOUT_STATEMENT_OWN_STATEMENT`). Saved with
   * the figures computed from them, in one write conditional on the
   * statement's last write, as a send is: a statement that changed meanwhile
   * is a 409 `PAYOUT_STATEMENT_CHANGED`.
   */
  async updateAdjustments(
    access: AccessContext,
    branchId: string | null,
    id: string,
    dto: UpdateStatementAdjustmentsDto,
  ): Promise<PayStatementView> {
    const doc = await this.findVisible(access, branchId, id);
    assertNotOwnStatement(access, doc);
    const notEditable = () =>
      new ConflictException({
        code: PAYOUT_STATEMENT_NOT_EDITABLE,
        message:
          'This statement has been sent, so its adjustments can no longer change.',
      });
    if (!isEditableStatementStatus(doc.status)) throw notEditable();

    const now = new Date();
    const enteredKinds = new Set<string>(
      ENTERED_ADJUSTMENT_KEYS.map((key) => ENTERED_ADJUSTMENTS[key].kind),
    );
    const kept = (doc.adjustments ?? []).filter(
      (row) => !enteredKinds.has(row.kind),
    );
    const entered = ENTERED_ADJUSTMENT_KEYS.flatMap((key) => {
      const amount = dto[key];
      if (amount === null || amount === 0) return [];
      const { kind, sign } = ENTERED_ADJUSTMENTS[key];
      return [
        {
          _id: new Types.ObjectId(),
          kind,
          chargebackId: null,
          // Stored signed, as the engine sums it: deductions negative.
          amount: sign * amount,
          // Why it was given (PAC-182), shown on the statement page.
          note: normalizeStatementText(dto.notes?.[key] ?? ''),
          createdBy: new Types.ObjectId(access.userId),
          createdAt: now,
        },
      ];
    });

    await this.moved(doc, notEditable, () =>
      this.saveEdit(access, doc, { adjustments: [...kept, ...entered] }),
    );
    return this.detail(access, branchId, id);
  }

  // --- Chargeback lines (PAC-182) ------------------------------------------

  /**
   * One chargeback line with a note, then the statement is recalculated:
   *
   * - **Leave out** (`exclude_chargeback`) a chargeback on the statement. Not
   *   one already left out, one older than the structure's chargeback window
   *   (it is not charged anyway), or one a manager added — remove that.
   * - **Add** (`add_chargeback`) a chargeback the ledger does not hold: a
   *   `manual` ledger row for the statement's employee, counted in its month.
   *   A policy is charged back once (409 `PAYOUT_CHARGEBACK_ALREADY_CHARGED`),
   *   checked under the same lock as a report commit. A policy the app holds
   *   is found by its number and lends its carrier; otherwise the carrier
   *   must be one on the statement, since it picks the rate the chargeback
   *   comes off.
   *
   * `payouts:write`, draft and disputed statements only (409
   * `PAYOUT_STATEMENT_NOT_EDITABLE`), not one's own without
   * `agency:payouts:admin` (403); conditional on the statement's last write
   * (409 `PAYOUT_STATEMENT_CHANGED`).
   */
  async addAdjustment(
    access: AccessContext,
    branchId: string | null,
    id: string,
    dto: AddStatementAdjustmentDto,
  ): Promise<PayStatementView> {
    const doc = await this.editableStatement(access, branchId, id);
    const now = new Date();
    const createdBy = new Types.ObjectId(access.userId);
    const adjustments = doc.adjustments ?? [];

    if (dto.kind === 'exclude_chargeback') {
      const row = (doc.chargebacks ?? []).find(
        (chargeback) => chargeback.chargebackId === dto.chargebackId,
      );
      if (!row) {
        throw new BadRequestException(
          'That chargeback is not on this statement. Recalculate it and try again.',
        );
      }
      const lineOf = (kind: string) =>
        adjustments.some(
          (adjustment) =>
            adjustment.kind === kind &&
            String(adjustment.chargebackId) === dto.chargebackId,
        );
      if (lineOf('exclude_chargeback')) {
        throw new BadRequestException('That chargeback is already left out.');
      }
      if (lineOf('add_chargeback')) {
        throw new BadRequestException(
          'That chargeback was added on this statement. Remove it instead.',
        );
      }
      if (row.excluded) {
        throw new BadRequestException(
          'That chargeback is older than the chargeback window, so it is not charged.',
        );
      }
      await this.moved(doc, adjustmentsNotEditable, () =>
        this.saveEdit(access, doc, {
          adjustments: [
            ...adjustments,
            {
              _id: new Types.ObjectId(),
              kind: 'exclude_chargeback',
              chargebackId: new Types.ObjectId(dto.chargebackId),
              amount: null,
              note: dto.note,
              createdBy,
              createdAt: now,
            },
          ],
        }),
      );
    } else {
      await this.addChargeback(access, doc, dto, now);
    }
    return this.detail(access, branchId, id);
  }

  private async addChargeback(
    access: AccessContext,
    doc: LeanStatement,
    dto: Extract<AddStatementAdjustmentDto, { kind: 'add_chargeback' }>,
    now: Date,
  ): Promise<void> {
    const agencyId = agencyOf(access);
    const key = policyNumberKey(dto.policyNumber);
    if (!key) {
      throw new BadRequestException(
        'Enter a policy number with letters or digits in it.',
      );
    }
    const policy = await findPolicyByNumber(
      this.models,
      agencyId,
      dto.policyNumber,
      dto.carrier,
    );
    // The carrier picks the line, and so the rate, the chargeback comes off:
    // a held policy's own, else one the statement already has a line for.
    let carrier: string | null = null;
    if (!policy?.carrier) {
      const wanted = carrierSlug(normalizeCarrier(dto.carrier));
      carrier =
        (doc.premiumLines ?? [])
          .map((line) => line.carrier)
          .find(
            (name) =>
              name !== PAYOUT_NO_CARRIER &&
              carrierSlug(normalizeCarrier(name)) === wanted,
          ) ?? null;
      if (!carrier) {
        throw new BadRequestException(
          `${dto.carrier} is not a carrier on this statement. Choose one of its carriers.`,
        );
      }
    }
    const statementBranch =
      doc.branchId ?? (await this.branchOf(agencyId, doc.userId));
    if (!statementBranch) {
      throw new BadRequestException('The agency has no branch.');
    }
    const chargebackId = new Types.ObjectId();

    await this.inTransaction(doc, async (session, created) => {
      await lockChargebackLedger(this.models.agency, agencyId, session);
      // The ledger as it is now, under the lock: a policy is charged once.
      const ledger = await existingChargebacks(
        this.models.chargeback,
        agencyId,
        { policyIds: policy ? [policy.policyId] : [], numberKeys: [key] },
        session,
      );
      const existing = ledger.find(policy?.policyId ?? null, key);
      if (existing) {
        throw alreadyCharged(dto.policyNumber, existing, doc);
      }
      await writeManualChargeback(
        this.models.chargeback,
        {
          chargebackId,
          statementId: doc._id,
          month: doc.month,
          producerId: doc.userId,
          producerName: doc.userName,
          branchId: statementBranch,
          policy,
          policyNumber: dto.policyNumber,
          carrier,
          customerName: dto.customerName,
          amount: dto.amount,
          occurredAt: businessDateInstant(`${doc.month}-01`, doc.timeZone),
        },
        agencyId,
        session,
      );
      // Without a replica set there is no transaction: if the statement
      // write below misses, this row is deleted rather than left charged.
      created.track(this.models.chargeback, chargebackId);
      // The statement counts the row in the same transaction: the line, the
      // figures and the ledger row are written together or not at all.
      await this.saveEdit(
        access,
        doc,
        {
          adjustments: [
            ...(doc.adjustments ?? []),
            {
              _id: new Types.ObjectId(),
              kind: 'add_chargeback',
              chargebackId,
              // The money is the ledger row's; the adjustment says why.
              amount: null,
              note: dto.note,
              createdBy: new Types.ObjectId(access.userId),
              createdAt: now,
            },
          ],
        },
        session,
      );
    });
  }

  /**
   * Undo a chargeback line (PAC-182): restore a left-out chargeback, or
   * remove an added one **and delete its ledger row** — the one deletion the
   * ledger allows, and only while its statement is a draft or disputed. On a
   * disputed statement that row was printed on the disputed version, whose
   * file stays in history. The entered amounts are not removed here (400:
   * clear them with `PATCH …/adjustments`).
   *
   * The row is deleted and the statement recalculated without it in one
   * transaction. Without a replica set (old local containers only) a
   * statement that changed meanwhile leaves the row deleted and the line in
   * place, which charges nothing: the money is only ever the row's.
   */
  async removeAdjustment(
    access: AccessContext,
    branchId: string | null,
    id: string,
    adjustmentId: string,
  ): Promise<PayStatementView> {
    const doc = await this.editableStatement(access, branchId, id);
    const row = (doc.adjustments ?? []).find(
      (adjustment) => String(adjustment._id) === adjustmentId,
    );
    if (!row) {
      throw new NotFoundException('That adjustment is not on this statement.');
    }
    const rest = (doc.adjustments ?? []).filter(
      (adjustment) => adjustment !== row,
    );
    if (row.kind === 'exclude_chargeback') {
      await this.moved(doc, adjustmentsNotEditable, () =>
        this.saveEdit(access, doc, { adjustments: rest }),
      );
    } else if (row.kind === 'add_chargeback') {
      const agencyId = agencyOf(access);
      await this.inTransaction(doc, async (session) => {
        // The row first, so the recalculation below no longer reads it.
        if (row.chargebackId) {
          await this.models.chargeback.deleteOne(
            {
              _id: row.chargebackId,
              agencyId,
              reason: 'manual',
              statementId: doc._id,
            },
            session ? { session } : {},
          );
        }
        await this.saveEdit(access, doc, { adjustments: rest }, session);
      });
    } else {
      throw new BadRequestException(
        'Clear that amount on the statement instead.',
      );
    }
    return this.detail(access, branchId, id);
  }

  /** A statement a reviewer may correct now — or why not. */
  private async editableStatement(
    access: AccessContext,
    branchId: string | null,
    id: string,
  ): Promise<LeanStatement> {
    const doc = await this.findVisible(access, branchId, id);
    assertNotOwnStatement(access, doc);
    if (!isEditableStatementStatus(doc.status)) {
      throw adjustmentsNotEditable();
    }
    return doc;
  }

  /**
   * Recalculate `doc` with `edit` saved in the same write (PAC-182 review):
   * one write, onto the statement exactly as the reviewer read it, so a send,
   * an answer or a month's calculation can never land between an edit and
   * the figures computed from it. `null` recalculates with no edit. With a
   * `session`, inside the caller's transaction. Throws {@link StatementMoved}
   * when the statement changed or stopped being editable since it was read.
   */
  private async saveEdit(
    access: AccessContext,
    doc: LeanStatement,
    edit: Omit<StatementEdit, 'updatedAt'> | null,
    session: ClientSession | null = null,
  ): Promise<void> {
    const done = await recomputeStatement(this.models, {
      agencyId: agencyOf(access),
      statementId: String(doc._id),
      edit: edit ? { ...edit, updatedAt: doc.updatedAt ?? null } : undefined,
      session,
    });
    if (!done) throw new StatementMoved();
  }

  /**
   * `work` inside a transaction (the no-replica-set fallback undoes the
   * documents it tracks), with a statement that moved meanwhile reported as
   * the 409 it deserves once the transaction is over.
   */
  private async inTransaction(
    doc: LeanStatement,
    work: (
      session: ClientSession | null,
      created: Parameters<Parameters<TransactionRunner['run']>[0]>[1],
    ) => Promise<void>,
  ): Promise<void> {
    await this.moved(doc, adjustmentsNotEditable, () =>
      this.transactions.run(work),
    );
  }

  /** `work`, with a {@link StatementMoved} turned into why it moved. */
  private async moved(
    doc: LeanStatement,
    notEditable: () => ConflictException,
    work: () => Promise<void>,
  ): Promise<void> {
    try {
      await work();
    } catch (error) {
      if (!(error instanceof StatementMoved)) throw error;
      const current = await this.models.payStatement
        .findById(doc._id)
        .select({ status: 1 })
        .lean<{ status: PayStatement['status'] } | null>();
      throw current && isEditableStatementStatus(current.status)
        ? new ConflictException({
            code: PAYOUT_STATEMENT_CHANGED,
            message:
              'It changed while your change was being saved. Review it and try again.',
          })
        : notEditable();
    }
  }

  /** The employee's branch, for a statement computed without one. */
  private async branchOf(
    agencyId: string,
    userId: Types.ObjectId,
  ): Promise<string | null> {
    const user = await this.models.user
      .findOne({ _id: userId, agencyId: new Types.ObjectId(agencyId) })
      .select({ branchId: 1 })
      .lean<{ branchId?: Types.ObjectId | null } | null>();
    if (user?.branchId) return String(user.branchId);
    const branch = await this.models.branch
      .findOne({ agencyId: new Types.ObjectId(agencyId) })
      .sort({ createdAt: 1, _id: 1 })
      .select({ _id: 1 })
      .lean<{ _id: Types.ObjectId } | null>();
    return branch ? String(branch._id) : null;
  }
}

/** A conditional statement write missed; the caller says why. */
class StatementMoved extends Error {}

function adjustmentsNotEditable(): ConflictException {
  return new ConflictException({
    code: PAYOUT_STATEMENT_NOT_EDITABLE,
    message:
      'This statement has been sent, so its adjustments can no longer change.',
  });
}

/**
 * A policy is charged back once (409). Who it was charged to, and when, only
 * when that is the statement's own employee (PAC-182 review): a branch
 * manager typing another branch's policy number learns nothing about that
 * branch's people. The month is the agency's — a report or manual row's pay
 * month, else the month of an app row's date on the statement's clock.
 */
function alreadyCharged(
  policyNumber: string,
  existing: ExistingChargeback,
  doc: LeanStatement,
): ConflictException {
  const theirs =
    existing.producerId !== null &&
    String(existing.producerId) === String(doc.userId);
  const month =
    existing.statementMonth ??
    businessDay(existing.occurredAt, doc.timeZone)?.slice(0, 7) ??
    null;
  const when = month ? ` in ${monthLabel(month)}` : '';
  return new ConflictException({
    code: PAYOUT_CHARGEBACK_ALREADY_CHARGED,
    message: theirs
      ? `Policy ${policyNumber} has already been charged back to ${doc.userName}${when}. A policy is charged back once.`
      : `Policy ${policyNumber} has already been charged back. A policy is charged back once.`,
  });
}
