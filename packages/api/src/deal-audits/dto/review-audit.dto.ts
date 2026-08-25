import { AUDIT_REVIEW_DECISIONS, DEAL_AUDIT_REASON_CODES } from '@sfa/shared';
import { z } from 'zod';

/**
 * `POST /deal-audits/deals/:dealId/review` — the reviewer's verdict.
 *
 * `approve` → Pass · `request_changes` → Fail · `send_back` → Not Submitted.
 * The last two both return the audit to its assignee and differ only in
 * meaning; they stay separate so the timeline can say which happened.
 */
export const reviewAuditSchema = z
  .object({
    decision: z.enum(AUDIT_REVIEW_DECISIONS),
    /**
     * Why it failed. Vocabulary is SmartSuite's own — see
     * `DEAL_AUDIT_REASON_CODES`. Ignored on an approval, where the field is
     * meaningless.
     */
    reasonCodes: z.array(z.enum(DEAL_AUDIT_REASON_CODES)).max(6).optional(),
    /** Auditor's notes, stored on the audit and echoed to the timeline. */
    notes: z.string().trim().max(2000).optional(),
    /** 0–100. Optional: not every agency scores. */
    score: z.coerce.number().int().min(0).max(100).optional(),
  })
  .refine(
    (value) =>
      value.decision !== 'request_changes' ||
      (value.reasonCodes?.length ?? 0) > 0,
    {
      // The brief's whole point in asking for reason codes: "it failed" with no
      // stated reason gives the assignee nothing to act on, and the correction
      // loop then just bounces.
      message: 'Give at least one reason code when requesting changes.',
      path: ['reasonCodes'],
    },
  );

export type ReviewAuditDto = z.infer<typeof reviewAuditSchema>;
