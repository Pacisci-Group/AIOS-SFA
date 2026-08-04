import { POLICY_TYPES } from '@sfa/shared';
import { z } from 'zod';
import { findCrossBranchDiscounts } from '../intake/sold.normalize';

/** A 24-char hex ObjectId. Mongoose would throw a 500 on anything else. */
const objectId = z
  .string()
  .trim()
  .length(24, 'Invalid id')
  .regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

/** `YYYY-MM-DD`, the shape an `<input type="date">` submits. */
const ymd = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Not a real date');

/**
 * An uploaded document the client has already PUT to storage.
 *
 * `contentType` and `size` are accepted but **not trusted** — the service
 * re-derives both from the stored object (PR4). They are here so the client can
 * render the attachment before the round-trip completes.
 */
const attachment = z.object({
  key: z.string().trim().min(1).max(512),
  filename: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(120),
  size: z.coerce.number().int().nonnegative(),
});

/** Selected + "do you have proof?" + the proof itself. */
const proofBackedDiscount = z
  .object({
    selected: z.boolean().default(false),
    hasProof: z.boolean().default(false),
    attachment: attachment.optional(),
  })
  .default(() => ({ selected: false, hasProof: false }))
  .superRefine((value, ctx) => {
    if (value.selected && value.hasProof && !value.attachment) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Attach the proof document, or answer "no proof".',
        path: ['attachment'],
      });
    }
  });

const discounts = z
  .object({
    // Home / Renters / Condominium / Landlord
    escrow: z.boolean().default(false),
    fireSubscription: proofBackedDiscount,
    roofReceipt: proofBackedDiscount,
    acvPersonalProperty: z.boolean().default(false),
    acvDwellingProtection: z.boolean().default(false),
    // Auto / Auto - Special / Motorcycle
    drivewise: z.boolean().default(false),
    defensiveDriver: z
      .object({
        selected: z.boolean().default(false),
        drivers: z
          .array(
            z.object({
              name: z.string().trim().min(1, 'Name the driver').max(120),
              contactId: objectId.optional(),
            }),
          )
          .max(10, 'At most 10 drivers')
          .default([]),
      })
      // A factory, not a literal: `{ drivers: [] }` reused across policies
      // would hand every one the same array instance.
      .default(() => ({ selected: false, drivers: [] }))
      .superRefine((value, ctx) => {
        if (value.selected && value.drivers.length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Select at least one driver.',
            path: ['drivers'],
          });
        }
      }),
    studentDiscount: proofBackedDiscount,
  })
  // A policy the wizard sent no Card 5 answers for means "no discounts", not
  // "unknown" — so the shape is always present and audit generation can read it
  // without null-checks.
  .default(() => ({
    escrow: false,
    fireSubscription: { selected: false, hasProof: false },
    roofReceipt: { selected: false, hasProof: false },
    acvPersonalProperty: false,
    acvDwellingProtection: false,
    drivewise: false,
    defensiveDriver: { selected: false, drivers: [] },
    studentDiscount: { selected: false, hasProof: false },
  }));

const escrowDetails = z.object({
  loanNumber: z.string().trim().min(1, 'Enter the loan number').max(60),
  companyName: z.string().trim().min(1, 'Enter the escrow company').max(160),
  address: z.object({
    street: z.string().trim().min(1, 'Required').max(200),
    city: z.string().trim().min(1, 'Required').max(120),
    state: z.string().trim().min(1, 'Required').max(60),
    zip: z.string().trim().min(1, 'Required').max(20),
  }),
});

/** One iteration of the wizard's Card 2 → Card 7 loop. */
const soldPolicySchema = z
  .object({
    // Card 2 — canonical labels only. `normalizePolicyType` exists for *reading*
    // legacy data, not for laundering input on a write path.
    policyType: z.enum(POLICY_TYPES),
    // Card 3
    effectiveDate: ymd,
    carrier: z.string().trim().min(1, 'Enter the carrier').max(120),
    policyNumber: z.string().trim().min(1, 'Enter the policy number').max(60),
    /**
     * Set when `GET /policies/check` matched and the producer confirmed "this
     * is the same policy". Re-validated server-side against the caller's agency
     * *and* data scope — without that this field is a cross-producer write
     * primitive.
     */
    existingPolicyId: objectId.optional(),
    // Card 4
    premium: z.coerce
      .number()
      .nonnegative('Premium must be 0 or greater')
      .max(1_000_000, 'Too large'),
    itemCount: z.coerce
      .number()
      .int('Whole numbers only')
      .min(1, 'At least 1 item')
      .max(99, 'Too many'),
    // Card 5
    discounts,
    escrow: escrowDetails.optional(),
    // Card 6
    priorInsurance: z
      .object({
        /** The "No prior [Type] insurance" toggle. */
        none: z.boolean().default(false),
        carrier: z.string().trim().max(120).optional(),
        agentName: z.string().trim().max(120).optional(),
      })
      .default({ none: false }),
    // Card 7
    cancellation: z
      .object({
        cancelled: z.boolean().default(false),
        effectiveDate: ymd.optional(),
      })
      .default({ cancelled: false }),
  })
  .superRefine((policy, ctx) => {
    if (!policy.priorInsurance.none && !policy.priorInsurance.carrier?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Name the prior carrier, or tick "no prior insurance".',
        path: ['priorInsurance', 'carrier'],
      });
    }

    if (policy.cancellation.cancelled && !policy.cancellation.effectiveDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Enter the cancellation effective date.',
        path: ['cancellation', 'effectiveDate'],
      });
    }

    // Escrow's sub-card is required *because* it was ticked — the audit item it
    // generates is "verify loan number, company and address", which is
    // unanswerable without them.
    if (policy.discounts.escrow && !policy.escrow) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Escrow details are required when escrow is selected.',
        path: ['escrow'],
      });
    }
  });

export const createSoldDealSchema = z
  .object({
    /**
     * Lead-scoped, not household-scoped — the same call PAC-39 made. Legacy
     * rejects a sold log with no lead, and resolving the household server-side
     * is what stops a client claiming one it does not own.
     */
    leadId: objectId,
    /** Card 1 — one sold date for the whole deal. */
    soldDate: ymd,
    /** Optional: not every sale has a recorded quote. */
    quoteRecapId: objectId.optional(),
    policies: z
      .array(soldPolicySchema)
      .min(1, 'Add at least one policy')
      .max(10, 'At most 10 policies per submission'),
    submissionToken: z.string().trim().min(8).max(200).optional(),
  })
  .superRefine((dto, ctx) => {
    // Cross-branch discounts are rejected rather than stripped: a Home policy
    // claiming Drivewise would otherwise generate an auto audit item for a deal
    // with no auto line, and nothing downstream could tell it was bogus.
    for (const problem of findCrossBranchDiscounts(dto.policies)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: problem,
        path: ['policies'],
      });
    }

    // Two rows claiming the same number in one submission would race each other
    // through the upsert and leave one silently overwriting the other.
    const seen = new Set<string>();
    dto.policies.forEach((policy, index) => {
      const key = policy.policyNumber.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!key) return;
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'This policy number is already on this submission.',
          path: ['policies', index, 'policyNumber'],
        });
      }
      seen.add(key);
    });
  });

export type CreateSoldDealDto = z.infer<typeof createSoldDealSchema>;

/** Query DTO for `GET /sold-deals/context`. */
export const soldDealContextSchema = z.object({ leadId: objectId });
export type SoldDealContextDto = z.infer<typeof soldDealContextSchema>;
