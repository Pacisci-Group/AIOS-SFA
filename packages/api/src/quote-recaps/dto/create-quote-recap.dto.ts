import { POLICY_TYPES, isPropertyPolicyType } from '@sfa/shared';
import { z } from 'zod';
import { quoteDocumentSchema } from './presign-quote-document.dto';

const ADDRESS_FIELDS = ['street', 'city', 'state', 'zip'] as const;

const quotedPolicySchema = z.object({
  /**
   * Canonical labels only — a raw SmartSuite code is a 400.
   *
   * `normalizePolicyType` exists to *read* legacy data, not to launder input:
   * accepting codes on a write path would put a second vocabulary back into the
   * collection, which is the mess this ticket set out to end.
   */
  policyType: z.enum(POLICY_TYPES),
  premium: z.coerce.number().min(0).max(1_000_000),
  itemCount: z.coerce.number().int().min(1).max(99),
});

const propertyAddressSchema = z.object({
  street: z.string().trim().max(200),
  city: z.string().trim().max(120),
  state: z.string().trim().max(60),
  zip: z.string().trim().max(20),
});

export const createQuoteRecapSchema = z
  .object({
    leadId: z.string().trim().length(24),
    policies: z
      .array(quotedPolicySchema)
      .min(1, 'At least one policy is required')
      .max(12),
    sameAsHousehold: z.boolean(),
    propertyAddress: propertyAddressSchema.optional(),
    notes: z.string().trim().max(2000).optional(),
    /** Required: a recap without its carrier quote is not accepted (PAC-39 decision 4). */
    quoteDocument: quoteDocumentSchema,
    submissionToken: z.string().trim().min(8).max(200).optional(),
  })
  .superRefine((value, ctx) => {
    // When the flag is set the server copies the household's own address and
    // discards whatever the client sent, so there is nothing to require here.
    if (value.sameAsHousehold) return;
    if (!value.policies.some((p) => isPropertyPolicyType(p.policyType))) return;

    // A property policy quoted against a blank address is the prototype's bug:
    // its address fields are bare `z.string()`, so an empty one validates.
    for (const field of ADDRESS_FIELDS) {
      if (!value.propertyAddress?.[field]?.trim()) {
        ctx.addIssue({
          code: 'custom',
          path: ['propertyAddress', field],
          message: 'Required when a property policy is quoted',
        });
      }
    }
  });

export type CreateQuoteRecapDto = z.infer<typeof createQuoteRecapSchema>;
