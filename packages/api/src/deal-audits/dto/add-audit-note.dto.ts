import { z } from 'zod';

/**
 * `POST /deal-audits/deals/:dealId/notes`.
 *
 * "Any user with access can leave notes on the audit throughout" (PAC-72
 * section E). Stored as an ordinary `note` activity hung off the audit, so it
 * shares the timeline vocabulary rather than inventing a comments collection.
 */
export const addAuditNoteSchema = z.object({
  body: z.string().trim().min(1).max(2000),
});

export type AddAuditNoteDto = z.infer<typeof addAuditNoteSchema>;
