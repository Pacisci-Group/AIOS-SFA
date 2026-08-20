import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  DataScope,
  carrierPolicyNumberMatches,
  carrierSlug,
  normalizeCarrier,
  normalizePolicyType,
  policyTypeQueryValues,
} from '@sfa/shared';
import type {
  AccessContext,
  PolicyCheckMatch,
  PolicyCheckResponse,
  UpdatePolicyResult,
} from '@sfa/shared';
import { FilterQuery, Model, Types } from 'mongoose';
import {
  Activity,
  ActivityDocument,
} from '../activities/schemas/activity.schema';
import {
  ChangeFieldSpec,
  ChangeSnapshot,
  changeDate,
  changeText,
  diffSnapshots,
  snapshot,
} from '../activities/change-log';
import { CarriersService } from '../carriers/carriers.service';
import { Deal, DealDocument } from '../deals/schemas/deal.schema';
import {
  Household,
  HouseholdDocument,
} from '../households/schemas/household.schema';
import { derivePersistedDealAggregates } from '../sold-deals/intake/sold.normalize';
import { CheckPolicyDto } from './dto/check-policy.dto';
import { UpdatePolicyDto } from './dto/update-policy.dto';
import { normalizePolicyNumber, policyNumberKey } from './policy-number';
import { toLeadDetailPolicy } from './policy-view';
import { Policy, PolicyDocument } from './schemas/policy.schema';

/**
 * A producer only needs to recognise the policy, not page through candidates.
 * Capping also bounds the two follow-up batch reads below.
 */
const MAX_MATCHES = 5;

/** The policy fields the check needs; everything else stays out of memory. */
type PolicyLean = Pick<
  Policy,
  'policyNumber' | 'policyType' | 'carrier' | 'effectiveDate' | 'branchId'
> & {
  _id: Types.ObjectId;
  dealId?: Types.ObjectId;
  householdId?: Types.ObjectId;
};

/**
 * The fields `PATCH /policies/:id` speaks about in the edit log (PAC-65 #9).
 *
 * The eight patchable fields, and nothing derived. `policyNumberKey` is
 * excluded on purpose: the service keeps it in lockstep with `policyNumber`, so
 * logging it would report the same correction twice under a name no producer
 * has ever seen.
 *
 * **Every code-backed field is normalized here**, matching `toLeadDetailPolicy`.
 * A migrated policy stores raw SmartSuite select values (`carrier: 'B4tEH'`,
 * `policyType: 'eCEuV'`), and unlike every other read path nothing normalizes a
 * change row after it is written — snapshot the raw value and the log preserves
 * gibberish for good.
 */
const POLICY_CHANGE_FIELDS: ChangeFieldSpec<PolicyDocument>[] = [
  {
    field: 'policyNumber',
    label: 'Policy number',
    kind: 'text',
    read: (policy) => policy.policyNumber ?? null,
  },
  {
    field: 'policyType',
    label: 'Policy type',
    kind: 'text',
    read: (policy) => normalizePolicyType(policy.policyType) || null,
  },
  {
    field: 'carrier',
    label: 'Carrier',
    kind: 'text',
    read: (policy) => normalizeCarrier(policy.carrier) || null,
  },
  {
    field: 'premium',
    label: 'Premium',
    kind: 'currency',
    read: (policy) => policy.premium ?? 0,
  },
  {
    field: 'items',
    label: 'Items',
    kind: 'number',
    read: (policy) => policy.items ?? 0,
  },
  {
    field: 'effectiveDate',
    label: 'Effective date',
    kind: 'date',
    read: (policy) => changeDate(policy.effectiveDate),
  },
  {
    field: 'expirationDate',
    label: 'Expiration date',
    kind: 'date',
    read: (policy) => changeDate(policy.expirationDate),
  },
  {
    field: 'policyStatus',
    label: 'Status',
    kind: 'text',
    // Free text — the platform has no canonical policy-status vocabulary, so
    // there is nothing to normalize against, only length to bound.
    read: (policy) => changeText(policy.policyStatus),
  },
];

@Injectable()
export class PoliciesService {
  private readonly logger = new Logger(PoliciesService.name);

