import { NEW_BUSINESS_MATCH } from '@sfa/shared';
import type { AccessContext, OwnerDashboardPeriod } from '@sfa/shared';
import { buildScopeFilter } from '../access/scope-filter';
import type { DashboardFilterQuery } from '../dashboard/dashboard-filter-query.dto';
import type { DealDocument } from '../../deals/schemas/deal.schema';
import {
  YmdRange,
  resolveComparison,
  resolveRange,
} from '../../performance/performance.range';
import type { QuoteRecapDocument } from '../../quote-recaps/schemas/quote-recap.schema';
import { ymdWindow } from './sales-pipelines';

/**
 * The `$match` half of every sales read the management dashboards make
 * (PAC-135, PAC-139): tenancy + data scope + the producer multi-select, then
 * the window on the right date field.
 *
 * Lifted out of `OwnerDashboardService` when the Manager view became the
 * second page counting sales and quotes per producer. Two copies of "which
 * deals count" are two definitions of a sale waiting to disagree on the same
 * screen-share — the same reason `HOUSEHOLD_KEY_EXPR` is shared.
 */

/** The windows a filter resolves to, plus the echo the response carries. */
export interface ResolvedPeriod {
  period: OwnerDashboardPeriod;
  current: YmdRange;
  previous: YmdRange;
}

export function resolvePeriod(
  query: Pick<DashboardFilterQuery, 'range' | 'from' | 'to'>,
): ResolvedPeriod {
  const custom = { from: query.from, to: query.to };
  const current = resolveRange(query.range, custom);
  const previous = resolveComparison(query.range, custom);
  return {
    current,
    previous,
    period: {
      key: query.range,
      current: { from: current.from, to: current.to },
      previous: { from: previous.from, to: previous.to },
    },
  };
}

/**
 * Tenancy + data scope + the producer multi-select. Narrow-only: the
 * multi-select is applied within the caller's clamp and ignored under `own`.
 */
export function salesScope<T>(
  access: AccessContext,
  branchId: string | null,
  producerIds: readonly string[] | undefined,
) {
  return buildScopeFilter<T>(access, branchId, { producerIds });
}

/** New-business deals sold in the window, within scope. */
export function soldMatch(
  access: AccessContext,
  branchId: string | null,
  producerIds: readonly string[] | undefined,
  range: YmdRange,
): Record<string, unknown> {
  return {
    ...salesScope<DealDocument>(access, branchId, producerIds),
    // `$ne`, never `$eq`: `businessType` is absent on every historic deal.
    ...NEW_BUSINESS_MATCH,
    ...ymdWindow('soldDateYmd', range),
  };
}

/** Quote recaps written in the window, within scope. */
export function quotedMatch(
  access: AccessContext,
  branchId: string | null,
  producerIds: readonly string[] | undefined,
  range: YmdRange,
): Record<string, unknown> {
  return {
    ...salesScope<QuoteRecapDocument>(access, branchId, producerIds),
    ...ymdWindow('quoteDateYmd', range),
  };
}
