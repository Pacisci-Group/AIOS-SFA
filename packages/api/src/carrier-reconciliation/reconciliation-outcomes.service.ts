import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  ModuleKey,
  RECONCILIATION_OUTCOME_FORBIDDEN,
  RECONCILIATION_OUTCOME_KIND_LABELS,
  RECONCILIATION_OUTCOME_LOCKED,
  RECONCILIATION_OUTCOME_NOT_ALLOWED,
  RECONCILIATION_OUTCOME_RESOLUTION,
  RECONCILIATION_SALE_OUTCOME_KINDS,
  RECONCILIATION_SALE_POLICY_UNMATCHED,
  RECONCILIATION_SALE_WRONG_LEAD,
  RECONCILIATION_TAB_LABELS,
  canRecordReconciliationSale,
  primaryReconciliationTab,
  reconciliationOutcomeKinds,
  type AccessContext,
  type ReconciliationAssignedRowDetail,
  type ReconciliationOutcomeKind,
} from '@sfa/shared';
import { Types, type Model } from 'mongoose';
import {
  Chargeback,
  type ChargebackDocument,
} from '../chargebacks/schemas/chargeback.schema';
import { clientAgencyId } from '../common/access/client-scope';
import type { RowOutcome } from '../common/carrier-reconciliation/carry-forward';
import { reconciliationPolicyKey } from '../common/carrier-reconciliation/dash-file-reader';
import { LIVE_ROW } from '../common/carrier-reconciliation/live-row';
import { isHeldOpen } from '../common/carrier-reconciliation/outcome-state';
import { asksForDecision } from '../common/carrier-reconciliation/reconcile';
import { escapeRegex } from '../common/mongo/escape-regex';
import { Deal, type DealDocument } from '../deals/schemas/deal.schema';
import { Agency, type AgencyDocument } from '../platform/schemas/agency.schema';
import { Policy, type PolicyDocument } from '../policies/schemas/policy.schema';
import type { RecordOutcomeDto } from './dto/carrier-reconciliation.dto';
import { outcomeAsRead } from './outcome-filters';
import { ReconciliationAssignmentsService } from './reconciliation-assignments.service';
import { isStale, type LeanRow, type LeanRun } from './reconciliation-views';
import {
  ReconciliationRow,
  type ReconciliationRowDocument,
  type StoredReview,
} from './schemas/reconciliation-row.schema';
import {
  ReconciliationRun,
  type ReconciliationRunDocument,
} from './schemas/reconciliation-run.schema';

const CHANGED = 'Someone else changed this row. Reload it and try again.';

/** A booked sale handed to {@link ReconciliationOutcomesService.recordSale}. */
export interface ReconciliationSale {
  /** The row id the page held — perhaps on an upload replaced since. */
  rowId: string;
  dealId: string;
  leadId: string;
}

/**
 * What the assignee records on a Dash row (PAC-173 PR 4): **Sold**, **Cancel
 * rewrite** or **Other**.
 *
 * - **Other** is a note, and finishes the row at once.
 * - **Sold** starts at `record_sale`: the assignee enters the Dash line as an
 *   ordinary sale — New Lead, then Sold, both prefilled — and the sale
 *   finishes it, linking the lead, the deal and the deal's policy that is the
 *   Dash line.
 * - **Cancel rewrite** starts the same way; booking the sale moves it to
 *   `write_replacement`, and the replacement, written through the normal
 *   cancel-rewrite chain (which writes the chargeback), finishes it.
 *
 * Finishing writes the row's decision too (`RECONCILIATION_OUTCOME_RESOLUTION`),
 * by the person who finished it, so the owner's tabs read the same as for a
 * row they decided themselves.
 *
 * ## The rules between outcome, review and assignment
 *
 * - **Only the row's assignee records**, and only while the row waits on a
 *   decision on a current run (owner, 28 Oct 2026). The owner's drawer shows
 *   the outcome read-only and keeps assign, reassign and decide by hand.
 * - The **owner reopening** a row, **deciding it by hand** while an outcome is
 *   under way, **reassigning or unassigning** it, and **work release** each
 *   clear an unfinished outcome (`ReconciliationRunsService.review`,
 *   `ReconciliationAssignmentsService.assign`, `UserWorkReleaseService`). A
 *   deal already booked stays booked; a later sale on the cleared outcome is a
 *   logged no-op here. **Work transfer** keeps it, so the successor resumes
 *   with the lead that moved to them.
 * - Every write is a compare-and-swap on the outcome as read
 *   (`outcomeAsRead`), the review still open and the assignee unchanged — the
 *   `assign()` pattern — so none of those owner actions can race one of these.
 *
 * ## Booked by the sale, not by this endpoint
 *
 * The sale is entered through `POST /leads` and `POST /sold-deals`, which
 * carry the row id and call {@link linkLead} and {@link recordSale} after
 * they commit. Neither ever fails the request it rides on: the lead and the
 * sale are booked either way. A hook that died after its commit is made good
 * the next time the assignee resumes the outcome — {@link record} with the
 * same kind re-checks what is already booked before answering.
 */
