import type {
  PerformanceMetric,
  PerformanceRange,
  PerformanceRangeKey,
  PerformanceResponse,
} from '@sfa/shared';
import { apiFetch } from '@/lib/api-client';

// Re-exported so components import their types from the client they call,
// rather than reaching past it into `@sfa/shared` for a contract this module
// already owns.
export type {
  PerformanceMetric,
  PerformanceRange,
  PerformanceRangeKey,
  PerformanceResponse,
};

export interface GetPerformanceParams {
  range: PerformanceRangeKey;
  /** `YYYY-MM-DD`, inclusive. Required when `range === 'custom'`. */
  from?: string;
  to?: string;
  scope?: 'own' | 'agency';
}

/**
 * Sold + Quoted scorecards for one window (PAC-10 / PAC-11).
 *
 * The server echoes the window it resolved back on `range`, so the card labels
 * come from the response rather than being recomputed here — the client never
 * has to work out what "this month" means in the agency's timezone.
 */
export function getPerformance(params: GetPerformanceParams) {
  const search = new URLSearchParams({ range: params.range });
  if (params.from) search.set('from', params.from);
  if (params.to) search.set('to', params.to);
  if (params.scope) search.set('scope', params.scope);

  return apiFetch<PerformanceResponse>(`/performance?${search.toString()}`);
}
