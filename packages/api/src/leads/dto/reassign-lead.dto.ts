import { z } from 'zod';

/**
 * `PATCH /leads/:id/assignment` (PAC-72 section D).
 *
 * Deliberately **not** a fourth field on `update-lead.dto.ts`. That schema is
 * the Lead Detail inline edits — status, temperature, source — where each
 * Select fires one field. Reassignment differs on every axis that matters: it
 * needs `agency:users:read` on top of `leads:write`, it can be refused by the
 * sold-lead freeze, and it writes a `lead_reassigned` activity. Folding it in
 * would also put the known status flip-flop gap in two places instead of one.
 */
export const reassignLeadSchema = z.object({
  /** The incoming owner's user id. */
  producerId: z
    .string()
    .trim()
    .regex(/^[a-f0-9]{24}$/i, 'Expected a user id.'),
});

export type ReassignLeadDto = z.infer<typeof reassignLeadSchema>;
