import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { RenewalStepKey, RenewalTrack } from '@sfa/shared';
import {
  DEFAULT_RENEWAL_STEP_DEFINITIONS,
  RENEWAL_BACKLOG_GRACE_DAYS,
  RENEWAL_OUTREACH_CUTOVER,
  nextRenewalDate,
  renewalTrackFor,
  type RenewalStepDefinition,
} from '@sfa/shared';
import {
  RenewalCycle,
  type RenewalCycleDocument,
} from '../../crm/schemas/renewal-cycle.schema';
import {
  RenewalScanState,
  type RenewalScanStateDocument,
} from '../../crm/schemas/renewal-scan-state.schema';
import {
  ServiceTicket,
  type ServiceTicketDocument,
} from '../../crm/schemas/service-ticket.schema';
import { Household } from '../../households/schemas/household.schema';
import { Policy } from '../../policies/schemas/policy.schema';
import { Contact } from '../../contacts/schemas/contact.schema';
import { User } from '../../users/schemas/user.schema';
import {
  formatTermKey,
  renewalAnchorDate,
  renewalStepsToOpen,
  scheduleRenewalSteps,
  type PlannedRenewalStep,
  type PolicyRenewalCandidate,
} from './renewal-scheduling';
import {
  isDuplicateKeyError,
  isTicketNumberClash,
} from '../mongo/duplicate-key';
import { TicketNumberService } from '../tickets/ticket-number.service';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Builds and repairs an agency's renewal cycles, and the call tickets hanging
 * off them.
 *
 * ## Why this is not in `ServiceTicketsService` any more (PAC-99)
 *
 * It used to be, and it ran **inline on `GET /crm/service-tickets/renewals/desk`**:
 * whichever request won the throttle paid for rolling renewal anchors forward,
 * scanning ninety days of the policy book and upserting cycles, while a CSR
 * waited. The controller said as much — *"there is no cron, so reading the desk
 * is what makes renewals appear"* — and that was true when it was written.
 *
 * Moving it to a schedule meant moving it somewhere the worker can reach.
 * `src/worker/**` may not import feature services (`eslint.config.mjs`), and
 * relaxing that rule to save a refactor is what turns a boundary into a
 * comment. So the logic lives here, in `common/`, injecting models rather than
 * services, and both callers use it: `ServiceTicketsService` delegates, and
 * `MaterializeRenewalCyclesFn` drives it on a cron.
 *
 * ## Agency-scoped, not request-scoped
 *
 * The old code threaded an `AccessContext` through purely to reach four
 * `ClientsService` queries, which meant the scan inherited the *caller's* data
 * scope: an `own`-scoped CSR opening the desk rolled forward only their own
 * policies. That was never intended — materialization is agency-wide
 * bookkeeping, not a user's view of it — so those four queries are reproduced
 * here against the models, clamped to `agencyId` and nothing narrower.
 *
 * ## Everything else is unchanged
 *
 * The three-sided scan, the drift tolerance, the grouping window, the
 * idempotency guards and the unique-index races are the code that was there
 * before, moved rather than rewritten. `test/renewal-materialization.e2e-spec.ts`
 * was written against the previous version and passes unchanged against this
 * one; that is what the move is answerable to.
 */
@Injectable()
export class RenewalMaterializationService {
  private readonly logger = new Logger(RenewalMaterializationService.name);

  constructor(
    @InjectModel(RenewalCycle.name)
    private readonly cycleModel: Model<RenewalCycleDocument>,
    @InjectModel(RenewalScanState.name)
    private readonly scanStateModel: Model<RenewalScanStateDocument>,
    @InjectModel(ServiceTicket.name)
    private readonly ticketModel: Model<ServiceTicketDocument>,
    @InjectModel(Policy.name)
    private readonly policyModel: Model<Policy>,
    @InjectModel(Household.name)
    private readonly householdModel: Model<Household>,
    @InjectModel(Contact.name)
    private readonly contactModel: Model<Contact>,
    @InjectModel(User.name)
    private readonly userModel: Model<User>,
    private readonly ticketNumbers: TicketNumberService,
  ) {}

