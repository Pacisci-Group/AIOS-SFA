import { z } from 'zod';

/**
 * `POST /leads/share-links`.
 *
 * `label` is the only input, and it is display-only — a producer's private note
 * so they can tell their links apart ("Referrals from Dave at First National").
 * It never reaches the created lead.
 *
 * There is deliberately **no `producerId`**: a link is always minted for the
 * caller. That satisfies "a producer cannot generate a link on behalf of another
 * producer" by construction, with no scope-branching to get wrong. Delegation,
 * if it is ever wanted, belongs with the per-use-case link work in PAC-53.
 */
export const createShareLinkSchema = z.object({
  label: z.string().trim().max(120).optional(),
});

export type CreateShareLinkDto = z.infer<typeof createShareLinkSchema>;