  constructor(
    @InjectModel(Policy.name)
    private readonly policyModel: Model<PolicyDocument>,
    @InjectModel(Deal.name) private readonly dealModel: Model<DealDocument>,
    @InjectModel(Household.name)
    private readonly householdModel: Model<HouseholdDocument>,
    @InjectModel(Activity.name)
    private readonly activityModel: Model<ActivityDocument>,
    private readonly carriers: CarriersService,
  ) {}

  /**
   * Find existing policies with the same number, so the wizard can offer to link
   * rather than duplicate.
   *
   * Agency-scoped always. Out-of-scope matches are **reported but masked**
   * rather than hidden — see `PolicyCheckResponse` for the reasoning. This is
   * deliberately softer than the blanket 404 clamp the write paths use: those
   * protect a write *target*, whereas hiding a duplicate here would defeat the
   * only thing the endpoint is for.
   */
  async check(
    access: AccessContext,
    branchId: string | null,
    query: CheckPolicyDto,
  ): Promise<PolicyCheckResponse> {
    const normalized = normalizePolicyNumber(query.number);

    // Too short to be meaningful. An empty result rather than an error: the
    // wizard asks on every blur, including half-typed input.
    if (!normalized) {
      return { query: query.number, normalized: null, matches: [] };
    }

    const filter: FilterQuery<PolicyDocument> = {
      agencyId: access.agencyId,
      policyNumberKey: normalized,
      isTestRecord: { $ne: true },
    };

    if (query.policyType) {
      // Expanded to every stored form, because migrated policies hold raw
      // SmartSuite choice codes while app-created ones hold canonical labels.
      filter.policyType = { $in: policyTypeQueryValues(query.policyType) };
    }

    const policies = await this.policyModel
      .find(filter)
      .sort({ effectiveDate: -1, _id: 1 })
      .limit(MAX_MATCHES)
      .lean<PolicyLean[]>();

    if (!policies.length) {
      return { query: query.number, normalized, matches: [] };
    }

    const [dealsById, householdNames] = await Promise.all([
      this.loadDeals(policies),
      this.loadHouseholdNames(policies),
    ]);

    const matches = policies.map((policy): PolicyCheckMatch => {
      const deal = policy.dealId
        ? dealsById.get(policy.dealId.toString())
        : undefined;
      const isOwn = this.isInScope(access, branchId, policy, deal);

      const clientName =
        deal?.clientName ??
        (policy.householdId
          ? (householdNames.get(policy.householdId.toString()) ?? null)
          : null);

      return {
        id: policy._id.toString(),
        policyNumber: policy.policyNumber ?? '',
        // Normalized so a migrated policy storing a raw choice code still
        // renders as a readable line of business.
        policyType: normalizePolicyType(policy.policyType),
        carrier: policy.carrier ?? '',
        effectiveDate: policy.effectiveDate
          ? policy.effectiveDate.toISOString()
          : null,
        isOwn,
        // Withheld out of scope: enough to recognise the policy, not enough to
        // read another producer's book.
        clientName: isOwn ? clientName : null,
        householdId: isOwn ? (policy.householdId?.toString() ?? null) : null,
        dealId: isOwn ? (policy.dealId?.toString() ?? null) : null,
      };
    });

    return { query: query.number, normalized, matches };
  }