  /* ------------------------------------------------------------------ *
   * Proactive renewal outreach
   *
   * A `RenewalCycle` per deal per term, with one or two call tickets hanging
   * off it. There is no scheduler in this API, so cycles materialize lazily
   * from a throttled scan run on the desk and stats reads — the same
   * reconcile-on-read bargain onboarding makes.
   * ------------------------------------------------------------------ */

  /**
   * Claim the next scan window, or return null if someone else holds it.
   *
   * The duplicate-key catch is the *normal* path once a document exists: when
   * `lastScanAt` is inside the window the filter misses, the upsert attempts an
   * insert, and the unique index rejects it.
   *
   * Returns the claimed state rather than a bare boolean because the winner
   * needs `scanCursor` off the same document — reading it separately would
   * race the next claimant.
   */
  private async claimScanWindow(
    agencyId: Types.ObjectId,
  ): Promise<RenewalScanStateDocument | null> {
    const cutoff = new Date(Date.now() - RENEWAL_SCAN_INTERVAL_MS);
    try {
      // The `$set` touches only `lastScanAt`, so the returned document still
      // carries the cursor the previous pass left — which is the one to resume
      // from. `upsert` seeds it as null on a first scan: start of the window.
      return await this.scanStateModel.findOneAndUpdate(
        { agencyId, lastScanAt: { $lt: cutoff } },
        { $set: { lastScanAt: new Date() } },
        { upsert: true, new: true },
      );
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        return null;
      }
      throw error;
    }
  }

  /** Renewal step definitions for an agency, falling back to the shared defaults. */
  async resolveRenewalDefinitions(): Promise<RenewalStepDefinition[]> {
    // Config-in-DB is planned (see the onboarding equivalent); until an agency
    // has overrides the shared constants are the source of truth, which keeps
    // renewal outreach working on a fresh install.
    return Promise.resolve(DEFAULT_RENEWAL_STEP_DEFINITIONS);
  }

  /**
   * Bring an agency's renewal cycles in line with its book.
   *
   * Three-sided. Side 0 repairs the anchors themselves, because a renewal date
   * that has gone by is not a date anything can count down to; Side A creates
   * cycles for policies entering the horizon; Side B sweeps the cycles already
   * open, because Side A cannot see a policy that was deleted, deactivated, or
   * whose date moved out of range.
   */
  async materializeForAgency(agencyId: Types.ObjectId): Promise<void> {
    const claim = await this.claimScanWindow(agencyId);
    if (!claim) {
      return;
    }

    const now = new Date();
    const horizonStart = new Date(now.getTime() - RENEWAL_GRACE_DAYS * DAY_MS);
    const horizonEnd = new Date(now.getTime() + RENEWAL_HORIZON_DAYS * DAY_MS);

    // Side 0 — advance anchors that have gone by, and fill in missing ones.
    // Runs first so Side A sees a book whose dates are all in the future.
    await this.rollForwardRenewalDates(agencyId, now, RENEWAL_SCAN_BATCH);

    // Side A — policies entering the horizon, resumed from where the last pass
    // stopped. Without the cursor this re-reads the same earliest batch every
    // time and the tail of the window is never scanned at all.
    const candidates = await this.findRenewalWindow(
      agencyId,
      horizonStart,
      horizonEnd,
      RENEWAL_SCAN_BATCH,
      claim.scanCursor ?? null,
    );
    for (const group of groupRenewalCandidates(candidates)) {
      await this.ensureRenewalCycle(agencyId, group);
    }

    // A short batch means the window is exhausted; start the next sweep from
    // the beginning, which is also what re-reads policies whose dates have
    // since moved backwards into it.
    const nextCursor =
      candidates.length < RENEWAL_SCAN_BATCH
        ? null
        : (candidates[candidates.length - 1]?.renewalDate ?? null);
    await this.scanStateModel.updateOne(
      { agencyId },
      { $set: { scanCursor: nextCursor } },
    );

    // Side B — cycles already open, which may have drifted or gone stale.
    const open = await this.cycleModel
      .find({ agencyId, completedAt: null })
      .limit(RENEWAL_SCAN_BATCH);
    for (const cycle of open) {
      await this.reconcileCycle(cycle);
    }
  }

  /** Create a cycle and its call tickets if this group does not have one yet. */
  private async ensureRenewalCycle(
    agencyId: Types.ObjectId,
    group: RenewalGroup,
  ): Promise<RenewalCycleDocument | null> {
    const termKey = formatTermKey(group.anchor);
    const existing = await this.cycleModel.findOne({
      agencyId,
      groupKey: group.groupKey,
      termKey,
    });
    if (existing) {
      // Adopt any policy in this group the cycle does not already carry.
      //
      // The scan reads a bounded batch, so a household's Home and Auto renewing
      // the same week can arrive in *different* passes. The first creates the
      // cycle; without this the second would find it, reconcile, and silently
      // drop its own policy — `reconcileRenewalCycle` rebuilds the checklist
      // from `cycle.policies`, so a line that never got in never appears. The
      // CSR would then review the Home on a call whose Auto is invisible.
      const known = new Set(
        existing.policies.map((policy) => String(policy.policyId)),
      );
      const added = group.policies.filter((policy) => !known.has(policy.id));
      if (added.length) {
        existing.policies.push(...added.map(toCyclePolicy));
        existing.markModified('policies');
        await existing.save();
      }
      await this.reconcileCycle(existing);
      return existing;
    }

    const household = group.householdId
      ? await this.householdSummary(agencyId, group.householdId)
      : null;

    let cycle: RenewalCycleDocument;
    try {
      cycle = await this.cycleModel.create({
        agencyId,
        branchId: group.branchId ? new Types.ObjectId(group.branchId) : null,
        groupKey: group.groupKey,
        dealId: group.dealId ? new Types.ObjectId(group.dealId) : null,
        householdId: group.householdId
          ? new Types.ObjectId(group.householdId)
          : null,
        termKey,
        renewalDate: group.anchor,
        track: group.track,
        policies: group.policies.map(toCyclePolicy),
        clientName:
          household?.primaryContactName ||
          household?.name ||
          group.policies[0]?.policyNumber ||
          'Renewal',
        householdName: household?.name ?? '',
        phone: household?.primaryPhone ?? '',
        email: household?.primaryEmail ?? '',
        currentStepKey: null,
        completedAt: null,
        // The client's CSR owns the outreach. This matters more than it looks:
        // a `csr` user is `own`-scoped, so an unassigned ticket is invisible to
        // exactly the person meant to work it.
        assignedCsrId:
          household?.assignedCrmId &&
          Types.ObjectId.isValid(household.assignedCrmId)
            ? new Types.ObjectId(household.assignedCrmId)
            : null,
      });
    } catch (error) {
      // A concurrent scan created it. The unique index did its job.
      if (!isDuplicateKeyError(error)) throw error;
      const raced = await this.cycleModel.findOne({
        agencyId,
        groupKey: group.groupKey,
        termKey,
      });
      if (raced) await this.reconcileCycle(raced);
      return raced;
    }

    await this.reconcileCycle(cycle);
    return cycle;
  }

  /**
   * Repair a cycle against its policies, and open whatever call tickets should
   * exist. Idempotent, and run on every read — a cycle broken between writes
   * self-heals the next time anyone looks at it.
   */
  async reconcileCycle(
    cycle: RenewalCycleDocument,
  ): Promise<RenewalCycleDocument> {
    const now = new Date();
    const policies = await this.findCandidatesByIds(
      cycle.agencyId,
      cycle.policies.map((p) => String(p.policyId)),
    );

    // (1) Nothing left to renew — close it out. Never delete: audit trail.
    if (!policies.length) {
      if (!cycle.completedAt) {
        cycle.completedAt = now;
        cycle.currentStepKey = null;
        cycle.closedReason = 'policy_ineligible';
        await cycle.save();
        await this.closeRenewalTickets(
          cycle,
          'Renewal cycle closed — the policies are no longer active.',
        );
      }
      return cycle;
    }

    // (2) Has the carrier moved the date?
    const anchor = earliestAnchor(policies) ?? cycle.renewalDate;
    const driftDays = Math.abs(
      (anchor.getTime() - new Date(cycle.renewalDate).getTime()) / DAY_MS,
    );
    if (driftDays > RENEWAL_DRIFT_TOLERANCE_DAYS) {
      // Too far to be the same outreach — a new term, or a data correction big
      // enough that the old plan is meaningless. The next scan opens a fresh
      // cycle under the new termKey.
      if (!cycle.completedAt) {
        cycle.completedAt = now;
        cycle.currentStepKey = null;
        cycle.closedReason = 'superseded';
        await cycle.save();
        await this.closeRenewalTickets(
          cycle,
          'Renewal date moved beyond this cycle — superseded by a new one.',
        );
      }
      return cycle;
    }

    // (3) Adopt a small drift, refresh the checklist, and re-plan.
    cycle.renewalDate = anchor;
    cycle.policies = policies.map((policy) => mergeCyclePolicy(cycle, policy));
    cycle.track = trackForPolicies(policies);
    cycle.markModified('policies');

    const definitions = await this.resolveRenewalDefinitions();
    const tickets = await this.renewalTickets(cycle);
    const completedAtByKey: Partial<Record<RenewalStepKey, Date | null>> = {};
    for (const ticket of tickets) {
      if (ticket.renewal) {
        completedAtByKey[ticket.renewal.stepKey] =
          ticket.renewal.completedAt ?? null;
      }
    }
    const planned = scheduleRenewalSteps(
      definitions,
      cycle.track,
      anchor,
      completedAtByKey,
    );

    // (4) Every call gets a ticket up front — renewal steps do not chain, so
    // nothing waits on the call before it. The only calls held back are ones
    // whose date passed before outreach went live; see `renewalStepsToOpen`.
    const existingStepKeys = new Set<RenewalStepKey>(
      tickets
        .map((ticket) => ticket.renewal?.stepKey)
        .filter((key): key is RenewalStepKey => Boolean(key)),
    );
    const opening = renewalStepsToOpen(
      planned,
      existingStepKeys,
      RENEWAL_OUTREACH_CUTOVER,
      RENEWAL_BACKLOG_GRACE_DAYS,
    );
    for (const step of opening) {
      await this.ensureRenewalTicket(cycle, step, planned.length);
    }

    // (5) Roll up state from the tickets.
    const refreshed = await this.renewalTickets(cycle);
    const outstanding = planned.find(
      (step) =>
        !refreshed.find((t) => t.renewal?.stepKey === step.stepKey)?.renewal
          ?.completedAt,
    );
    cycle.currentStepKey = outstanding?.stepKey ?? null;

    const review = refreshed.find(
      (t) => t.renewal?.stepKey === 'renewal_review',
    );
    if (review?.renewal?.outcome) {
      cycle.outcome = review.renewal.outcome;
      cycle.outcomeAt = review.renewal.outcomeAt ?? null;
      cycle.outcomeByName = review.renewal.completedByName ?? '';
    }

    if (!outstanding) {
      cycle.completedAt =
        refreshed
          .map((t) => t.renewal?.completedAt)
          .filter((d): d is Date => Boolean(d))
          .sort((a, b) => b.getTime() - a.getTime())[0] ?? now;
      cycle.closedReason = 'completed';
    } else {
      cycle.completedAt = null;
      cycle.closedReason = null;
    }

    await cycle.save();
    return cycle;
  }

  /** Every ticket belonging to a cycle, in call order. */
  async renewalTickets(
    cycle: RenewalCycleDocument,
  ): Promise<ServiceTicketDocument[]> {
    return this.ticketModel
      .find({
        agencyId: cycle.agencyId,
        'renewal.renewalCycleId': cycle._id,
      })
      .sort({ 'renewal.sequence': 1 });
  }

  /**
   * Create the ticket for one call if it does not exist. The unique partial
   * index on `{agencyId, renewalCycleId, stepKey}` is the real guarantee; a
   * concurrent duplicate is swallowed rather than surfaced.
   */
  private async ensureRenewalTicket(
    cycle: RenewalCycleDocument,
    step: PlannedRenewalStep,
    totalSteps: number,
  ): Promise<void> {
    const existing = await this.ticketModel.findOne({
      agencyId: cycle.agencyId,
      'renewal.renewalCycleId': cycle._id,
      'renewal.stepKey': step.stepKey,
    });

    if (existing) {
      // Adopt re-planned timing, but never rewrite a call already made.
      if (!existing.renewal?.completedAt && existing.renewal) {
        existing.renewal.availableAt = step.availableAt;
        existing.renewal.dueAt = step.dueAt;
        existing.renewal.renewalDate = cycle.renewalDate;
        existing.markModified('renewal');
        await existing.save();
      }
      return;
    }

    const primary = cycle.policies[0];
    try {
      await this.ticketNumbers.createTicketWithNumber(String(cycle.agencyId), {
        agencyId: cycle.agencyId,
        branchId: cycle.branchId ?? null,
        clientName: cycle.clientName,
        category: 'Renewal Review',
        status: 'open',
        priority: 'medium',
        assignedUserId: cycle.assignedCsrId ?? null,
        assignedRep: await this.resolveCsrName(
          cycle.assignedCsrId ? String(cycle.assignedCsrId) : null,
        ),
        createdByName: 'Renewal outreach',
        policyNumber: primary?.policyNumber ?? '',
        policyType: primary?.policyType ?? '',
        household: cycle.householdName ?? '',
        policyId: primary?.policyId ?? null,
        householdId: cycle.householdId ?? null,
        phone: cycle.phone ?? '',
        email: cycle.email ?? '',
        // Dated to when the call opens, not to now — a scheduled call has not
        // been sitting on anyone's plate.
        openedAt: step.availableAt,
        lastActivityAt: step.availableAt,
        resolvedAt: null,
        timeline: [
          {
            type: 'system',
            content:
              `${step.label} scheduled — ${cycle.policies.length} ` +
              `polic${cycle.policies.length === 1 ? 'y' : 'ies'} renewing ` +
              `${cycle.renewalDate.toISOString().slice(0, 10)}.`,
            at: step.availableAt,
          },
        ],
        onboarding: null,
        renewal: {
          renewalCycleId: cycle._id,
          stepKey: step.stepKey,
          track: cycle.track,
          sequence: step.sequence,
          totalSteps,
          renewalDate: cycle.renewalDate,
          availableAt: step.availableAt,
          dueAt: step.dueAt,
          completedAt: null,
          completedBy: null,
          completedByName: '',
          outcome: null,
          outcomeAt: null,
        },
      });
    } catch (error) {
      // Swallow only the step-uniqueness duplicate — a concurrent scan opened
      // this call, and the unique index did its job. A *ticketNumber* duplicate
      // reaching here means `createTicketWithNumber` exhausted its retries, and
      // silently dropping that would leave a cycle with no ticket to work.
      if (!isDuplicateKeyError(error) || isTicketNumberClash(error)) {
        throw error;
      }
    }
  }

  /** Close a dead cycle's outstanding call tickets, with a reason on each. */
  private async closeRenewalTickets(
    cycle: RenewalCycleDocument,
    reason: string,
  ): Promise<void> {
    const tickets = await this.renewalTickets(cycle);
    const now = new Date();
    for (const ticket of tickets) {
      if (ticket.renewal?.completedAt) continue;
      ticket.status = 'closed';
      ticket.resolvedAt = now;
      ticket.lastActivityAt = now;
      ticket.statusOverriddenAt = now;
      ticket.timeline.push({ type: 'system', content: reason, at: now });
      await ticket.save();
    }
  }

  /* ------------------------------------------------------------------ *
   * Book queries
   *
   * The agency-wide counterparts of the four `ClientsService` methods this
   * used to call. Reproduced rather than reused because those clamp to a
   * *request's* data scope, and a scheduled sweep has no request and must not
   * be narrowed by whoever happened to trigger it. Kept deliberately thin —
   * only the fields the materializer reads.
   * ------------------------------------------------------------------ */

  /**
   * Advance renewal anchors that have already gone by.
   *
   * A renewal date in the past is not something a countdown can point at, so
   * the scan repairs the book before reading it.
   */
  private async rollForwardRenewalDates(
    agencyId: Types.ObjectId,
    now: Date,
    limit: number,
  ): Promise<void> {
    const stale = await this.policyModel
      .find({
        agencyId,
        active: true,
        $or: [{ renewalDate: null }, { renewalDate: { $lt: now } }],
      })
      .select('policyType renewalDate effectiveDate expirationDate')
      .sort({ renewalDate: 1 })
      .limit(limit)
      .lean();

    const writes = stale.flatMap((policy) => {
      const anchor =
        policy.renewalDate ?? policy.effectiveDate ?? policy.expirationDate;
      const next = nextRenewalDate(anchor, policy.policyType, now);
      // No anchor, or one too far gone to reach the present — leave it be and
      // let the migration's report be what surfaces it.
      if (!next) return [];
      return [
        {
          updateOne: {
            filter: { _id: policy._id },
            update: { $set: { renewalDate: next } },
          },
        },
      ];
    });

    if (writes.length) await this.policyModel.bulkWrite(writes);
  }

  /** Active policies renewing inside the horizon, resumable by renewal date. */
  private async findRenewalWindow(
    agencyId: Types.ObjectId,
    from: Date,
    to: Date,
    limit: number,
    after: Date | null,
  ): Promise<PolicyRenewalCandidate[]> {
    // `after` is a renewal *date*, not a unique key, so resuming strictly past
    // it would drop every policy sharing that date with the last one seen —
    // and renewal dates collide constantly. Re-reading them is the safe side of
    // the trade: `ensureRenewalCycle` is idempotent, so a repeat costs a lookup.
    const lowerBound = after && after > from ? after : from;
    const policies = await this.policyModel
      .find({
        agencyId,
        active: true,
        renewalDate: { $ne: null, $gte: lowerBound, $lte: to },
      })
      .sort({ renewalDate: 1 })
      .limit(limit)
      .lean();

    return policies.map(toCandidate);
  }

  /** The same shape by id, for reconciling a cycle whose policies may have moved. */
  private async findCandidatesByIds(
    agencyId: Types.ObjectId,
    ids: string[],
  ): Promise<PolicyRenewalCandidate[]> {
    const objectIds = ids
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
    if (!objectIds.length) return [];

    const policies = await this.policyModel
      .find({ agencyId, _id: { $in: objectIds } })
      .lean();

    return policies.filter((policy) => policy.active).map(toCandidate);
  }

  /**
   * The handful of household fields a cycle denormalizes.
   *
   * Not `ClientsService.getHousehold`, which builds the whole 360° view —
   * roster, memberships, policies — for five strings. The primary contact is
   * resolved through `primaryContactId`, which since PAC-91 §4 is the only
   * place that answer lives.
   */
  private async householdSummary(
    agencyId: Types.ObjectId,
    householdId: string,
  ): Promise<{
    name: string;
    primaryContactName: string;
    primaryPhone: string;
    primaryEmail: string;
    assignedCrmId: string | null;
  } | null> {
    if (!Types.ObjectId.isValid(householdId)) return null;
    const household = await this.householdModel
      .findOne({ agencyId, _id: new Types.ObjectId(householdId) })
      .select('name primaryContactId assignedCrmId')
      .lean();
    if (!household) return null;

    const primary = household.primaryContactId
      ? await this.contactModel
          .findOne({ agencyId, _id: household.primaryContactId })
          .select('firstName lastName email phone')
          .lean()
      : null;

    const fullName = [primary?.firstName, primary?.lastName]
      .filter(Boolean)
      .join(' ')
      .trim();

    return {
      name: household.name ?? '',
      primaryContactName: fullName,
      primaryPhone: primary?.phone ?? '',
      primaryEmail: primary?.email ?? '',
      assignedCrmId: household.assignedCrmId
        ? String(household.assignedCrmId)
        : null,
    };
  }

  /** The CSR's display name for the ticket's `assignedRep`, or "System". */
  private async resolveCsrName(userId: string | null): Promise<string> {
    if (!userId || !Types.ObjectId.isValid(userId)) return 'System';
    const user = await this.userModel
      .findById(userId)
      .select('firstName lastName email')
      .lean();
    if (!user) return 'System';
    const name = [user.firstName, user.lastName]
      .filter(Boolean)
      .join(' ')
      .trim();
    return name || user.email || 'System';
  }
}