@Injectable()
export class ReconciliationOutcomesService {
  private readonly logger = new Logger(ReconciliationOutcomesService.name);

  constructor(
    @InjectModel(ReconciliationRun.name)
    private readonly runModel: Model<ReconciliationRunDocument>,
    @InjectModel(ReconciliationRow.name)
    private readonly rowModel: Model<ReconciliationRowDocument>,
    @InjectModel(Deal.name) private readonly dealModel: Model<DealDocument>,
    @InjectModel(Policy.name)
    private readonly policyModel: Model<PolicyDocument>,
    @InjectModel(Chargeback.name)
    private readonly chargebackModel: Model<ChargebackDocument>,
    @InjectModel(Agency.name)
    private readonly agencyModel: Model<AgencyDocument>,
    private readonly assignments: ReconciliationAssignmentsService,
  ) {}

  /**
   * `PATCH carrier-reconciliation/assigned/:rowId/outcome`.
   *
   * Start an outcome, resume it (the same kind again), or switch kind while
   * nothing is booked yet. Answers with the row as `GET assigned/:rowId`
   * does, prefill included, so the page goes straight on to the New Lead or
   * Sold form.
   *
   * Writes the row the id names and never follows a re-upload to the current
   * copy: a page holding a replaced row is shown a 409 and reloads.
   */
  async record(
    access: AccessContext,
    rowId: string,
    dto: RecordOutcomeDto,
  ): Promise<ReconciliationAssignedRowDetail> {
    const agencyId = clientAgencyId(access);
    const row = await this.rowModel
      .findOne({ _id: new Types.ObjectId(rowId), agencyId })
      .lean<LeanRow>();
    if (!row || row.assignment?.userId !== access.userId) {
      throw new NotFoundException('That row is not assigned to you.');
    }
    const run = await this.runModel
      .findOne({ _id: row.runId, agencyId })
      .lean<LeanRun>();
    if (run?.supersededByRunId) {
      throw new ConflictException(
        'A newer upload of this report replaced this row. Open it from your list again.',
      );
    }
    if (!run || run.status !== 'ready' || isStale(run)) {
      throw new ConflictException(
        'Only the rows of a finished run can be worked.',
      );
    }

    const current = row.outcome ?? null;
    // Asking again for what is already done — a double click, or Continue in
    // a tab that had not seen the sale finish it — is the answer, unchanged.
    if (current?.status === 'done' && current.kind === dto.kind) {
      return this.assignments.assignedDetail(agencyId, row);
    }
    if (!row.needsReview || row.review.status !== 'open') {
      throw new ConflictException('This row has already been decided.');
    }
    // A held-open outcome a re-upload carried to the Dash line's new row is
    // Continued there, though that row — now matching the sale it booked —
    // offers its kind no more.
    const continuing = current?.kind === dto.kind && isHeldOpen(current);
    if (
      !continuing &&
      !reconciliationOutcomeKinds(row.tabs).includes(dto.kind)
    ) {
      const tab = primaryReconciliationTab(row.tabs);
      throw new BadRequestException({
        code: RECONCILIATION_OUTCOME_NOT_ALLOWED,
        message: `A row in ${tab ? RECONCILIATION_TAB_LABELS[tab] : 'this tab'} cannot be recorded as ${RECONCILIATION_OUTCOME_KIND_LABELS[dto.kind]}.`,
      });
    }
    // Checked on every call, not only at assignment: permissions can change
    // after the row was handed over.
    if (
      isSaleKind(dto.kind) &&
      !canRecordReconciliationSale(access.permissions)
    ) {
      throw new ForbiddenException({
        code: RECONCILIATION_OUTCOME_FORBIDDEN,
        message:
          'Recording this as a sale needs permission to create leads and record sales.',
      });
    }

    if (current?.kind === dto.kind) {
      return this.assignments.assignedDetail(
        agencyId,
        await this.resume(access, row, current, dto),
      );
    }
    // Switching kind is only for an outcome nothing has been booked on yet:
    // once the sale exists, the row is that sale's — including a sale on the
    // linked lead whose hook never stamped it here.
    if (
      current &&
      (current.step !== 'record_sale' ||
        current.dealId ||
        (await this.bookedSince(row)))
    ) {
      throw new ConflictException({
        code: RECONCILIATION_OUTCOME_LOCKED,
        message:
          'A sale is already booked on this row, so what it is recorded as cannot change. Finish it, or ask the owner to reopen the row.',
      });
    }

    const now = new Date();
    const started: RowOutcome = {
      kind: dto.kind,
      status: 'in_progress',
      step: 'record_sale',
      note: dto.note || null,
      // A lead made before switching kind is still the lead for this row.
      leadId: current?.leadId ?? null,
      dealId: null,
      policyId: null,
      householdId: null,
      replacementPolicyId: null,
      chargebackId: null,
      startedById: access.userId,
      startedAt: now,
      completedById: null,
      completedAt: null,
    };
    const updated = await this.writeOutcome(
      row,
      dto.kind === 'other' ? finished(started, access.userId, now) : started,
    );
    if (!updated) throw new ConflictException(CHANGED);
    // A sale already booked with the Dash line's policy — by a hook that
    // never ran, or before an owner's reopen cleared the outcome — is adopted
    // now rather than booked again.
    return this.assignments.assignedDetail(
      agencyId,
      dto.kind === 'other' ? updated : await this.catchUp(access, updated),
    );
  }

