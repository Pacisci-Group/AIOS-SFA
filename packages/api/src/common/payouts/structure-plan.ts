import {
  compareRuleCarriers,
  normalizeRateRules,
  structurePlanDefaults,
  type BonusTier,
  type MemberStart,
  type OverrideRuleView,
  type RateRule,
} from '@sfa/shared';
import type { Types } from 'mongoose';
import type { PaymentStructure } from '../../payouts/schemas/payment-structure.schema';

/**
 * A stored payment structure's rules as the wire and the engine read them,
 * every 2026 comp-plan part filled (`structurePlanDefaults`): a structure
 * saved before the parts existed has none of the fields, and `.lean()`
 * applies no schema default. One mapper, so the settings page and the
 * statement job (worker) can never read a structure differently.
 */

type StoredStructure = Pick<
  PaymentStructure,
  | 'rules'
  | 'individualTiers'
  | 'basePay'
  | 'stipendAmounts'
  | 'memberStarts'
  | 'complianceFloor'
  | 'overrides'
  | 'agencyTiers'
  | 'agencyTiersCarrier'
  | 'teamRequirements'
  | 'referralRule'
  | 'chargebackWindowMonths'
>;

/** Rate rules with their steps, as stored (carriers sorted, steps lowest first). */
export function storedRateRules(
  rules: StoredStructure['rules'] | undefined,
): Required<RateRule>[] {
  return normalizeRateRules(
    (rules ?? []).map((rule) => ({
      carrier: rule.carrier,
      ratePercent: rule.ratePercent,
      minBundleRatePercent: rule.minBundleRatePercent ?? null,
      stepBasis: rule.stepBasis ?? 'premium',
      steps: (rule.steps ?? []).map((step) => ({
        threshold: step.threshold,
        ratePercent: step.ratePercent,
        bonusAmount: step.bonusAmount ?? 0,
        minCompliancePercent: step.minCompliancePercent ?? null,
        minBundleRatePercent: step.minBundleRatePercent ?? null,
      })),
    })),
  );
}

/** Monthly tiers with their compliance gates. */
export function storedTiers(
  tiers: StoredStructure['individualTiers'] | undefined,
): BonusTier[] {
  return (tiers ?? []).map((tier) => ({
    thresholdPremium: tier.thresholdPremium,
    bonusAmount: tier.bonusAmount,
    minCompliancePercent: tier.minCompliancePercent ?? null,
  }));
}

/**
 * The comp-plan parts, defaults filled, overrides' sources named (`labels`
 * is `LeadSourcesService.labelsFor` / `leadSourceLabels`).
 */
export function storedPlan(
  doc: StoredStructure,
  labels: ReadonlyMap<string, string>,
) {
  const plan = structurePlanDefaults({
    basePay: doc.basePay,
    stipendAmounts: doc.stipendAmounts,
    memberStarts: (doc.memberStarts ?? []).map((start): MemberStart => ({
      userId: String(start.userId),
      startMonth: start.startMonth,
    })),
    complianceFloor: doc.complianceFloor,
    overrides: (doc.overrides ?? []).map((rule) => ({
      basis: rule.basis,
      leadSourceId: rule.leadSourceId ? String(rule.leadSourceId) : null,
      carrier: rule.carrier,
      ratePercent: rule.ratePercent,
    })),
    agencyTiers: doc.agencyTiers,
    agencyTiersCarrier: doc.agencyTiersCarrier,
    teamRequirements: doc.teamRequirements,
    referralRule: doc.referralRule,
    chargebackWindowMonths: doc.chargebackWindowMonths,
  });
  const overrides: OverrideRuleView[] = plan.overrides
    .map((rule) => ({
      ...rule,
      leadSourceName: rule.leadSourceId
        ? (labels.get(rule.leadSourceId) ?? '')
        : null,
    }))
    .sort(
      (a, b) =>
        a.basis.localeCompare(b.basis) ||
        (a.leadSourceName ?? '').localeCompare(b.leadSourceName ?? '') ||
        compareRuleCarriers(a.carrier, b.carrier),
    );
  return { ...plan, overrides };
}

/** A member's start month on `doc`, `null` when none is set. */
export function memberStartMonth(
  doc: Pick<PaymentStructure, 'memberStarts'>,
  userId: string | Types.ObjectId,
): string | null {
  const key = String(userId);
  return (
    (doc.memberStarts ?? []).find((start) => String(start.userId) === key)
      ?.startMonth ?? null
  );
}