/** How far ahead the scan looks — the widest lead time on any track. */
const RENEWAL_HORIZON_DAYS = 90;
/** How long after a renewal a cycle can still be closed out with an outcome. */
const RENEWAL_GRACE_DAYS = 14;
/**
 * How far a carrier can move a renewal date before it is treated as a new term
 * rather than the same outreach. Less than half the shortest term (6 months),
 * so an adoption can never reach into the next cycle.
 */
const RENEWAL_DRIFT_TOLERANCE_DAYS = 45;
/** Policies per scan pass. Bounds the work so a large book converges gradually. */
const RENEWAL_SCAN_BATCH = 500;
/** Minimum gap between scans for one agency. */
const RENEWAL_SCAN_INTERVAL_MS = 10 * 60 * 1000;
/**
 * How far apart two policies in the same deal can renew and still be one call.
 * Auto (6mo) drifts out of sync with Home (12mo) inside a bundle, so a wide
 * window would merge renewals months apart into a single conversation.
 */
const RENEWAL_GROUP_WINDOW_DAYS = 15;

interface RenewalGroup {
  groupKey: string;
  dealId: string | null;
  householdId: string | null;
  branchId: string | null;
  anchor: Date;
  track: RenewalTrack;
  policies: PolicyRenewalCandidate[];
}

