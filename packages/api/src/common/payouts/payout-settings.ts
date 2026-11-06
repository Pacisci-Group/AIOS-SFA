import {
  DEFAULT_PRODUCER_OF_YEAR,
  DEFAULT_SALESPERSON_OF_MONTH,
  DEFAULT_TEAM_BONUS,
  type PayoutSettingsView,
  type ProducerOfYearSettings,
  type SalespersonOfMonthSettings,
  type TeamBonusSettings,
} from '@sfa/shared';

/** What a `.lean()` read of `Agency.payouts` may hold — any part may be missing. */
export interface StoredPayoutSettings {
  teamBonus?: Partial<TeamBonusSettings> | null;
  salespersonOfMonth?: Partial<SalespersonOfMonthSettings> | null;
  producerOfYear?: Partial<ProducerOfYearSettings> | null;
}

/**
 * `Agency.payouts` as the rest of the system reads it: every field present.
 *
 * `.lean()` applies no schema defaults, and an agency whose owner never saved
 * the settings has no sub-document at all — so each field falls back to the
 * shared default individually. In `common/` because the monthly statement
 * job (worker) reads the same settings as the settings page (API).
 */
export function payoutSettingsFrom(
  stored: StoredPayoutSettings | null | undefined,
): PayoutSettingsView {
  const team = stored?.teamBonus ?? {};
  const som = stored?.salespersonOfMonth ?? {};
  const poy = stored?.producerOfYear ?? {};
  return {
    teamBonus: {
      enabled: team.enabled ?? DEFAULT_TEAM_BONUS.enabled,
      stackable: team.stackable ?? DEFAULT_TEAM_BONUS.stackable,
      levels: (team.levels ?? DEFAULT_TEAM_BONUS.levels).map((level) => ({
        thresholdPremium: level.thresholdPremium,
        poolAmount: level.poolAmount,
      })),
      csrSharePercent:
        team.csrSharePercent ?? DEFAULT_TEAM_BONUS.csrSharePercent,
      producerSharePercent:
        team.producerSharePercent ?? DEFAULT_TEAM_BONUS.producerSharePercent,
    },
    salespersonOfMonth: {
      enabled: som.enabled ?? DEFAULT_SALESPERSON_OF_MONTH.enabled,
      bonusAmount: som.bonusAmount ?? DEFAULT_SALESPERSON_OF_MONTH.bonusAmount,
    },
    producerOfYear: {
      enabled: poy.enabled ?? DEFAULT_PRODUCER_OF_YEAR.enabled,
      bonusAmount: poy.bonusAmount ?? DEFAULT_PRODUCER_OF_YEAR.bonusAmount,
      minCompliantMonths:
        poy.minCompliantMonths ?? DEFAULT_PRODUCER_OF_YEAR.minCompliantMonths,
      minCompliancePercent:
        poy.minCompliancePercent ??
        DEFAULT_PRODUCER_OF_YEAR.minCompliancePercent,
    },
  };
}
