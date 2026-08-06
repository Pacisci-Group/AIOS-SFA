import { z } from 'zod';

/**
 * Query params for `GET /leaderboard`.
 *
 * Deliberately **no `range`**. See `@sfa/shared`'s `LeaderboardResponse`: goals
 * are stored per producer per month, so any window that is not a calendar month
 * would require prorating a monthly target, which nobody has specified.
 */
export const getLeaderboardSchema = z.object({
  /** `YYYY-MM`. Defaults to the current month in the agency timezone. */
  month: z
    .string()
    .trim()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'month must be in YYYY-MM form.')
    .optional(),
  /**
   * How many ranked rows to return. The caller's own row is appended beyond
   * this when they fall outside it, so the array can be `limit + 1` long.
   */
  limit: z.coerce.number().int().min(1).max(25).default(5),
});

/** Inferred TypeScript type — single source of truth for the parsed query. */
export type GetLeaderboardDto = z.infer<typeof getLeaderboardSchema>;