/** The earliest renewal among a set of policies — a cycle's anchor. */
function earliestAnchor(policies: PolicyRenewalCandidate[]): Date | null {
  const dates = policies
    .map((policy) => renewalAnchorDate(policy))
    .filter((d): d is Date => Boolean(d))
    .sort((a, b) => a.getTime() - b.getTime());
  return dates[0] ?? null;
}

/**
 * A cycle covering any 12-month policy gets both calls; an auto-only cycle gets
 * the single merged one. Mixed bundles follow the longer term, because the
 * annual policy genuinely warrants the 90-day warm-up.
 */
function trackForPolicies(policies: PolicyRenewalCandidate[]): RenewalTrack {
  return policies.every(
    (policy) => renewalTrackFor(policy.policyType) === 'semiannual',
  )
    ? 'semiannual'
    : 'annual';
}

/**
 * Fold policies into one outreach per deal per renewal window.
 *
 * The CSR makes one phone call for a deal, so policies renewing together are
 * one ticket with a checklist. Policies in the same deal renewing months apart
 * — the auto-in-a-bundle case — split into separate cycles.
 *
 * Policies with no deal group by household instead, which is why the key is a
 * single string rather than two nullable ids.
 */
function groupRenewalCandidates(
  candidates: PolicyRenewalCandidate[],
): RenewalGroup[] {
  const byKey = new Map<string, PolicyRenewalCandidate[]>();
  for (const policy of candidates) {
    if (!renewalAnchorDate(policy)) continue;
    const key = policy.dealId
      ? `deal:${policy.dealId}`
      : policy.householdId
        ? `household:${policy.householdId}`
        : `policy:${policy.id}`;
    byKey.set(key, [...(byKey.get(key) ?? []), policy]);
  }

  const groups: RenewalGroup[] = [];
  for (const [groupKey, policies] of byKey) {
    const sorted = [...policies].sort(
      (a, b) =>
        (renewalAnchorDate(a)?.getTime() ?? 0) -
        (renewalAnchorDate(b)?.getTime() ?? 0),
    );

    // Walk in date order, starting a new cycle whenever the next renewal falls
    // outside the current one's window.
    let bucket: PolicyRenewalCandidate[] = [];
    let bucketAnchor: Date | null = null;
    const flush = () => {
      if (!bucket.length || !bucketAnchor) return;
      groups.push({
        groupKey,
        dealId: bucket[0].dealId,
        householdId: bucket[0].householdId,
        branchId: bucket[0].branchId,
        anchor: bucketAnchor,
        track: trackForPolicies(bucket),
        policies: bucket,
      });
      bucket = [];
      bucketAnchor = null;
    };

    for (const policy of sorted) {
      const anchor = renewalAnchorDate(policy)!;
      if (
        bucketAnchor &&
        (anchor.getTime() - bucketAnchor.getTime()) / DAY_MS >
          RENEWAL_GROUP_WINDOW_DAYS
      ) {
        flush();
      }
      bucketAnchor ??= anchor;
      bucket.push(policy);
    }
    flush();
  }

  return groups;
}