  /**
   * `POST /sold-deals` with a `reconciliationRowId`, **before** the sale is
   * booked: refuse a sale on a lead other than the one the row's sale is
   * under way on — a tab left open from an earlier attempt, say — so it never
   * finishes the row against someone else's lead. Anything that would make
   * the hook a no-op anyway (no such row, replaced, not the caller's, nothing
   * under way) is let through: the sale itself is never this module's to stop.
   */
  async assertSaleFitsRow(
    access: AccessContext,
    rowId: string,
    leadId: string,
  ): Promise<void> {
    const row = await this.currentRow(access, rowId);
    if (typeof row === 'string') return;
    const outcome = row.outcome;
    if (
      row.assignment?.userId === access.userId &&
      outcome?.status === 'in_progress' &&
      outcome.step === 'record_sale' &&
      !outcome.dealId &&
      outcome.leadId &&
      outcome.leadId !== leadId
    ) {
      throw new ConflictException({
        code: RECONCILIATION_SALE_WRONG_LEAD,
        message:
          'This Dash row’s sale is under way on another lead. Open the row from your list and choose Continue, so the sale is booked on its lead.',
      });
    }
  }

  /**
   * `POST /leads` with a `reconciliationRowId`, after the lead is created:
   * stamp it on the outcome, so resuming "record the sale" goes on to the
   * Sold form with this lead instead of opening a second one. Only while the
   * row is the caller's, at `record_sale`, with no lead yet.
   *
   * Best-effort and never throws — the lead is created either way, and a lead
   * left unlinked is found again by the sale it is booked with.
   */
  async linkLead(
    access: AccessContext,
    rowId: string,
    leadId: string,
  ): Promise<void> {
    try {
      // Twice at most: a re-upload that replaced the row between the read
      // and the write moved its outcome to the new copy, which is re-read.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const row = await this.currentRow(access, rowId);
        if (typeof row === 'string') {
          this.logger.warn(
            `Dash row ${rowId}: lead ${leadId} not linked — ${row}.`,
          );
          return;
        }
        const outcome = row.outcome;
        // The replacement's own lead, on a cancel rewrite: its sale is what
        // finishes the row, and the outcome keeps the original sale's lead.
        if (outcome?.step === 'write_replacement') return;
        if (outcome?.leadId === leadId) return;
        // A newer lead made for the row replaces an older one while nothing
        // is booked on it, so the Sold form opens on the lead just made.
        const linked = await this.rowModel.updateOne(
          {
            _id: row._id,
            agencyId: row.agencyId,
            'assignment.userId': access.userId,
            needsReview: true,
            'review.status': 'open',
            'outcome.status': 'in_progress',
            'outcome.step': 'record_sale',
            'outcome.dealId': null,
            'outcome.policyId': null,
            ...LIVE_ROW,
          },
          { $set: { 'outcome.leadId': leadId } },
        );
        if (linked.matchedCount) return;
        const replaced = await this.rowModel.exists({
          _id: row._id,
          supersededAt: { $type: 'date' },
        });
        if (!replaced) break;
      }
      this.logger.warn(
        `Dash row ${rowId}: lead ${leadId} not linked — the row is not the caller's, or has no sale under way that is still waiting for a lead.`,
      );
    } catch (error) {
      this.logger.warn(
        `Dash row ${rowId}: linking lead ${leadId} failed: ${String(error)}`,
      );
    }
  }

  /**
   * `POST /sold-deals` with a `reconciliationRowId`, after the sale commits —
   * on the replay path too. Moves the outcome on:
   *
   * - `sold` at `record_sale` → done, linking the lead, the deal, its
   *   household and the deal's policy that is the Dash line;
   * - `cancel_rewrite` at `record_sale` → the same links, then
   *   `write_replacement`;
   * - `cancel_rewrite` at `write_replacement`, for a deal with a policy that
   *   replaced the Dash policy (`transferredFromPolicyId`) → done, linking the
   *   replacement and the chargeback the rewrite wrote.
   *
   * Validates rather than trusts: the agency has the module on, the row (or
   * its current copy, when a re-upload replaced the page's) is assigned to
   * the seller, on a current run, waiting on a decision, with that step in
   * progress. Anything else is logged and left alone. Idempotent on the deal:
   * a replayed sale the outcome already carries changes nothing.
   *
   * **Never throws.** The sale is booked; failing its request now would tell
   * the producer it was not.
   */
  async recordSale(
    access: AccessContext,
    sale: ReconciliationSale,
  ): Promise<void> {
    try {
      const skipped = await this.applySale(access, sale);
      if (skipped) {
        this.logger.warn(
          `Dash row ${sale.rowId}: deal ${sale.dealId} not recorded — ${skipped}.`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Dash row ${sale.rowId}: recording deal ${sale.dealId} failed: ${String(error)}`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** {@link recordSale}'s work; returns why nothing was written, or `null`. */
  private async applySale(
    access: AccessContext,
    sale: ReconciliationSale,
  ): Promise<string | null> {
    // Twice at most: a re-upload that replaced the row between the read and
    // the write carried its outcome to the new copy, which is re-read.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const row = await this.currentRow(access, sale.rowId);
      if (typeof row === 'string') return row;
      const outcome = row.outcome;
      if (outcome?.dealId === sale.dealId) return null;
      if (row.assignment?.userId !== access.userId) {
        return 'the row is not assigned to the seller';
      }
      if (!row.needsReview || row.review.status !== 'open') {
        return 'the row has been decided';
      }
      if (outcome?.status !== 'in_progress' || !outcome.step) {
        return 'no sale is under way on it';
      }
      // The sale must be the one the row's outcome is under way on: its lead
      // (a cancel rewrite's replacement has a lead of its own, by design).
      if (
        outcome.step === 'record_sale' &&
        outcome.leadId &&
        outcome.leadId !== sale.leadId
      ) {
        return 'the sale is on another lead than the row’s';
      }
      const next = await this.afterSale(
        row,
        new Types.ObjectId(sale.dealId),
        access.userId,
      );
      if (typeof next === 'string') return next;
      if (await this.writeOutcome(row, next)) return null;
      const replaced = await this.rowModel.exists({
        _id: row._id,
        supersededAt: { $type: 'date' },
      });
      if (!replaced) break;
    }
    return 'the row changed while the sale was recorded';
  }

  /**
   * Resume an outcome already under way: keep or replace its note, then make
   * good a sale hook that never ran — the sale (at `record_sale`, on the
   * linked lead) or the replacement (at `write_replacement`, off the Dash
   * policy's `transferredToPolicyId`) booked since. Without this a sale whose
   * hook died after its commit would strand the row: the lead is Sold, and
   * the Sold form refuses a second sale on it.
   */
  private async resume(
    access: AccessContext,
    row: LeanRow,
    current: RowOutcome,
    dto: RecordOutcomeDto,
  ): Promise<LeanRow> {
    let resumed = row;
    const note = dto.note === undefined ? current.note : dto.note || null;
    if (note !== current.note) {
      const updated = await this.writeOutcome(row, { ...current, note });
      if (!updated) throw new ConflictException(CHANGED);
      resumed = updated;
    }
    return this.catchUp(access, resumed);
  }

  /**
   * Move an outcome on by whatever is booked already: the sale (at
   * `record_sale` — on the linked lead, or anywhere with the Dash line's
   * policy number) or the replacement (at `write_replacement`). At most twice:
   * a cancel rewrite whose sale and replacement were both booked while
   * neither hook ran.
   *
   * A sale booked for the row with no policy numbered as the Dash line is
   * kept on the outcome but goes no further: Continue answers 409
   * `RECONCILIATION_SALE_POLICY_UNMATCHED` until the number is corrected.
   */
  private async catchUp(access: AccessContext, row: LeanRow): Promise<LeanRow> {
    let at = row;
    for (let pass = 0; pass < 2; pass += 1) {
      const dealId = await this.bookedSince(at);
      if (!dealId) break;
      const next = await this.afterSale(at, dealId, access.userId);
      if (typeof next === 'string') {
        this.logger.warn(
          `Dash row ${String(row._id)}: deal ${String(dealId)} not recorded on resume — ${next}.`,
        );
        break;
      }
      if (isUnmatchedSale(next) && at.outcome?.dealId === next.dealId) {
        throw unmatchedSale(at);
      }
      const updated = await this.writeOutcome(at, next);
      if (!updated) throw new ConflictException(CHANGED);
      at = updated;
      if (isUnmatchedSale(next)) break;
    }
    return at;
  }

  /** The deal that booked the outcome's current step already, if any. */
  private async bookedSince(row: LeanRow): Promise<Types.ObjectId | null> {
    const outcome = row.outcome;
    if (outcome?.status !== 'in_progress') return null;
    if (outcome.step === 'record_sale') {
      // Held on its policy number: the same sale, checked again.
      if (outcome.dealId) return new Types.ObjectId(outcome.dealId);
      return (
        (await this.saleOnLead(row)) ?? (await this.saleWithDashPolicy(row))
      );
    }
    if (!outcome.policyId) return null;
    const original = await this.policyModel
      .findOne({
        _id: new Types.ObjectId(outcome.policyId),
        agencyId: row.agencyId,
      })
      .select('transferredToPolicyId')
      .lean<{ transferredToPolicyId: Types.ObjectId | null }>();
    if (!original?.transferredToPolicyId) return null;
    const replacement = await this.policyModel
      .findOne({ _id: original.transferredToPolicyId, agencyId: row.agencyId })
      .select('dealId')
      .lean<{ dealId?: Types.ObjectId }>();
    return replacement?.dealId ?? null;
  }

  /**
   * The sale on the outcome's lead: the one with a policy numbered as the
   * Dash line, else the newest one booked since the outcome started. An older
   * sale is not this row's — the lead may be a returning customer's.
   */
  private async saleOnLead(row: LeanRow): Promise<Types.ObjectId | null> {
    const outcome = row.outcome!;
    if (!outcome.leadId) return null;
    const deals = await this.dealModel
      .find({
        agencyId: row.agencyId,
        leadId: new Types.ObjectId(outcome.leadId),
        isTestRecord: { $ne: true },
      })
      .sort({ createdAt: -1, _id: -1 })
      .select('_id createdAt')
      .lean<{ _id: Types.ObjectId; createdAt?: Date }[]>();
    if (!deals.length) return null;
    const keyed = await this.dashPolicies(row, {
      dealId: { $in: deals.map((deal) => deal._id) },
    });
    if (keyed[0]?.dealId) return keyed[0].dealId;
    const since = deals.find(
      (deal) => deal.createdAt && deal.createdAt >= outcome.startedAt,
    );
    return since?._id ?? null;
  }

  /**
   * A sale anywhere in the agency that holds a policy numbered as the Dash
   * line — what a reopened row, or a hook that never ran, left booked. The
   * number is the proof it is this line's sale, so it is adopted instead of
   * booked a second time.
   */
  private async saleWithDashPolicy(
    row: LeanRow,
  ): Promise<Types.ObjectId | null> {
    const [policy] = await this.dashPolicies(row, { dealId: { $ne: null } });
    return policy?.dealId ?? null;
  }

  /**
   * The agency's live policies numbered as the row's Dash line, newest first.
   * `policyNumberKey` keeps a National General term suffix that the Dash key
   * drops, so the indexed lookup is by prefix and the key is checked here.
   */
  private async dashPolicies(
    row: LeanRow,
    where: Record<string, unknown>,
  ): Promise<{ _id: Types.ObjectId; dealId: Types.ObjectId | null }[]> {
    const dashKey = dashKeyOf(row);
    if (!dashKey) return [];
    const policies = await this.policyModel
      .find({
        agencyId: row.agencyId,
        isTestRecord: { $ne: true },
        policyNumberKey: { $regex: `^${escapeRegex(dashKey)}` },
        ...where,
      })
      .select('policyNumber dealId')
      .sort({ _id: -1 })
      .lean<
        {
          _id: Types.ObjectId;
          policyNumber?: string;
          dealId: Types.ObjectId | null;
        }[]
      >();
    return policies.filter(
      (policy) => reconciliationPolicyKey(policy.policyNumber) === dashKey,
    );
  }

  /**
   * What a booked deal makes of the row's outcome — the next outcome, or why
   * it makes nothing of it.
   *
   * The policy that is the Dash line is the deal's policy whose number keys
   * the same as Dash's (`reconciliationPolicyKey`): a deal entered for a Dash
   * row may carry other lines sold on the same visit. With none, the sale is
   * stamped on the outcome but goes no further (`isUnmatchedSale`) until the
   * number is corrected — a guess would link, and later cancel, the wrong
   * policy. Only a Dash line with no number at all takes the first policy.
   */
  private async afterSale(
    row: LeanRow,
    dealId: Types.ObjectId,
    by: string,
  ): Promise<RowOutcome | string> {
    const outcome = row.outcome!;
    const [deal, policies] = await Promise.all([
      this.dealModel
        .findOne({
          _id: dealId,
          agencyId: row.agencyId,
          isTestRecord: { $ne: true },
        })
        .select('leadId householdId')
        .lean<{
          _id: Types.ObjectId;
          leadId?: Types.ObjectId;
          householdId?: Types.ObjectId;
        }>(),
      this.policyModel
        .find({ agencyId: row.agencyId, dealId })
        .select('policyNumber transferredFromPolicyId')
        .sort({ _id: 1 })
        .lean<
          {
            _id: Types.ObjectId;
            policyNumber?: string;
            transferredFromPolicyId: Types.ObjectId | null;
          }[]
        >(),
    ]);
    if (!deal) return 'the deal is not this agency’s';
    const now = new Date();

    if (outcome.step === 'record_sale') {
      const dashKey = dashKeyOf(row);
      const dashPolicy = dashKey
        ? policies.find(
            (policy) =>
              reconciliationPolicyKey(policy.policyNumber) === dashKey,
          )
        : policies[0];
      const linked: RowOutcome = {
        ...outcome,
        leadId: deal.leadId ? String(deal.leadId) : outcome.leadId,
        dealId: String(deal._id),
        policyId: dashPolicy ? String(dashPolicy._id) : null,
        householdId: deal.householdId ? String(deal.householdId) : null,
      };
      if (!dashPolicy) return linked;
      return outcome.kind === 'cancel_rewrite'
        ? { ...linked, step: 'write_replacement' }
        : finished(linked, by, now);
    }

    // `write_replacement`: only the rewrite of the Dash policy finishes it.
    const replaced = outcome.policyId;
    const replacement = replaced
      ? policies.find(
          (policy) => String(policy.transferredFromPolicyId) === replaced,
        )
      : undefined;
    if (!replaced || !replacement) {
      return 'the deal does not replace the Dash policy';
    }
    const chargeback = await this.chargebackModel
      .findOne({
        agencyId: row.agencyId,
        policyId: new Types.ObjectId(replaced),
        reason: 'cancel_rewrite',
      })
      .select('_id')
      .lean<{ _id: Types.ObjectId }>();
    return finished(
      {
        ...outcome,
        replacementPolicyId: String(replacement._id),
        chargebackId: chargeback ? String(chargeback._id) : null,
      },
      by,
      now,
    );
  }

  /**
   * Write `next` over the outcome as read, or `null` if the row moved first —
   * decided, handed to someone else, or its outcome changed. A finished
   * outcome resolves the row in the same write.
   */
  private async writeOutcome(
    row: LeanRow,
    next: RowOutcome,
  ): Promise<LeanRow | null> {
    // An outcome a re-upload carried to a row whose own tabs no longer offer
    // its kind (the row now matches the sale it booked): finishing it answers
    // the Dash line, but not a question the new row asks of its own — a
    // premium the app and Dash disagree on stays open for the owner.
    const carried = !reconciliationOutcomeKinds(row.tabs).includes(next.kind);
    const resolves =
      next.status === 'done' && !(carried && asksForDecision(row.tabs));
    const resolved: StoredReview | null = resolves
      ? {
          status: 'resolved',
          resolution: RECONCILIATION_OUTCOME_RESOLUTION[next.kind],
          note: next.note,
          reviewedById: next.completedById,
          reviewedAt: next.completedAt,
          carriedForwardFromRowId: null,
        }
      : null;
    return this.rowModel
      .findOneAndUpdate(
        {
          _id: row._id,
          agencyId: row.agencyId,
          'assignment.userId': row.assignment?.userId,
          needsReview: true,
          'review.status': 'open',
          ...outcomeAsRead(row.outcome),
          // A row a re-upload replaced meanwhile was copied as it stood.
          ...LIVE_ROW,
        },
        {
          $set: resolved
            ? { outcome: next, review: resolved }
            : { outcome: next },
        },
        { new: true },
      )
      .lean<LeanRow>();
  }

  /**
   * The row a hook was handed, as the agency's current run has it — or why
   * there is none to write. The page may hold a row from an upload replaced
   * since; the current copy is the one that matters, and if it carries no
   * outcome the checks after this one say so.
   */
  private async currentRow(
    access: AccessContext,
    rowId: string,
  ): Promise<LeanRow | string> {
    const agencyId = access.agencyId;
    if (!agencyId) return 'no agency';
    const agency = await this.agencyModel
      .findById(agencyId)
      .select('modules')
      .lean<{ modules?: Record<string, { enabled?: boolean }> }>();
    if (agency?.modules?.[ModuleKey.CarrierReconciliation]?.enabled !== true) {
      return 'Dash Reconciliation is off for the agency';
    }
    const asked = await this.rowModel
      .findOne({ _id: new Types.ObjectId(rowId), agencyId })
      .lean<LeanRow>();
    if (!asked) return 'no such row in the agency';
    const row = await this.assignments.currentCopy(agencyId, asked);
    if (!row) return 'the latest upload no longer has the row';
    const run = await this.runModel
      .findOne(
        { _id: row.runId, agencyId },
        { status: 1, startedAt: 1, supersededByRunId: 1 },
      )
      .lean<Pick<LeanRun, 'status' | 'startedAt' | 'supersededByRunId'>>();
    if (
      !run ||
      run.status !== 'ready' ||
      isStale(run) ||
      run.supersededByRunId
    ) {
      return 'its upload is not the current one';
    }
    return row;
  }
}

function isSaleKind(kind: ReconciliationOutcomeKind): boolean {
  return (RECONCILIATION_SALE_OUTCOME_KINDS as readonly string[]).includes(
    kind,
  );
}

function finished(outcome: RowOutcome, by: string, at: Date): RowOutcome {
  return {
    ...outcome,
    status: 'done',
    step: null,
    completedById: by,
    completedAt: at,
  };
}

/** The row's Dash policy key, as matching computes it; `null` for a line with no number. */
function dashKeyOf(row: LeanRow): string | null {
  return (
    row.dash?.policyKey ||
    reconciliationPolicyKey(row.dash?.policyNumber) ||
    null
  );
}

/** A sale booked for the row, held at `record_sale` because none of its policies is the Dash line's number. */
function isUnmatchedSale(outcome: RowOutcome): boolean {
  return (
    outcome.status === 'in_progress' &&
    outcome.step === 'record_sale' &&
    !!outcome.dealId &&
    !outcome.policyId
  );
}

/** 409: Continue on a sale whose policy number is still not the Dash line's. */
function unmatchedSale(row: LeanRow): ConflictException {
  const number =
    row.dash?.policyNumber ?? row.dash?.policyKey ?? 'the Dash line';
  return new ConflictException({
    code: RECONCILIATION_SALE_POLICY_UNMATCHED,
    message: `None of the policies on the sale is numbered ${number}, as the Dash line is, so the row cannot be finished with it. Correct the policy number on the sale, then Continue.`,
  });
}
