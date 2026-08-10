import { CARRIER_OTHER, POLICY_TYPES } from '@sfa/shared';
import { z } from 'zod';
import { policyNumberKey } from '../../policies/policy-number';
import { findCrossBranchDiscounts } from '../intake/sold.normalize';

/**
 * A carrier name as submitted.
 *
 * Still a free string, deliberately: the catalog (PAC-56 #19) constrains what
 * the wizard *offers*, but its "Other" escape exists so an unseeded carrier
 * never blocks a sale, and migrated data holds names that predate the list. The
 * one thing rejected is the client's own sentinel, which must never be
 * persisted as a carrier name.
 */
const carrierName = (max: number) =>
  z
    .string()
    .trim()
    .max(max, 'Too long')
    .refine((value) => value !== CARRIER_OTHER, 'Name the carrier');

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

/**
 * Selected + the proof for it.
 *
 * ⚠ `hasProof` is **deliberately absent** (PAC-56 #21). The "no — send it to
 * the audit" fork is gone: selecting a discount now requires its document. The
 * key is dropped rather than rejected — zod strips unknown keys on `z.object`
 * — so a stale SPA bundle still sending it is silently ignored during a
 * rollout instead of 400-ing, and nothing new is ever persisted with it.
 */
const proofBackedDiscount = z
  .object({
    selected: z.boolean().default(false),
    attachment: attachment.optional(),
  })
  .default(() => ({ selected: false }))
  .superRefine((value, ctx) => {
    if (value.selected && !value.attachment) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Attach the proof document for this discount.',
        path: ['attachment'],
      });
    }
  });

const discounts = z
  .object({
    // Home / Renters / Condominium / Landlord
    escrow: z.boolean().default(false),
    // New in PAC-56 #21 — legacy's `Passed Home Inspection` was never ported.
    inspection: proofBackedDiscount,
    fireSubscription: proofBackedDiscount,
    roofReceipt: proofBackedDiscount,
    acvPersonalProperty: z.boolean().default(false),
    acvDwellingProtection: z.boolean().default(false),
    // Auto / Auto - Special / Motorcycle
    drivewise: proofBackedDiscount,
    defensiveDriver: z
      .object({
        selected: z.boolean().default(false),
        drivers: z
          .array(
            z.object({
              name: z.string().trim().min(1, 'Name the driver').max(120),
              contactId: objectId.optional(),
              attachment: attachment.optional(),
            }),
          )
          .max(10, 'At most 10 drivers')
          .default([]),
      })
      // A factory, not a literal: `{ drivers: [] }` reused across policies
      // would hand every one the same array instance.
      .default(() => ({ selected: false, drivers: [] }))
      .superRefine((value, ctx) => {
        if (!value.selected) return;
        if (value.drivers.length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Select at least one driver.',
            path: ['drivers'],
          });
          return;
        }
        // Per driver, because the certificates are per person and the audit
        // generator emits one item per name (PAC-56 #21).
        value.drivers.forEach((driver, index) => {
          if (!driver.attachment) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Attach this driver's certificate.",
              path: ['drivers', index, 'attachment'],
            });
          }
        });
      }),
    studentDiscount: proofBackedDiscount,
  })
  // A policy the wizard sent no discount answers for means "no discounts", not
  // "unknown" — so the shape is always present and audit generation can read it
  // without null-checks.
  .default(() => ({
    escrow: false,
    inspection: { selected: false },
    fireSubscription: { selected: false },
    roofReceipt: { selected: false },
    acvPersonalProperty: false,
    acvDwellingProtection: false,
    drivewise: { selected: false },
    defensiveDriver: { selected: false, drivers: [] },
    studentDiscount: { selected: false },
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
  /**
   * The escrow statement (PAC-56 #21). Optional in the shape but required by
   * the policy-level rule whenever `discounts.escrow` is ticked — the same
   * place that already requires this whole object.
   */
  attachment: attachment.optional(),
});

/** One iteration of the wizard's per-policy loop. */
const soldPolicySchema = z
  .object({
    // Canonical labels only. `normalizePolicyType` exists for *reading*
    // legacy data, not for laundering input on a write path.
    policyType: z.enum(POLICY_TYPES),
    effectiveDate: ymd,
    carrier: carrierName(120).min(1, 'Enter the carrier'),
    policyNumber: z.string().trim().min(1, 'Enter the policy number').max(60),
    /**
     * Set when `GET /policies/check` matched and the producer confirmed "this
     * is the same policy". Re-validated server-side against the caller's agency
     * *and* data scope — without that this field is a cross-producer write
     * primitive.
     */
    existingPolicyId: objectId.optional(),
    premium: z.coerce
      .number()
      .nonnegative('Premium must be 0 or greater')
      .max(1_000_000, 'Too large'),
    itemCount: z.coerce
      .number()
      .int('Whole numbers only')
      .min(1, 'At least 1 item')
      .max(99, 'Too many'),
    /**
     * The signed new business application for this policy (PAC-56 #23).
     *
     * **Required, and PDF-only** — the one exception to the sold form's
     * PDF-or-image rule. Per policy rather than the five type-keyed columns
     * legacy kept on the Deal (`Auto_`/`Home_`/…): our wizard already loops per
     * policy, legacy's own Policies table carried the same field
     * (`sd61f05a5f`), and two Landlord policies on one deal each need their own
     * application rather than sharing a slot.
     */
    newBusinessApplication: attachment,
    // Discounts & documentation
    discounts,
    escrow: escrowDetails.optional(),
    priorInsurance: z
      .object({
        /** The "No prior [Type] insurance" toggle. */
        none: z.boolean().default(false),
        carrier: carrierName(120).optional(),
        agentName: z.string().trim().max(120).optional(),
      })
      .default({ none: false }),
    // Asked inside the prior-insurance card since #24.
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

    /*
     * "No prior insurance" plus "the prior insurance was cancelled" is a
     * contradiction, and PAC-56 #24 makes it unreachable in the UI — the
     * cancellation question is only asked when prior insurance exists.
     *
     * **Rejected rather than stripped**, following the house rule
     * `findCrossBranchDiscounts` sets out: stripping silently would be worse.
     * And it is not hypothetical — `PriorInsuranceStep` filters to declared
     * policies, so today such a row's cancellation date is *already* dropped on
     * the floor with no `priorPolicies` row to show for it. Better a 400 than a
     * date the producer typed and nobody stored.
     */
    if (policy.priorInsurance.none && policy.cancellation.cancelled) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A policy with no prior insurance cannot have a cancellation.',
        path: ['cancellation'],
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

    // …and its statement, on the same footing as every other discount proof
    // (PAC-56 #21). Reported separately from the details above so the message
    // lands on the field that is actually missing.
    if (policy.discounts.escrow && policy.escrow && !policy.escrow.attachment) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Attach the escrow statement.',
        path: ['escrow', 'attachment'],
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
    /** One sold date for the whole deal, however many policies it covers. */
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
      // `policyNumberKey`, not `normalizePolicyNumber`: the 4-character floor
      // exists to keep the *duplicate warning* meaningful, and does not belong
      // on a write-time collision check. Was a hand-rolled copy of the same
      // expression until PAC-56 #20 split the normalizer.
      const key = policyNumberKey(policy.policyNumber);
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
