import { AUDIT_REVIEW_DECISIONS, DEAL_AUDIT_REASON_CODES } from '@sfa/shared';
import { z } from 'zod';

/**
 * `POST /deal-audits/deals/:dealId/review` — the reviewer's verdict.
 *
 * `approve` → Pass · `request_changes` → Fail · `send_back` → Not Submitted.
 * The last two both return the audit to its assignee and differ only in
 * meaning; they stay separate so the timeline can say which happened.
 *
 * The Deal Audit page's **Send back** button is `request_changes` (PAC-106):
 * `Fail` is what the producer's board shows in red with a Fix it action.
 */
export const reviewAuditSchema = z
  .object({
    decision: z.enum(AUDIT_REVIEW_DECISIONS),
    /**
     * Why it failed. Vocabulary is SmartSuite's own — see
     * `DEAL_AUDIT_REASON_CODES`. Ignored on an approval, where the field is
     * meaningless. Optional since PAC-106: the failed items and the note now
     * say what is wrong.
     */
    reasonCodes: z.array(z.enum(DEAL_AUDIT_REASON_CODES)).max(6).optional(),
    /** Auditor's notes, stored on the audit and echoed to the timeline. */
    notes: z.string().trim().max(2000).optional(),
    /** 0–100. Optional: not every agency scores. */
    score: z.coerce.number().int().min(0).max(100).optional(),
  })
  .refine(
    (value) =>
      value.decision !== 'request_changes' || (value.notes?.length ?? 0) > 0,
    {
      // "It failed" with nothing stated gives the assignee nothing to act on,
      // and the correction loop just bounces. The note is also what the
      // producer's red card and the notification say (PAC-106 §4).
      message: 'Say what needs fixing when sending an audit back.',
      path: ['notes'],
    },
  );

export type ReviewAuditDto = z.infer<typeof reviewAuditSchema>;
