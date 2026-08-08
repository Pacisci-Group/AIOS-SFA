import type {
  LeaderboardEntry,
  LeaderboardResponse,
  LeaderboardSelf,
} from '@sfa/shared';
import { apiFetch } from '@/lib/api-client';

export type { LeaderboardEntry, LeaderboardResponse, LeaderboardSelf };

export interface GetLeaderboardParams {
  /** `YYYY-MM`. Defaults server-side to the current agency month. */
  month?: string;
  limit?: number;
}

/**
 * The Motivation Hub (PAC-13).
 *
 * Takes a **month**, not a range — goals are stored per producer per month, so
 * the dashboard's time chips deliberately do not drive this card. See
 * `LeaderboardResponse` in `@sfa/shared` for the privacy contract: entries
 * carry a rank and a percentage, never another producer's dollars.
 */
export function getLeaderboard(params: GetLeaderboardParams = {}) {
  const search = new URLSearchParams();
  if (params.month) search.set('month', params.month);
  if (params.limit != null) search.set('limit', String(params.limit));
  const qs = search.toString();

  return apiFetch<LeaderboardResponse>(`/leaderboard${qs ? `?${qs}` : ''}`);
}
