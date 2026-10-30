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
  RECONCILIATION_CHARGEBACK_POLICY_UNMATCHED,
  RECONCILIATION_OUTCOME_FORBIDDEN,
  RECONCILIATION_OUTCOME_KIND_LABELS,
  RECONCILIATION_OUTCOME_LOCKED,
  RECONCILIATION_OUTCOME_NOT_ALLOWED,
  RECONCILIATION_OUTCOME_RESOLUTION,
  RECONCILIATION_SALE_OUTCOME_KINDS,
  RECONCILIATION_TAB_LABELS,
  canRecordReconciliationSale,
  canSetUpReconciliationService,
  primaryReconciliationTab,
  reconciliationOutcomeKinds,
  type AccessContext,
  type ReconciliationAssignedRowDetail,
  type ReconciliationCancelPolicyResponse,
  type ReconciliationOutcomeKind,
  type ReconciliationPresignResponse,
  type ReconciliationServiceIntakeOptions,
  type ReconciliationServiceIntakeResponse,
} from '@sfa/shared';
import { Types, type ClientSession, type Model } from 'mongoose';
import {
  Chargeback,
  type ChargebackDocument,
} from '../chargebacks/schemas/chargeback.schema';
import { ServicedPolicyIntakeService } from '../clients/serviced-policy-intake.service';
import { clientAgencyId } from '../common/access/client-scope';
import { TransactionRunner } from '../common/mongo/transaction.runner';
import {
  isPendingServiceIntake,
  type RowOutcome,
} from '../common/carrier-reconciliation/carry-forward';
import { reconciliationPolicyKey } from '../common/carrier-reconciliation/dash-file-reader';
import { asksForDecision } from '../common/carrier-reconciliation/reconcile';
import { reconciliationDocumentPurpose } from '../common/carrier-reconciliation/reconciliation-file-types';
import { Deal, type DealDocument } from '../deals/schemas/deal.schema';
import { Agency, type AgencyDocument } from '../platform/schemas/agency.schema';
import type { ContactFieldConflict } from '../leads/intake/intake.types';
import { PoliciesService } from '../policies/policies.service';
import { normalizePolicyNumber } from '../policies/policy-number';
import { toPolicySummary } from '../policies/policy-view';
import { Policy, type PolicyDocument } from '../policies/schemas/policy.schema';
import { SoldSubmissionValidator } from '../sold-deals/intake/sold-submission.validator';
import { StorageService } from '../storage/storage.service';
import type {
  CancelRowPolicyDto,
  PresignRowDocumentDto,
  RecordOutcomeDto,
  ServiceIntakeDto,
} from './dto/carrier-reconciliation.dto';
import {
  handOffClaimed,
  noLiveHandOffClaim,
  outcomeAsRead,
} from './outcome-filters';
import { ReconciliationAssignmentsService } from './reconciliation-assignments.service';
import {
  isStale,
  serviceIntakeOpeningNote,
  type LeanRow,
  type LeanRun,
} from './reconciliation-views';
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
 * rewrite**, **Chargeback** (PR 6), **Service intake** (PR 5) or **Other**.
 *
 * - **Other** is a note, and finishes the row at once.
 * - **Sold** starts at `record_sale`: the assignee enters the Dash line as an
 *   ordinary sale — New Lead, then Sold, both prefilled — and the sale
 *   finishes it, linking the lead, the deal and the deal's policy that is the
 *   Dash line.
 * - **Cancel rewrite** starts the same way; booking the sale moves it to
 *   `write_replacement`, and the replacement, written through the normal
 *   cancel-rewrite chain (which writes the chargeback), finishes it.
 * - **Chargeback** starts the same way too; booking the sale moves it to
 *   `cancel_policy`, and {@link cancelPolicy} — the household page's Cancel
 *   dialog, with **Record a chargeback** ticked and the carrier's cancellation
 *   date — cancels that policy, writes the chargeback and finishes the row, all
 *   in one transaction.
 * - **Service intake** — a 1-800 policy the app does not have — is one form
 *   ({@link serviceIntake}): the household, a `carrier_direct` policy with no
 *   deal, and the outcome at `start_onboarding` commit together; the CSR's
 *   welcome call opens after, and finishes it. Never a sale.
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
    private readonly intake: ServicedPolicyIntakeService,
    private readonly validator: SoldSubmissionValidator,
    private readonly storage: StorageService,
    /** A Chargeback's cancel (PAC-173 PR 6) — the household page's own. */
    private readonly policies: PoliciesService,
    private readonly transactions: TransactionRunner,
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
    // A pending service intake is Continued wherever its row now is — one a
    // re-upload carried onto a matched row included.
    const continuing =
      dto.kind === 'service_intake' && isPendingServiceIntake(current);
    if (!continuing && !reconciliationOutcomeKinds(row).includes(dto.kind)) {
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
    if (dto.kind === 'service_intake') {
      assertCanSetUpService(access);
      // Continue: the household and policy are saved, the welcome call is not
      // open yet. Anything else starts from the form, which carries the client.
      if (current?.kind === 'service_intake') {
        await this.assertCrmServiceOn(agencyId);
        const { row: handedOff } = await this.finishHandOff(access.userId, row);
        return this.assignments.assignedDetail(agencyId, handedOff);
      }
      if (!current) {
        throw new BadRequestException({
          code: RECONCILIATION_OUTCOME_NOT_ALLOWED,
          message:
            'Set up for service runs from its form, which records the client and the policy.',
        });
      }
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
          current.kind === 'service_intake'
            ? 'This policy is already set up for service, so what the row is recorded as cannot change. Continue to open its welcome call, or ask the owner to reopen the row.'
            : 'A sale is already booked on this row, so what it is recorded as cannot change. Finish it, or ask the owner to reopen the row.',
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
    return this.assignments.assignedDetail(agencyId, updated);
  }

  // -------------------------------------------------------------------------
  // Chargeback — cancel the policy the sale booked (PAC-173 PR 6)
  // -------------------------------------------------------------------------

  /**
   * `POST carrier-reconciliation/assigned/:rowId/cancel-policy` — a Chargeback
   * outcome's second step. Its sale is booked (`cancel_policy`, with the
   * Dash policy linked); this cancels that policy as the household page's
   * Cancel button does, with the chargeback, dated on **the carrier's**
   * cancellation date, which decides the one-month clawback window
   * (`PoliciesService.applyCancellation`). The cancel, the ledger row and the
   * outcome finished — the row resolved `chargeback_recorded` — commit in
   * **one transaction**: a policy cancelled with the row still waiting would
   * be one nobody can cancel again, and a row resolved over a policy still on
   * the books would say a chargeback exists that does not.
   *
   * The assignee's, on a row of a current run still waiting on a decision, and
   * held to the sale kinds' permission (`canRecordReconciliationSale`) like
   * the sale before it. A row already finished as a chargeback answers
   * unchanged — a double click. A policy already cancelled **with** a
   * cancellation chargeback (from the household page, box ticked) finishes the
   * row with that one; already off the books **without** one is a 409, since
   * a second cancel cannot add it — the owner decides the row by hand.
   *
   * It cancels only a policy numbered as the Dash line. A sale whose policies
   * carry another number linked none (`dashLinePolicy`): a 409
   * `RECONCILIATION_CHARGEBACK_POLICY_UNMATCHED` until the number is corrected
   * on the sale, when this — or Continue — links it.
   */
  async cancelPolicy(
    access: AccessContext,
    rowId: string,
    dto: CancelRowPolicyDto,
  ): Promise<ReconciliationCancelPolicyResponse> {
    const { agencyId, row } = await this.workableRow(access, rowId);
    const current = row.outcome ?? null;
    if (current?.kind === 'chargeback' && current.status === 'done') {
      return this.cancelResponse(agencyId, row);
    }
    if (!row.needsReview || row.review.status !== 'open') {
      throw new ConflictException('This row has already been decided.');
    }
    if (current?.kind !== 'chargeback') {
      throw new BadRequestException({
        code: RECONCILIATION_OUTCOME_NOT_ALLOWED,
        message: current
          ? `This row is being recorded as ${RECONCILIATION_OUTCOME_KIND_LABELS[current.kind]}, not a chargeback.`
          : 'Record this row as a Chargeback first: its sale is booked, then cancelled here.',
      });
    }
    if (current.step !== 'cancel_policy') {
      throw new ConflictException(
        'Book the sale first — the policy this cancels is the one the sale records.',
      );
    }
    if (!canRecordReconciliationSale(access.permissions)) {
      throw new ForbiddenException({
        code: RECONCILIATION_OUTCOME_FORBIDDEN,
        message:
          'Recording a chargeback needs permission to create leads and record sales.',
      });
    }

    // The sale linked no policy numbered as the Dash line: the number was
    // corrected since, or it never will be — never cancel a guess.
    const linkedRow = await this.linkChargebackPolicy(row);
    const linked = linkedRow.outcome!;
    if (!linked.policyId) throw unmatchedChargebackPolicy(linkedRow);

    const already = await this.cancelledSince(linkedRow);
    if (already) {
      const updated = await this.writeOutcome(
        linkedRow,
        finished(
          { ...linked, chargebackId: already },
          access.userId,
          new Date(),
        ),
      );
      if (!updated) throw new ConflictException(CHANGED);
      return this.cancelResponse(agencyId, updated);
    }

    const policyId = linked.policyId;
    const now = new Date();
    const { applied, updated } = await this.transactions.run(
      async (session) => {
        const cancelled = await this.policies.applyCancellation(
          access,
          { agencyId, policyId },
          {
            reason: dto.reason,
            note: dto.note,
            chargeback: { cancelledOn: dto.cancelledOn },
          },
          session,
        );
        const written = await this.writeOutcome(
          linkedRow,
          finished(
            { ...linked, chargebackId: String(cancelled.chargeback!._id) },
            access.userId,
            now,
          ),
          session,
        );
        // Moved first — decided, reassigned, taken back: nothing is cancelled.
        if (!written) throw new ConflictException(CHANGED);
        return { applied: cancelled, updated: written };
      },
    );
    await this.policies.finishCancellation(access, applied);
    return {
      row: await this.assignments.assignedDetail(agencyId, updated),
      policy: toPolicySummary(applied.policy),
    };
  }

  /** {@link cancelPolicy}'s answer for a row whose policy is already cancelled. */
  private async cancelResponse(
    agencyId: string,
    row: LeanRow,
  ): Promise<ReconciliationCancelPolicyResponse> {
    const policyId = row.outcome?.policyId;
    const policy = policyId
      ? await this.policyModel
          .findOne({ _id: new Types.ObjectId(policyId), agencyId })
          .lean<Policy & { _id: Types.ObjectId }>()
      : null;
    if (!policy) {
      throw new NotFoundException('The policy this row booked is gone.');
    }
    return {
      row: await this.assignments.assignedDetail(agencyId, row),
      policy: toPolicySummary(policy),
    };
  }

  /**
   * The cancellation chargeback already on a Chargeback outcome's policy,
   * waiting at `cancel_policy` — cancelled from the household page with the
   * box ticked rather than from the row — so the outcome finishes with it.
   * Only a `cancellation` row counts: a rewrite's chargeback is another story.
   */
  private async cancelledSince(row: LeanRow): Promise<string | null> {
    const outcome = row.outcome;
    if (
      outcome?.kind !== 'chargeback' ||
      outcome.status !== 'in_progress' ||
      outcome.step !== 'cancel_policy' ||
      !outcome.policyId
    ) {
      return null;
    }
    const policy = await this.policyModel
      .findOne({
        _id: new Types.ObjectId(outcome.policyId),
        agencyId: row.agencyId,
      })
      .select('cancellation.chargebackId')
      .lean<{ cancellation?: { chargebackId?: Types.ObjectId } }>();
    const chargebackId = policy?.cancellation?.chargebackId;
    if (!chargebackId) return null;
    const chargeback = await this.chargebackModel
      .findOne({
        _id: chargebackId,
        agencyId: row.agencyId,
        reason: 'cancellation',
      })
      .select('_id')
      .lean<{ _id: Types.ObjectId }>();
    return chargeback ? String(chargeback._id) : null;
  }

  /**
   * A Chargeback at `cancel_policy` whose sale linked no policy — none of the
   * deal's policies was numbered as the Dash line (`dashLinePolicy`): link the
   * one that is now, after the assignee corrected the number on the sale.
   * Answers the row as it stands, linked or not.
   */
  private async linkChargebackPolicy(row: LeanRow): Promise<LeanRow> {
    const outcome = row.outcome;
    if (
      outcome?.kind !== 'chargeback' ||
      outcome.status !== 'in_progress' ||
      outcome.step !== 'cancel_policy' ||
      outcome.policyId ||
      !outcome.dealId
    ) {
      return row;
    }
    const policies = await this.policyModel
      .find({
        agencyId: row.agencyId,
        dealId: new Types.ObjectId(outcome.dealId),
      })
      .select('policyNumber')
      .sort({ _id: 1 })
      .lean<{ _id: Types.ObjectId; policyNumber?: string }[]>();
    const policy = dashLinePolicy(row, outcome.kind, policies);
    if (!policy) return row;
    const updated = await this.writeOutcome(row, {
      ...outcome,
      policyId: String(policy._id),
    });
    if (!updated) throw new ConflictException(CHANGED);
    return updated;
  }

  // -------------------------------------------------------------------------
  // Service intake — a 1-800 policy set up for service (PAC-173 PR 5)
  // -------------------------------------------------------------------------

  /**
   * `POST carrier-reconciliation/assigned/:rowId/documents/presign` — where
   * the service intake's signed application goes: under the row, PDF only.
   * The assignee's, on a row of a current run that still waits on a decision
   * and offers a service intake, and only with `leads:write` — the intake's
   * own gates, so nothing is uploaded for a row it would refuse.
   */
  async presignDocument(
    access: AccessContext,
    rowId: string,
    dto: PresignRowDocumentDto,
  ): Promise<ReconciliationPresignResponse> {
    const { agencyId, row } = await this.workableRow(access, rowId);
    if (!row.needsReview || row.review.status !== 'open') {
      throw new ConflictException('This row has already been decided.');
    }
    assertOffersServiceIntake(row);
    assertCanSetUpService(access);
    const key = this.storage.buildObjectKey({
      agencyId,
      purpose: reconciliationDocumentPurpose(String(row._id)),
      filename: dto.filename,
    });
    return this.storage.createPresignedUpload(key, dto.contentType);
  }

  /**
   * `GET carrier-reconciliation/assigned/:rowId/service-intake/options` — the
   * CSRs the welcome call can go to. Served on the row because a Producer
   * holds no `crm_service:read` to ask the ticket picker; it is that picker's
   * pool, branch-clamped the same way.
   */
  async serviceIntakeOptions(
    access: AccessContext,
    rowId: string,
  ): Promise<ReconciliationServiceIntakeOptions> {
    const { row } = await this.assigneeRow(access, rowId);
    assertOffersServiceIntake(row);
    assertCanSetUpService(access);
    return { assignees: await this.intake.assignableCsrs(access) };
  }

  /**
   * `POST carrier-reconciliation/assigned/:rowId/service-intake` — set the
   * 1-800 policy up for service: the household (captured as a lead's), a
   * `carrier_direct` policy with its signed application and no deal, then the
   * CSR's welcome call. Never a sale.
   *
   * The household, the policy and the row's outcome (at `start_onboarding`)
   * commit in one transaction, the outcome last; the welcome call opens after
   * it, because `startOnboarding` takes no session, and that finishes the
   * outcome. If opening it fails, the answer still says what was saved
   * (`onboardingId: null`), and Continue opens it.
   *
   * Refused before anything is written: a row not the caller's (404), not on
   * a current finished run or already decided (409), not a Dash-only 1-800
   * row (400), without `leads:write` (403), with CRM service off (409), whose
   * number is already on a sale in the app (409 — the row is stale), a number
   * the carrier's format rejects, an application not uploaded under this row
   * or not a PDF, or a CSR outside the pool (400).
   */
  async serviceIntake(
    access: AccessContext,
    branchId: string | null,
    rowId: string,
    dto: ServiceIntakeDto,
  ): Promise<ReconciliationServiceIntakeResponse> {
    const { agencyId, row } = await this.workableRow(access, rowId);
    const current = row.outcome ?? null;
    if (current?.kind === 'service_intake' && current.status === 'done') {
      throw new ConflictException('This policy is already set up for service.');
    }
    if (!row.needsReview || row.review.status !== 'open') {
      throw new ConflictException('This row has already been decided.');
    }
    if (!isPendingServiceIntake(current)) assertOffersServiceIntake(row);
    assertCanSetUpService(access);
    await this.assertCrmServiceOn(agencyId);
    if (current?.kind === 'service_intake') {
      // Saved before, welcome call not open: the form has nothing to add.
      const { row: handedOff, handed } = await this.finishHandOff(
        access.userId,
        row,
      );
      return this.intakeResponse(agencyId, handedOff, {
        householdId: current.householdId ?? '',
        policyId: current.policyId ?? '',
        handed,
      });
    }
    if (current) {
      throw new ConflictException({
        code: RECONCILIATION_OUTCOME_LOCKED,
        message: `This row is already being recorded as ${RECONCILIATION_OUTCOME_KIND_LABELS[current.kind]}.`,
      });
    }

    const carrier =
      (await this.assignments.carrierNameOfRun(agencyId, row.runId)) ??
      'Allstate';
    // The policy is the Dash line's: another number would leave this line
    // unmatched and could make a different line read as set up for service.
    if (
      row.dash?.policyKey &&
      reconciliationPolicyKey(dto.policy.policyNumber) !== row.dash.policyKey
    ) {
      throw new BadRequestException(
        `The policy number has to be this Dash line's (${row.dash.policyNumber ?? row.dash.policyKey}).`,
      );
    }
    const numberKey = normalizePolicyNumber(dto.policy.policyNumber);
    if (numberKey) {
      const booked = await this.policyModel
        .findOne({
          agencyId,
          policyNumberKey: numberKey,
          dealId: { $ne: null },
          isTestRecord: { $ne: true },
        })
        .select('_id')
        .lean<{ _id: Types.ObjectId }>();
      if (booked) {
        throw new ConflictException(
          `Policy ${dto.policy.policyNumber} is already on a sale in the app, and a 1-800 policy is never a sale. Record Other, and tell the owner.`,
        );
      }
    }
    await this.validator.assertPolicyNumberFormat(agencyId, {
      carrier,
      policyNumber: dto.policy.policyNumber,
    });
    const application = { ...dto.policy.newBusinessApplication };
    await this.validator.verifyDocument(application, {
      agencyId,
      purpose: reconciliationDocumentPurpose(String(row._id)),
      kind: 'new_business_application',
    });
    const csr = (await this.intake.assignableCsrs(access)).find(
      (person) => person.id === dto.assignedCsrId,
    );
    if (!csr) {
      throw new BadRequestException(
        'The welcome call can go only to an active CSR or CRM you can assign tickets to.',
      );
    }

    let saved: LeanRow | null = null;
    const startedAt = new Date();
    const result = await this.intake.create(
      access,
      branchId,
      {
        householdId: dto.householdId ?? null,
        primaryContact: dto.primaryContact,
        address: dto.address,
        members: dto.members,
        policy: {
          policyNumber: dto.policy.policyNumber,
          policyType: dto.policy.policyType,
          carrier,
          premium: dto.policy.premium,
          itemCount: dto.policy.itemCount,
          effectiveDate: dto.policy.effectiveDate,
          newBusinessApplication: application,
        },
        csrId: csr.id,
      },
      {
        beforeCommit: async (session, created) => {
          saved = await this.writeOutcome(
            row,
            {
              kind: 'service_intake',
              status: 'in_progress',
              step: 'start_onboarding',
              // The welcome call's opening line — what the assignee wrote,
              // plus any contact detail the form gave that differs from the
              // one on file (never applied). Kept here, inside the commit, so
              // a retried hand-off opens the call with all of it.
              note:
                [
                  openingNoteFor(row, dto.openingNote),
                  ...created.conflicts.map(conflictLine),
                ].join('\n\n') || null,
              leadId: null,
              dealId: null,
              policyId: String(created.policyId),
              householdId: String(created.householdId),
              replacementPolicyId: null,
              chargebackId: null,
              csrId: csr.id,
              onboardingId: null,
              ticketId: null,
              startedById: access.userId,
              startedAt,
              completedById: null,
              completedAt: null,
            },
            session,
          );
          // Moved first — decided, reassigned, recorded: nothing is created.
          if (!saved) throw new ConflictException(CHANGED);
        },
      },
    );

    const { row: handedOff, handed } = await this.finishHandOff(
      access.userId,
      saved!,
    );
    // Said from what this request created, not from the row re-read: the
    // owner may have moved the row in between, and the client, the policy and
    // (usually) the welcome call exist either way.
    return this.intakeResponse(agencyId, handedOff, {
      householdId: String(result.householdId),
      policyId: String(result.policyId),
      handed,
    });
  }

  /**
   * Before the owner decides, reassigns or takes back a row (PAC-173 PR 5):
   * a service intake on it still waiting at `start_onboarding` has its
   * household and policy saved already, so its welcome call is opened first
   * — clearing the outcome instead would leave them linked to nothing, and
   * let the next person set the same policy up again. Best-effort; a no-op
   * for any other row, and while CRM service is off.
   *
   * A 409 while someone else is opening that call: the owner's action would
   * clear the outcome under them. Their write, or the claim lapsing, ends it.
   */
  async settlePendingHandOff(agencyId: string, rowId: string): Promise<void> {
    if (!Types.ObjectId.isValid(rowId)) return;
    const row = await this.rowModel
      .findOne({
        _id: new Types.ObjectId(rowId),
        agencyId,
        'outcome.kind': 'service_intake',
        'outcome.status': 'in_progress',
        'outcome.step': 'start_onboarding',
      })
      .lean<LeanRow>();
    if (!row || !(await this.assignments.crmServiceOn(agencyId))) return;
    const { row: now } = await this.finishHandOff(
      row.outcome!.startedById,
      row,
    );
    if (handOffClaimed(now.outcome)) {
      throw new ConflictException(
        'The welcome call for this row is being opened right now. Try again in a moment.',
      );
    }
  }

  /**
   * A re-upload is about to replace `runId` (PAC-173 PR 5): open the welcome
   * call of every service intake on it still waiting at `start_onboarding`,
   * so the finished outcome carries to the new row — which now matches the
   * policy the intake created, needs no decision, and could never be
   * Continued. Best-effort, per row; returns how many it finished.
   */
  async finishPendingHandOffs(
    agencyId: string,
    runId: Types.ObjectId,
  ): Promise<number> {
    const pending = await this.rowModel
      .find({
        agencyId,
        runId,
        'outcome.kind': 'service_intake',
        'outcome.status': 'in_progress',
        'outcome.step': 'start_onboarding',
      })
      .lean<LeanRow[]>();
    let finishedCount = 0;
    for (const row of pending) {
      // On the assignee's behalf: they set it up, and Continue would have
      // been theirs. Skipped while CRM service is off, as Continue is.
      if (!(await this.assignments.crmServiceOn(agencyId))) break;
      const { handed } = await this.finishHandOff(
        row.outcome!.startedById,
        row,
      );
      if (handed) finishedCount += 1;
    }
    return finishedCount;
  }

  /**
   * Open the welcome call for a service intake saved at `start_onboarding`,
   * and finish the outcome with it — by `actorId`, the caller (or, for an
   * upload finishing it, the assignee who started it).
   *
   * Never throws: the household and the policy are saved either way, and a
   * failure leaves the row where Continue retries it. Returns the row as it
   * now stands, and what was opened (`handed`, `null` when nothing was) —
   * which can be open even when the row moved before it was recorded.
   */
  private async finishHandOff(
    actorId: string,
    row: LeanRow,
  ): Promise<{
    row: LeanRow;
    handed: { onboardingId: string; ticketId: string } | null;
  }> {
    const outcome = row.outcome;
    if (
      outcome?.kind !== 'service_intake' ||
      outcome.status !== 'in_progress' ||
      !outcome.householdId ||
      !outcome.policyId
    ) {
      return { row, handed: null };
    }
    // One opener at a time: the assignee's own request, a Continue, the
    // owner's action and an upload can all reach a pending row at once, and
    // `startOnboarding` dedupes only on a deal. The claim is timed, so one a
    // crash left behind lapses; a failure releases it below.
    const claimedAt = new Date();
    const claimed = await this.rowModel
      .findOneAndUpdate(
        {
          _id: row._id,
          agencyId: row.agencyId,
          ...outcomeAsRead(outcome),
          ...noLiveHandOffClaim(claimedAt),
        },
        { $set: { 'outcome.handOffAt': claimedAt } },
        { new: true },
      )
      .lean<LeanRow>();
    if (!claimed) {
      const now =
        (await this.rowModel
          .findOne({ _id: row._id, agencyId: row.agencyId })
          .lean<LeanRow>()) ?? row;
      return { row: now, handed: null };
    }
    let handed: { onboardingId: string; ticketId: string } | null = null;
    try {
      handed = await this.intake.handOff({
        agencyId: row.agencyId,
        householdId: outcome.householdId,
        policyId: outcome.policyId,
        csrId: outcome.csrId ?? null,
        salesProducerName: row.dash?.bindId
          ? `Allstate 1-800 (${row.dash.bindId})`
          : 'Allstate 1-800',
        openingNote: outcome.note ?? '',
        createdByUserId: actorId,
      });
      const done = await this.writeOutcome(claimed, {
        ...finished(outcome, actorId, new Date()),
        onboardingId: handed.onboardingId,
        ticketId: handed.ticketId,
        handOffAt: null,
      });
      if (done) return { row: done, handed };
      // Decided, reassigned or reopened in between: the welcome call is open
      // and no row links it — the sale hook's logged no-op, in kind.
      this.logger.warn(
        `Dash row ${String(row._id)}: welcome call ${handed.ticketId} opened, but the row changed before it was recorded.`,
      );
    } catch (error) {
      this.logger.warn(
        `Dash row ${String(row._id)}: opening the welcome call failed; Continue retries it — ${String(error)}`,
      );
      await this.rowModel.updateOne(
        {
          _id: row._id,
          agencyId: row.agencyId,
          'outcome.handOffAt': claimedAt,
        },
        { $set: { 'outcome.handOffAt': null } },
      );
    }
    const now =
      (await this.rowModel
        .findOne({ _id: row._id, agencyId: row.agencyId })
        .lean<LeanRow>()) ?? row;
    return { row: now, handed };
  }

  /**
   * The intake's answer. The ids are what the request created and opened; the
   * row is the caller's view of it, or `null` once it is not theirs to see —
   * the owner took it back between the commit and the hand-off.
   */
  private async intakeResponse(
    agencyId: string,
    row: LeanRow,
    made: {
      householdId: string;
      policyId: string;
      handed: { onboardingId: string; ticketId: string } | null;
    },
  ): Promise<ReconciliationServiceIntakeResponse> {
    let view: ReconciliationAssignedRowDetail | null = null;
    try {
      view = await this.assignments.assignedDetail(agencyId, row);
    } catch (error) {
      if (!(error instanceof NotFoundException)) throw error;
    }
    return {
      householdId: made.householdId,
      policyId: made.policyId,
      onboardingId: made.handed?.onboardingId ?? null,
      ticketId: made.handed?.ticketId ?? null,
      row: view,
    };
  }

  /** 409 while the agency has CRM service off: no welcome call can open. */
  private async assertCrmServiceOn(agencyId: string): Promise<void> {
    if (await this.assignments.crmServiceOn(agencyId)) return;
    throw new ConflictException(
      'CRM service is off for this agency, so no welcome call can be opened. Record Other, or ask the owner to turn it on.',
    );
  }

  /** The caller's own row — 404 for anyone else's. */
  private async assigneeRow(
    access: AccessContext,
    rowId: string,
  ): Promise<{ agencyId: string; row: LeanRow }> {
    const agencyId = clientAgencyId(access);
    const row = await this.rowModel
      .findOne({ _id: new Types.ObjectId(rowId), agencyId })
      .lean<LeanRow>();
    if (!row || row.assignment?.userId !== access.userId) {
      throw new NotFoundException('That row is not assigned to you.');
    }
    return { agencyId, row };
  }

  /** {@link assigneeRow}, on a current, finished run — what every write needs. */
  private async workableRow(
    access: AccessContext,
    rowId: string,
  ): Promise<{ agencyId: string; row: LeanRow }> {
    const { agencyId, row } = await this.assigneeRow(access, rowId);
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
    return { agencyId, row };
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
      const linked = await this.rowModel.updateOne(
        {
          _id: row._id,
          agencyId: row.agencyId,
          'assignment.userId': access.userId,
          needsReview: true,
          'review.status': 'open',
          'outcome.status': 'in_progress',
          'outcome.step': 'record_sale',
          'outcome.leadId': null,
        },
        { $set: { 'outcome.leadId': leadId } },
      );
      if (!linked.matchedCount) {
        this.logger.warn(
          `Dash row ${rowId}: lead ${leadId} not linked — the row is not the caller's, or has no sale under way waiting for a lead.`,
        );
      }
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
   *   replacement and the chargeback the rewrite wrote;
   * - `chargeback` at `record_sale` → the same links, then `cancel_policy`,
   *   which no sale moves on: {@link cancelPolicy} does.
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
    if (
      outcome?.status !== 'in_progress' ||
      !outcome.step ||
      !isSaleKind(outcome.kind)
    ) {
      return 'no sale is under way on it';
    }
    const next = await this.afterSale(
      row,
      new Types.ObjectId(sale.dealId),
      access.userId,
    );
    if (typeof next === 'string') return next;
    return (await this.writeOutcome(row, next))
      ? null
      : 'the row changed while the sale was recorded';
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
    // At most twice: a cancel rewrite whose sale and replacement were both
    // booked while neither hook ran.
    for (let pass = 0; pass < 2; pass += 1) {
      const dealId = await this.bookedSince(resumed);
      if (!dealId) break;
      const next = await this.afterSale(resumed, dealId, access.userId);
      if (typeof next === 'string') {
        this.logger.warn(
          `Dash row ${String(row._id)}: deal ${String(dealId)} not recorded on resume — ${next}.`,
        );
        break;
      }
      const updated = await this.writeOutcome(resumed, next);
      if (!updated) throw new ConflictException(CHANGED);
      resumed = updated;
    }
    // A chargeback whose sale linked no policy numbered as the Dash line:
    // link the one that is now.
    resumed = await this.linkChargebackPolicy(resumed);
    // A chargeback whose policy was cancelled, with its chargeback, from the
    // household page rather than from the row: that finishes it too.
    const chargebackId = await this.cancelledSince(resumed);
    if (chargebackId) {
      const updated = await this.writeOutcome(
        resumed,
        finished(
          { ...resumed.outcome!, chargebackId },
          access.userId,
          new Date(),
        ),
      );
      if (!updated) throw new ConflictException(CHANGED);
      resumed = updated;
    }
    return resumed;
  }

  /** The deal that booked the outcome's current step already, if any. */
  private async bookedSince(row: LeanRow): Promise<Types.ObjectId | null> {
    const outcome = row.outcome;
    if (outcome?.status !== 'in_progress' || !isSaleKind(outcome.kind)) {
      return null;
    }
    if (outcome.step === 'record_sale') {
      if (!outcome.leadId || outcome.dealId) return null;
      // The lead was made for this row (`POST /leads` skips the address
      // dedupe when it carries one), so any sale on it is this sale.
      const deal = await this.dealModel
        .findOne({
          agencyId: row.agencyId,
          leadId: new Types.ObjectId(outcome.leadId),
        })
        .sort({ createdAt: -1, _id: -1 })
        .select('_id')
        .lean<{ _id: Types.ObjectId }>();
      return deal?._id ?? null;
    }
    // Only a replacement moves a step on after the sale; a chargeback's
    // `cancel_policy` waits on a cancellation (`cancelledSince`).
    if (outcome.step !== 'write_replacement' || !outcome.policyId) return null;
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
   * What a booked deal makes of the row's outcome — the next outcome, or why
   * it makes nothing of it.
   *
   * The policy that is the Dash line is `dashLinePolicy`'s: the deal's policy
   * whose number keys the same as Dash's — a deal entered for a Dash row may
   * carry other lines sold on the same visit — else, except for a Chargeback,
   * its first.
   */
  private async afterSale(
    row: LeanRow,
    dealId: Types.ObjectId,
    by: string,
  ): Promise<RowOutcome | string> {
    const outcome = row.outcome!;
    const [deal, policies] = await Promise.all([
      this.dealModel
        .findOne({ _id: dealId, agencyId: row.agencyId })
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
      const dashPolicy = dashLinePolicy(row, outcome.kind, policies);
      const linked: RowOutcome = {
        ...outcome,
        leadId: deal.leadId ? String(deal.leadId) : outcome.leadId,
        dealId: String(deal._id),
        policyId: dashPolicy ? String(dashPolicy._id) : null,
        householdId: deal.householdId ? String(deal.householdId) : null,
      };
      if (outcome.kind === 'cancel_rewrite') {
        return { ...linked, step: 'write_replacement' };
      }
      // A chargeback cancels what it just booked, from the row
      // (`cancelPolicy`).
      if (outcome.kind === 'chargeback') {
        return { ...linked, step: 'cancel_policy' };
      }
      return finished(linked, by, now);
    }
    if (outcome.step !== 'write_replacement') {
      return 'the outcome waits on its policy being cancelled, not on a sale';
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
   *
   * Except a service intake finished on a row a re-upload carried it to that
   * asks something besides 1-800 (PAC-173 PR 5) — a premium the app and Dash
   * now disagree on. The intake answers only whether the agency services the
   * policy, so that question stays open for the owner, as it would had the
   * intake been done before the upload (`servicedSince`).
   */
  private async writeOutcome(
    row: LeanRow,
    next: RowOutcome,
    session: ClientSession | null = null,
  ): Promise<LeanRow | null> {
    const resolves =
      next.status === 'done' &&
      !(
        next.kind === 'service_intake' &&
        asksForDecision(row.tabs, 'review_1800')
      );
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
    // A pending service intake held the row asking; past it, the row asks
    // what its own tabs do.
    const asking =
      isPendingServiceIntake(row.outcome) && !isPendingServiceIntake(next)
        ? { needsReview: asksForDecision(row.tabs) }
        : {};
    return this.rowModel
      .findOneAndUpdate(
        {
          _id: row._id,
          agencyId: row.agencyId,
          // A row work release took back keeps a pending service intake
          // (PAC-173 PR 5) with nobody on it; the owner deciding or handing
          // the row on, or a same-period re-upload, finishes it.
          ...(row.assignment
            ? { 'assignment.userId': row.assignment.userId }
            : { assignment: null }),
          needsReview: true,
          'review.status': 'open',
          ...outcomeAsRead(row.outcome),
        },
        {
          $set: resolved
            ? { outcome: next, review: resolved, ...asking }
            : { outcome: next, ...asking },
        },
        { new: true },
      )
      .session(session)
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

/** 400 unless the row offers a service intake — a Dash-only 1-800 line. */
function assertOffersServiceIntake(row: LeanRow): void {
  if (reconciliationOutcomeKinds(row).includes('service_intake')) return;
  const tab = primaryReconciliationTab(row.tabs);
  throw new BadRequestException({
    code: RECONCILIATION_OUTCOME_NOT_ALLOWED,
    message: `A row in ${tab ? RECONCILIATION_TAB_LABELS[tab] : 'this tab'} cannot be set up for service: only a 1-800 policy the app does not have can.`,
  });
}

/** 403 without `leads:write` — checked on every call, as permissions change. */
function assertCanSetUpService(access: AccessContext): void {
  if (canSetUpReconciliationService(access.permissions)) return;
  throw new ForbiddenException({
    code: RECONCILIATION_OUTCOME_FORBIDDEN,
    message:
      'Setting a 1-800 policy up for service needs permission to create leads.',
  });
}

/** What the welcome call opens with: the assignee's words, else the Dash line's. */
function openingNoteFor(
  row: LeanRow,
  typed: string | null | undefined,
): string {
  return typed?.trim() || serviceIntakeOpeningNote(row.dash ?? {});
}

function conflictLine(conflict: ContactFieldConflict): string {
  return `The ${conflict.field} on file is ${conflict.stored}; the form gave ${conflict.submitted}. The one on file was kept.`;
}

/**
 * The deal's policy that is the Dash line: the one whose number keys as
 * Dash's (`reconciliationPolicyKey`). A deal entered for a Dash row may carry
 * other lines sold on the same visit.
 *
 * Sold and Cancel rewrite fall back to the deal's first policy — for them the
 * link names what was booked. A **Chargeback** cancels the policy it links and
 * charges its premium back (PAC-173 PR 6), so it never guesses: with no
 * policy numbered as Dash's it links one only when the deal has exactly one,
 * and otherwise none, until the number is corrected.
 */
function dashLinePolicy<
  T extends { _id: Types.ObjectId; policyNumber?: string },
>(
  row: LeanRow,
  kind: ReconciliationOutcomeKind,
  policies: readonly T[],
): T | null {
  const dashKey =
    row.dash?.policyKey || reconciliationPolicyKey(row.dash?.policyNumber);
  const keyed = dashKey
    ? policies.find(
        (policy) => reconciliationPolicyKey(policy.policyNumber) === dashKey,
      )
    : undefined;
  if (keyed) return keyed;
  if (kind === 'chargeback') return policies.length === 1 ? policies[0] : null;
  return policies[0] ?? null;
}

/** 409: a Chargeback whose sale has no policy numbered as the Dash line. */
function unmatchedChargebackPolicy(row: LeanRow): ConflictException {
  const number =
    row.dash?.policyNumber ?? row.dash?.policyKey ?? 'the Dash line';
  return new ConflictException({
    code: RECONCILIATION_CHARGEBACK_POLICY_UNMATCHED,
    message: `None of the policies on the sale is numbered ${number}, as the Dash line is, so there is nothing safe to cancel. Correct the policy number on the sale, then try again.`,
  });
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
