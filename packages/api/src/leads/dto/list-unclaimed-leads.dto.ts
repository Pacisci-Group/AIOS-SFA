import { z } from 'zod';

/**
 * Query params for `GET /leads/unclaimed` (PAC-138).
 *
 * No `page`/`pageSize`: the pool is a dashboard panel with a count badge, not a
 * paged table — the response carries `total` separately so the badge can exceed
 * what the list shows.
 *
 * No `scope` either, unlike `GET /leads` and `GET /leads/hot`. Those accept a
 * client `scope` because it can only ever *narrow* a caller who might see more.
 * Here "unclaimed" already means "owned by nobody", so `scope: 'own'` would ask
 * for leads that are both unowned and owned by the caller — an empty set with a
 * plausible-looking name. See `UnclaimedLeadsService` for the clamp that does
 * apply.
 */
export const listUnclaimedLeadsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

/** Inferred TypeScript type — single source of truth for the parsed query. */
export type ListUnclaimedLeadsDto = z.infer<typeof listUnclaimedLeadsSchema>;
