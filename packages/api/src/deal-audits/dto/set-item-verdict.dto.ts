import { AUDIT_ITEM_VERDICTS } from '@sfa/shared';
import { z } from 'zod';

/**
 * `PATCH /deal-audits/:itemId/verdict` — the manager's ruling on one item
 * (PAC-106).
 *
 * Both fields are optional, but at least one must be sent:
 *
 * - `verdict`: `pass` / `fail`, or `null` to withdraw a ruling. Omitted leaves
 *   the ruling as it is — so the page can save a note on its own.
 * - `note`: the manager's note; an empty string clears it. Omitted leaves it.
 */
export const setItemVerdictSchema = z
  .object({
    verdict: z.enum(AUDIT_ITEM_VERDICTS).nullable().optional(),
    note: z.string().trim().max(2000).optional(),
  })
  .refine((value) => value.verdict !== undefined || value.note !== undefined, {
    message: 'Send a verdict, a note, or both.',
  });

export type SetItemVerdictDto = z.infer<typeof setItemVerdictSchema>;