/** A policy as stored on a cycle's checklist. */
function toCyclePolicy(policy: PolicyRenewalCandidate) {
  return {
    policyId: new Types.ObjectId(policy.id),
    policyNumber: policy.policyNumber,
    policyType: policy.policyType,
    carrier: policy.carrier,
    premium: policy.premium,
    renewalDate: renewalAnchorDate(policy),
    discussedAt: null,
    discussedBy: null,
    discussedByName: '',
  };
}

/** Refresh a checklist line from the policy, preserving the "discussed" tick. */
function mergeCyclePolicy(
  cycle: RenewalCycleDocument,
  policy: PolicyRenewalCandidate,
) {
  const existing = cycle.policies.find((p) => String(p.policyId) === policy.id);
  return {
    ...toCyclePolicy(policy),
    discussedAt: existing?.discussedAt ?? null,
    discussedBy: existing?.discussedBy ?? null,
    discussedByName: existing?.discussedByName ?? '',
  };
}

/**
 * A policy document as the scan's candidate shape.
 *
 * One projection for both book queries, so `findRenewalWindow` and
 * `findCandidatesByIds` cannot drift into disagreeing about what a candidate
 * is — which would show up as a cycle whose checklist changes on reconcile.
 */
function toCandidate(policy: {
  _id: unknown;
  policyNumber?: string | null;
  policyType?: string | null;
  carrier?: string | null;
  premium?: number | null;
  renewalDate?: Date | null;
  expirationDate?: Date | null;
  householdId?: Types.ObjectId | null;
  dealId?: Types.ObjectId | null;
  branchId?: string | null;
}): PolicyRenewalCandidate {
  return {
    id: String(policy._id),
    policyNumber: policy.policyNumber ?? '',
    policyType: policy.policyType ?? '',
    carrier: policy.carrier ?? '',
    premium: policy.premium ?? 0,
    renewalDate: policy.renewalDate ?? null,
    expirationDate: policy.expirationDate ?? null,
    householdId: policy.householdId ? String(policy.householdId) : null,
    dealId: policy.dealId ? String(policy.dealId) : null,
    branchId: policy.branchId ?? null,
  };
}