  /**
   * Correct a sold policy — `PATCH /policies/:id` (PAC-56 #27).
   *
   * The Lead Detail Sold card's quick edit. Deliberately a *field* correction,
   * not a re-submission: the Sold wizard owns creating the deal, its policies
   * and the audit items it triggers, and re-running any of that from here would
   * duplicate the hand-off.
   *
   * ## Scope is a hard 404, unlike `check`
   *
   * {@link check} reports out-of-scope matches in masked form, because warning a
   * producer about a duplicate they cannot see is the entire point of it. This
   * is a **write target**, so it takes the blanket clamp every other write path
   * uses: outside your scope is indistinguishable from does not exist.
   *
   * ⚠ No duplicate check on `policyNumber`. `PolicySchema` is non-unique on
   * purpose (migrated data already holds duplicates, and carriers reuse numbers
   * across lines), and warn-and-link belongs on the create path where the
   * producer is choosing between "link" and "correct". Blocking a typo fix
   * because the corrected number already exists would strand the record.
   */
  async update(
    access: AccessContext,
    branchId: string | null,
    policyId: string,
    dto: UpdatePolicyDto,
  ): Promise<UpdatePolicyResult> {
    const { policy, leadId } = await this.loadOwnedPolicy(
      access,
      branchId,
      policyId,
    );

    // Before the assignment block below overwrites the stored values.
    const before = snapshot(POLICY_CHANGE_FIELDS, policy);

    if (dto.policyNumber) {
      // Against the *effective* carrier: the patched value if this request is
      // changing it, the stored one otherwise.
      await this.assertPolicyNumberFormat(
        access.agencyId,
        dto.carrier !== undefined ? dto.carrier : policy.carrier,
        dto.policyNumber,
      );
    }

    if (dto.policyNumber !== undefined) {
      policy.policyNumber = dto.policyNumber ?? undefined;
      // Kept in lockstep with the number itself — a corrected policy that the
      // duplicate check can no longer find is worse than no correction.
      policy.policyNumberKey = dto.policyNumber
        ? (normalizePolicyNumber(dto.policyNumber) ?? undefined)
        : undefined;
    }
    if (dto.policyType !== undefined) policy.policyType = dto.policyType;
    if (dto.carrier !== undefined) policy.carrier = dto.carrier ?? undefined;
    if (dto.premium !== undefined) policy.premium = dto.premium;
    if (dto.items !== undefined) policy.items = dto.items;
    if (dto.effectiveDate !== undefined) {
      policy.effectiveDate = dto.effectiveDate ?? undefined;
    }
    if (dto.expirationDate !== undefined) {
      policy.expirationDate = dto.expirationDate ?? undefined;
    }
    if (dto.status !== undefined) policy.policyStatus = dto.status ?? undefined;

    await policy.save();
    await this.recomputeDealTotals(policy);
    await this.recordFieldChanges(access, policy, leadId, before);
    return toLeadDetailPolicy(policy);
  }

