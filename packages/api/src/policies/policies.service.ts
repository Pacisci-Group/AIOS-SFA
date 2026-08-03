import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  DataScope,
  normalizePolicyType,
  policyTypeQueryValues,
} from '@sfa/shared';
import type {
  AccessContext,
  PolicyCheckMatch,
  PolicyCheckResponse,
} from '@sfa/shared';
import { FilterQuery, Model, Types } from 'mongoose';
import { Deal, DealDocument } from '../deals/schemas/deal.schema';
import {
  Household,
  HouseholdDocument,
} from '../households/schemas/household.schema';
import { CheckPolicyDto } from './dto/check-policy.dto';
import { normalizePolicyNumber } from './policy-number';
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

@Injectable()
export class PoliciesService {
  constructor(
    @InjectModel(Policy.name)
    private readonly policyModel: Model<PolicyDocument>,
    @InjectModel(Deal.name) private readonly dealModel: Model<DealDocument>,
    @InjectModel(Household.name)
    private readonly householdModel: Model<HouseholdDocument>,
  ) {}

  /**
   * Find existing policies with the same number, so Card 3 can offer to link
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
