import {
  HOUSEHOLD_MEMBER_ROLES,
  POLICY_TYPES,
  SELECTABLE_LEAD_SOURCE_OPTIONS,
  isPropertyPolicyType,
} from '@sfa/shared';
import { z } from 'zod';

const ADDRESS_FIELDS = ['street', 'city', 'state', 'zip'] as const;

/** `Test` (ENEJP) is excluded — it must never be selectable at intake. */
const SELECTABLE_LEAD_SOURCE_CODES = SELECTABLE_LEAD_SOURCE_OPTIONS.map(
  (option) => option.code,
) as [string, ...string[]];

const name = z.string().trim().min(1).max(60);
const dateOfBirth = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of birth must be YYYY-MM-DD');

const person = z.object({
  firstName: name,
  lastName: name,
  dateOfBirth,
  phone: z.string().trim().min(10).max(20),
  email: z.string().trim().email().max(160),
});

const member = z.object({
  firstName: name,
  lastName: name,
  /** Optional for members — only the primary contact must supply a DOB. */
  dateOfBirth: dateOfBirth.optional(),
  role: z.enum(HOUSEHOLD_MEMBER_ROLES),
});

/**
 * The household's **living** address.
 *
 * Optional in the API even though the web form requires it. A partial
 * submission that still identifies a person is worth strictly more than a 400:
 * rejecting it loses the lead entirely, and the address only powers a dedupe
 * signal that degrades gracefully when absent.
 */
const address = z.object({
  street: z.string().trim().max(200).optional(),
  city: z.string().trim().max(120).optional(),
  state: z.string().trim().max(60).optional(),
  zip: z.string().trim().max(20).optional(),
});

/**
 * One requested policy. Canonical labels only — a raw SmartSuite code is a 400,
 * the same rule the Quote Recap DTO applies: `normalizePolicyType` exists to
 * *read* legacy data, not to launder input.
 */
const policyOfInterestSchema = z.object({
  policyType: z.enum(POLICY_TYPES),
  itemCount: z.coerce.number().int().min(1).max(99),
});

const propertyAddressSchema = z.object({
  street: z.string().trim().max(200),
  city: z.string().trim().max(120),
  state: z.string().trim().max(60),
  zip: z.string().trim().max(20),
});

/** Fields shared by the authenticated and public intake forms. */
export const leadIntakeBaseSchema = z.object({
  primaryContact: person,
  address: address.optional(),
  members: z.array(member).max(10).default([]),
  /**
   * What the submitter wants quoted (PAC-56 #2) — the same rows the Quote Recap
   * takes, minus premium, because it is the same question asked earlier and no
   * premium exists yet. Legacy captured nothing like it at intake; the nearest
   * ancestor is Quote Recaps `Product(s) Quoted` (`s1e17612aa`), which is where
   * `POLICY_TYPES` came from.
   *
   * Optional here while the web form requires at least one, for the same reason
   * `address` is: a partial submission that still identifies a person beats a
   * 400 that loses the lead outright.
   */
  policiesOfInterest: z.array(policyOfInterestSchema).max(12).default([]),
  /**
   * The insured dwelling (PAC-56 #6). Defaults to "same as household" so a
   * client that sends neither field gets the sane answer rather than a lead
   * with a property policy and no address at all.
   */
  sameAsHousehold: z.boolean().default(true),
  propertyAddress: propertyAddressSchema.optional(),
  quoteControlNumber: z.string().trim().max(60).optional(),
  /**
   * Client-generated, stable for the lifetime of one form session — that is
   * what makes a retry after a failed submit idempotent rather than duplicating.
   */
  submissionToken: z.string().trim().min(8).max(200).optional(),
});

/**
 * A property-type policy needs a dwelling address — the same rule, and the same
 * wording, as `createQuoteRecapSchema`. Applied to each final schema rather than
 * to the base, because `.superRefine` returns a `ZodEffects` and `.extend` is
 * gone after that.
 *
 * Nothing to require while `sameAsHousehold` is set: the server copies the
 * household's own address and discards whatever the client sent.
 */
function requirePropertyAddress(
  value: {
    sameAsHousehold: boolean;
    policiesOfInterest: { policyType: string }[];
    propertyAddress?: Record<string, string | undefined>;
  },
  ctx: z.RefinementCtx,
): void {
  if (value.sameAsHousehold) return;
  if (!value.policiesOfInterest.some((p) => isPropertyPolicyType(p.policyType)))
    return;

  for (const field of ADDRESS_FIELDS) {
    if (!value.propertyAddress?.[field]?.trim()) {
      ctx.addIssue({
        code: 'custom',
        path: ['propertyAddress', field],
        message: 'Required when a property policy is requested',
      });
    }
  }
}

/** `POST /leads` — the authenticated form, where lead source is required. */
export const createLeadSchema = leadIntakeBaseSchema
  .extend({
    leadSourceCode: z.enum(SELECTABLE_LEAD_SOURCE_CODES),
  })
  .superRefine(requirePropertyAddress);

export type CreateLeadDto = z.infer<typeof createLeadSchema>;

/**
 * `POST /public/leads/:token` — the same fields **minus** `leadSourceCode`.
 *
 * Lead source is internal vocabulary (Quotewizard, Soleo, Data Lot, JYA) and is
 * never shown to an outside submitter; a producer sets it afterwards. Because
 * zod strips unknown keys, an injected `leadSourceCode` — or `agencyId`,
 * `producerId`, `branchId` — is silently discarded here, and `LeadIntakeService`
 * reads none of them anyway. Two independent layers.
 */
export const publicCreateLeadSchema = leadIntakeBaseSchema.superRefine(
  requirePropertyAddress,
);

export type PublicCreateLeadDto = z.infer<typeof publicCreateLeadSchema>;
