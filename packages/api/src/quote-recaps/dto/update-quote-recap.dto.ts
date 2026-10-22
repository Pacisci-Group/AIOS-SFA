import { INSURANCE_MONTHS } from '@sfa/shared';
import { z } from 'zod';
import { clearable, trimmedText } from '../../common/dto/clearable';
import { quotedPolicySchema } from './create-quote-recap.dto';
import { quoteDocumentSchema } from './presign-quote-document.dto';
import { ymd } from '../../common/dto/business-date.dto';

/**
 * `PATCH /quote-recaps/:id` — the Quote Summary card's edit button (PAC-56 #11).
 *
 * Every field optional; at least one required. Absent means "leave alone",
 * matching `dto/update-policy.dto.ts`.
 *
 * ## What is deliberately not editable
 *
 * `leadId` / `householdId` — re-parenting a recap to a different lead is a merge,
 * not an edit, and nothing in the UI can express it.
 *
 * `premium` / `itemCount` / `productsQuoted` — derived server-side from
 * `policies`, and recomputed on every patch that sends them.
 *
 * `submissionToken` — its partial unique index guards against duplicate
 * *creates*. Rewriting it here would break the create-replay guarantee: a `POST`
 * carrying the original token would stop matching and mint a second recap.
 *
 * `recapStatus` — no UI writes it yet; adding it here would be speculative.
 */
export const updateQuoteRecapSchema = z
  .object({
    /**
     * Move the quote to another day (PAC-159): the sold-date edit's own rule,
     * so the two cannot disagree about what a date is. The service moves the
     * recap only when the day actually differs, and bounds it — not in the
     * future, not before the lead, not after a sale sold from this quote.
     */
    quoteDate: ymd.optional(),
    /**
     * **Full replacement**, not a per-row patch — see the note on
     * `UpdateQuoteRecapInput.policies` in `@sfa/shared`. Validated through the
     * create DTO's own row schema so the per-row address rule cannot diverge.
     */
    policies: z
      .array(quotedPolicySchema)
      .min(1, 'At least one policy is required')
      .max(12)
      .optional(),
    /**
     * Optional here even though the create DTO requires it (PAC-56 #16).
     *
     * Not an oversight: every migrated recap predates the field, and requiring
     * it on the patch would make all of them un-editable — the same trap
     * `quoteDocument` below documents. No `null` clear, because no UI expresses
     * "unset the renewal month".
     */
    insuranceRenewalMonth: z
      .enum(INSURANCE_MONTHS, { message: 'Pick the renewal month' })
      .optional(),
    notes: clearable(trimmedText(2000)),
    /**
     * Present replaces the document; absent keeps it. `null` is **not** accepted
     * — a recap without its carrier quote is not a legal state, so a caller who
     * means it should see a 400 rather than a silent no-op.
     */
    quoteDocument: quoteDocumentSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update.',
  });

export type UpdateQuoteRecapDto = z.infer<typeof updateQuoteRecapSchema>;
