import { INSURANCE_MONTHS, POLICY_TYPES } from '@sfa/shared';
import { z } from 'zod';
import {
  policyAddressFields,
  requirePolicyPropertyAddress,
} from '../../common/address/policy-property-address';
import { quoteDocumentSchema } from './presign-quote-document.dto';

/**
 * One quoted policy row.
 *
 * Exported so `update-quote-recap.dto.ts` validates rows through exactly this
 * schema — the "a property row that opts out of `sameAsHousehold` needs all four
 * address parts" rule has to be identical on create and edit, and a second copy
 * is how the two would drift.
 */
export const quotedPolicySchema = z
  .object({
    /**
     * Canonical labels only — a raw SmartSuite code is a 400.
     *
     * `normalizePolicyType` exists to *read* legacy data, not to launder input:
     * accepting codes on a write path would put a second vocabulary back into
     * the collection, which is the mess this ticket set out to end.
     */
    policyType: z.enum(POLICY_TYPES),
    premium: z.coerce.number().min(0).max(1_000_000),
    itemCount: z.coerce.number().int().min(1).max(99),
    /**
     * The dwelling **this row** insures (PAC-56 #14). A recap covering a home
     * and a landlord policy describes two buildings; one recap-level address
     * could only ever name one of them.
     *
     * A property policy quoted against a blank address is the `sfaforms`
     * prototype's bug — its address fields are bare `z.string()`, so an empty
     * one validates. `requirePolicyPropertyAddress` is what does not port it.
     */
    ...policyAddressFields,
  })
  .superRefine(requirePolicyPropertyAddress);

export const createQuoteRecapSchema = z.object({
  leadId: z.string().trim().length(24),
  policies: z
    .array(quotedPolicySchema)
    .min(1, 'At least one policy is required')
    .max(12),
  /**
   * When the client's current insurance renews (PAC-56 #16).
   *
   * **This DTO is the only place it is required.** The Mongoose field is
   * optional because migrated recaps predate it, and the patch DTO leaves it
   * optional so those recaps stay editable. Requiring it here is what makes it
   * required of anyone recording a *new* recap, which is what was asked for.
   *
   * Canonical month labels only, for the reason `policyType` above gives:
   * accepting SmartSuite's choice UUIDs on a write path would put a second
   * vocabulary back into the collection.
   */
  insuranceRenewalMonth: z.enum(INSURANCE_MONTHS, {
    message: 'Pick the renewal month',
  }),
  notes: z.string().trim().max(2000).optional(),
  /** Required: a recap without its carrier quote is not accepted (PAC-39 decision 4). */
  quoteDocument: quoteDocumentSchema,
  submissionToken: z.string().trim().min(8).max(200).optional(),
});

export type CreateQuoteRecapDto = z.infer<typeof createQuoteRecapSchema>;