  /**
   * The edit log entry for `PATCH /policies/:id` (PAC-65 #9) — the only way to
   * correct a booked sale, and so the "sold" half of the quote/sold edit log.
   *
   * Post-commit and best-effort like `recomputeDealTotals` above, but logged at
   * `error`: a dropped row is a hole in an audit trail.
   *
   * ## A row with no `leadId` is written anyway
   *
   * `Policy` carries no lead ref; the only route is `dealId → deal.leadId`, and
   * three real cases break it — a policy with no deal (migrated, or
   * household-only), a migrated deal whose refs predate
   * `backfill-deal-refs`, and a CRM policy transfer. Such a row can never
   * appear on the Lead Detail timeline, which queries `{ agencyId, leadId }`.
   *
   * It is still recorded, because the alternative is an audit log that silently
   * omits exactly the edits made to the oldest and least-verifiable records.
   * `dealId` and `policyId` are enough for an agency-scoped changelog view to
   * find it later. Note who can even reach these: `loadOwnedPolicy` treats a
   * deal-less policy as out of scope under `own`, so only branch- and
   * agency-scope callers get here — the same people the log is written for.
   */
  private async recordFieldChanges(
    access: AccessContext,
    policy: PolicyDocument,
    leadId: Types.ObjectId | null,
    before: ChangeSnapshot,
  ): Promise<void> {
    const changes = diffSnapshots(
      POLICY_CHANGE_FIELDS,
      before,
      snapshot(POLICY_CHANGE_FIELDS, policy),
    );
    if (!changes.length) return;

    try {
      await this.activityModel.create({
        agencyId: policy.agencyId,
        // Off the record, not a tenant resolve: `branchId` is `required: true`,
        // so a missing one throws inside this catch and loses the row silently.
        branchId: policy.branchId,
        type: 'field_changed',
        // No `policy` member in `ACTIVITY_SUBJECT_TYPES`, and none is needed —
        // `deal` is the surface the edit came from, and it is what makes
        // `toActivityOrigin` render the "Sold deal" chip.
        subjectType: 'deal',
        ...(leadId ? { leadId } : {}),
        ...(policy.dealId ? { dealId: policy.dealId } : {}),
        // Which policy, since a deal can hold several and two edit rows would
        // otherwise be indistinguishable.
        policyId: policy._id,
        userId: new Types.ObjectId(access.userId),
        occurredAt: new Date(),
        // Value-free on purpose — see the `summary` docblock on the schema.
        summary: 'Policy edited',
        // Explicit: the schema default is 'migration', which `toActivityOrigin`
        // renders as the "Imported" chip.
        source: 'internal',
        isTestRecord: false,
        changes,
      });
    } catch (error) {
      this.logger.error(
        `Failed to record the edit log for policy ${policy._id.toString()}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Bring the parent deal's roll-ups back in line with its policies (PAC-56 #25).
   *
   * Until now `PATCH /policies/:id` deliberately left them alone, so correcting
   * a premium on the Sold card left the card's own footer total disagreeing
   * with the rows above it. Item #27 deferred the fix here.
   *
   * ## This moves reported numbers, and that is the point
   *
   * `PerformanceService` sums `deals.premium` for the Sold scorecard and the
   * leaderboard computes attainment and breaks ties on it. A premium correction
   * on the Lead Detail page therefore changes a producer's dashboard figure and
   * possibly their rank. That is the intended behaviour — a scorecard built on
   * numbers known to be wrong is worse — but it belongs in the PR description,
   * not in a commit nobody reads.
   *
   * ## ⚠ Migrated deals are skipped
   *
   * Gated on `premiumSource === 'snapshot'`, i.e. deals **this app created**
   * (`ResolveDealStep` stamps it). A migrated deal's premium is SmartSuite's
   * rollup over rows we may only have partially imported —
   * `LeadDetailDeal.policies` is documented as empty for a migrated deal whose
   * policies carry only `legacyDealId` — so recomputing would silently
   * overwrite a historical figure with the subset we happen to hold. The
   * `policyCount === 0` guard is the second belt on the same trousers.
   *
   * The trade: a typo fix on a migrated deal still will not move its total.
   * That is the safer direction, and it is flagged for the product owner.
   *
   * Best-effort and post-save: the correction is what the producer asked for,
   * and failing the request after it committed would report the wrong outcome.
   */
  private async recomputeDealTotals(policy: PolicyDocument): Promise<void> {
    if (!policy.dealId) return;

    try {
      const deal = await this.dealModel
        .findOne({ _id: policy.dealId, agencyId: policy.agencyId })
        .select('premiumSource');
      if (!deal || deal.premiumSource !== 'snapshot') return;

      const policies = await this.policyModel
        .find({
          agencyId: policy.agencyId,
          dealId: policy.dealId,
          isTestRecord: { $ne: true },
        })
        .select('policyType premium items')
        .lean();

      const totals = derivePersistedDealAggregates(policies);
      // A zero count means the read found nothing it should have found; leaving
      // the stored totals alone beats zeroing a real sale.
      if (totals.policyCount === 0) return;

      await this.dealModel.updateOne({ _id: deal._id }, { $set: totals });
    } catch (error) {
      // `premiumSource` is deliberately left as `snapshot` after a recompute:
      // it records provenance (migrated rollup vs. app snapshot), and rewriting
      // it would muddy exactly the distinction the guard above depends on.
      this.logger.warn(
        `Deal roll-up recompute failed for policy ${policy._id.toString()}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Apply the carrier's policy-number rule to a correction (PAC-56 #20).
   *
   * ⚠ Runs **only when the request changes the number**, deliberately. A
   * carrier-only change on a migrated policy whose stored number predates the
   * rule would otherwise be un-saveable — the same trap `quote-recap-edit.ts`
   * documents for `quoteDocument`: a rule introduced today must not retroactively
   * lock records written before it.
   */
  private async assertPolicyNumberFormat(
    agencyId: string | null,
    carrierName: string | null | undefined,
    policyNumber: string,
  ): Promise<void> {
    if (!carrierName) return;

    const bySlug = await this.carriers.optionsBySlug(agencyId);
    const carrier = bySlug.get(carrierSlug(normalizeCarrier(carrierName)));
    if (!carrier?.policyNumberPattern) return;

    const key = policyNumberKey(policyNumber);
    if (carrierPolicyNumberMatches(carrier.policyNumberPattern, key)) return;

    throw new BadRequestException(
      carrier.policyNumberHint ??
        `"${policyNumber}" is not a valid ${carrier.name} policy number.`,
    );
  }

  /**
   * Load a policy inside the caller's agency and clamp it to their data scope,
   * 404-ing rather than 403-ing in both directions.
   *
   * Ownership is read off the **deal**, exactly as {@link isInScope} explains —
   * `Policy` has no `producerId`. A policy with no deal is unattributable, so
   * under `own` scope it is treated as out of scope: this is the write path, and
   * masking something unattributable is the safe direction.
   *
   * Returns the deal's `leadId` alongside the policy — `null` when the policy
   * has no deal, or the deal no lead. See {@link recordFieldChanges}.
   */
  private async loadOwnedPolicy(
    access: AccessContext,
    branchId: string | null,
    policyId: string,
  ): Promise<{ policy: PolicyDocument; leadId: Types.ObjectId | null }> {
    if (!Types.ObjectId.isValid(policyId)) {
      throw new NotFoundException('Policy not found.');
    }

    const policy = await this.policyModel.findOne({
      _id: new Types.ObjectId(policyId),
      agencyId: access.agencyId,
      isTestRecord: { $ne: true },
    });
    if (!policy) throw new NotFoundException('Policy not found.');

    const deal = policy.dealId
      ? await this.dealModel
          .findById(policy.dealId)
          .select('producerId leadId')
          .lean<{ producerId?: Types.ObjectId; leadId?: Types.ObjectId }>()
      : null;

    if (!this.isInScope(access, branchId, policy, deal ?? undefined)) {
      throw new NotFoundException('Policy not found.');
    }
    // `leadId` rides along rather than being re-fetched: the edit log (PAC-65
    // #9) needs it, this is the only read of the deal on the path, and it is
    // already loaded for the scope check.
    return { policy, leadId: deal?.leadId ?? null };
  }

  /**
   * Ownership lives on the **deal**, not the policy: `Policy` has no
   * `producerId`, and the producer who sold a policy is the producer on its
   * deal.
   *
   * A policy with no deal cannot be attributed, so under `own` scope it is
   * treated as out of scope — masking something unattributable is the safe
   * direction, and migrated policies are the main source of them.
   */
  private isInScope(
    access: AccessContext,
    branchId: string | null,
    policy: PolicyLean,
    deal: { producerId?: Types.ObjectId } | undefined,
  ): boolean {
    switch (access.dataScope) {
      case DataScope.Own:
        return deal?.producerId?.toString() === access.userId;
      case DataScope.Branch:
        return !branchId || policy.branchId === branchId;
      default:
        // Agency scope: everything inside the agency filter is already in scope.
        return true;
    }
  }

  private async loadDeals(
    policies: PolicyLean[],
  ): Promise<
    Map<string, { producerId?: Types.ObjectId; clientName?: string }>
  > {
    const ids = this.uniqueIds(policies.map((p) => p.dealId));
    const map = new Map<
      string,
      { producerId?: Types.ObjectId; clientName?: string }
    >();
    if (!ids.length) return map;

    const deals = await this.dealModel
      .find({ _id: { $in: ids } })
      .select('producerId clientName')
      .lean<
        Array<{
          _id: Types.ObjectId;
          producerId?: Types.ObjectId;
          clientName?: string;
        }>
      >();

    for (const deal of deals) {
      map.set(deal._id.toString(), {
        producerId: deal.producerId,
        clientName: deal.clientName,
      });
    }
    return map;
  }

  /** Fallback client name for a policy whose deal is missing or unnamed. */
  private async loadHouseholdNames(
    policies: PolicyLean[],
  ): Promise<Map<string, string>> {
    const ids = this.uniqueIds(policies.map((p) => p.householdId));
    const map = new Map<string, string>();
    if (!ids.length) return map;

    const households = await this.householdModel
      .find({ _id: { $in: ids } })
      .select('name primaryContactName')
      .lean<
        Array<{
          _id: Types.ObjectId;
          name?: string;
          primaryContactName?: string;
        }>
      >();

    for (const household of households) {
      const name = household.primaryContactName ?? household.name;
      if (name) map.set(household._id.toString(), name);
    }
    return map;
  }

  private uniqueIds(ids: Array<Types.ObjectId | undefined>): Types.ObjectId[] {
    const seen = new Set<string>();
    const out: Types.ObjectId[] = [];
    for (const id of ids) {
      if (!id) continue;
      const key = id.toString();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(id);
    }
    return out;
  }
}
