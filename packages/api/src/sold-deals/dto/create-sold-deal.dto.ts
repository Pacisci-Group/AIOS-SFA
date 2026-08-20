import { CANCELLED_BY_OPTIONS, CARRIER_OTHER, POLICY_TYPES } from '@sfa/shared';
import type { SoldPolicyDiscounts } from '@sfa/shared';
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
 * Selected, plus the proof for it if the producer has one.
 *
 * ⚠ **The attachment is optional** (PAC-65, reversing PAC-56 #21). Ticking the
 * box generates the audit item either way — the upload only decides whether the
 * auditor verifies a document in place or is told to call the client and obtain
 * it. Requiring it up front blocked producers on paperwork they may not hold,
 * which is what David asked us to undo.
 *
 * There is deliberately no `hasProof` flag: `selected && !attachment` already
 * *is* the "no proof, chase it" state, and a second stored boolean could
 * disagree with the attachment. A stale client still sending the key is
 * ignored rather than rejected — zod strips unknown keys on `z.object`.
 */
const proofBackedDiscount = z
  .object({
    selected: z.boolean().default(false),
    attachment: attachment.optional(),
  })
  .default(() => ({ selected: false }));

const discounts = z
  .object({
    // Home / Renters / Condominium / Landlord
    escrow: z.boolean().default(false),
    fireSubscription: proofBackedDiscount,
    roofReceipt: proofBackedDiscount,
    acvPersonalProperty: z.boolean().default(false),
    acvDwellingProtection: z.boolean().default(false),
    // Auto / Auto - Special / Motorcycle
    // ⚠ A bare boolean, and the one option here generating **no audit item**
    // (PAC-65): there is no document that proves enrolment in a driving app,
    // and knowing Drivewise is on the policy is all the service team needs.
    drivewise: z.boolean().default(false),
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
      // Naming the drivers is still required — the audit generator emits one
      // item per name, so an unnamed selection produces a single item nobody
      // can act on. Their certificates are optional (PAC-65).
      .superRefine((value, ctx) => {
        if (!value.selected) return;
        if (value.drivers.length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Select at least one driver.',
            path: ['drivers'],
          });
        }
      }),
    studentDiscount: proofBackedDiscount,
    // Every policy type — see UNIVERSAL_DISCOUNT_KEYS. Deliberately outside
    // both branch lists, so `findCrossBranchDiscounts` never rejects it on a
    // Life or Umbrella line.
    priorInsuranceDiscount: z.boolean().default(false),
  })
  // A policy the wizard sent no discount answers for means "no discounts", not
  // "unknown" — so the shape is always present and audit generation can read it
  // without null-checks.
  .default(() => ({
    escrow: false,
    fireSubscription: { selected: false },
    roofReceipt: { selected: false },
    acvPersonalProperty: false,
    acvDwellingProtection: false,
    drivewise: false,
    defensiveDriver: { selected: false, drivers: [] },
    studentDiscount: { selected: false },
    priorInsuranceDiscount: false,
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

/**
 * Everything one policy row carries on **both** write paths — the Sold form and
 * the Policy Transfer.
 *
 * Split out from `soldPolicySchema` so the transfer can reuse the shape without
 * copying it. Prior insurance and cancellation are deliberately *not* here: they
 * are the one part of a sold policy a transfer never asks for, since the policy
 * being replaced is already in our own book rather than at another carrier.
 */
export const policyBaseSchema = z.object({
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
});

/**
 * The escrow rules, shared by both write paths.
 *
 * Extracted rather than duplicated because a transfer carries escrow exactly as
 * a sale does — the discount and its statement travel with the client, not with
 * the fact that money changed hands.
 */
function refineEscrow(
  policy: { discounts: { escrow: boolean }; escrow?: unknown },
  ctx: z.RefinementCtx,
): void {
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

  // The statement itself is **not** required (PAC-65). David: the audit is
  // based on the keyed-in loan detail above, not on an attachment.
}

export { refineEscrow };

/** One iteration of the Sold wizard's per-policy loop. */
const soldPolicySchema = policyBaseSchema
  .extend({
    priorInsurance: z
      .object({
        /** The "No prior [Type] insurance" toggle. */
        none: z.boolean().default(false),
        carrier: carrierName(120).optional(),
        agentName: z.string().trim().max(120).optional(),
        /** "Proof of Insurance" — the declarations page. See the refine below. */
        attachment: attachment.optional(),
      })
      .default({ none: false }),
    // Asked inside the prior-insurance card since #24.
    cancellation: z
      .object({
        cancelled: z.boolean().default(false),
        effectiveDate: ymd.optional(),
        cancelledBy: z.enum(CANCELLED_BY_OPTIONS).optional(),
        /** Resolved and agency-checked in the service — never trusted as sent. */
        cancelledByUserId: objectId.optional(),
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

    // Who cancelled it (PAC-65 #11). Required whenever there *was* a
    // cancellation — a dropdown nobody has to answer is a dropdown nobody
    // answers, and the whole point is knowing who to ask about it later.
    if (policy.cancellation.cancelled && !policy.cancellation.cancelledBy) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Say who cancelled the prior insurance.',
        path: ['cancellation', 'cancelledBy'],
      });
    }

    // "SFA staff" without a name is the answer that helps nobody.
    if (
      policy.cancellation.cancelledBy === 'SFA staff' &&
      !policy.cancellation.cancelledByUserId
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Name the staff member who cancelled it.',
        path: ['cancellation', 'cancelledByUserId'],
      });
    }

    // The prior agent (PAC-65 #10). Required now, where it used to be an
    // "Optional"-placeholdered free-text — the service team calls this person
    // to chase the cancellation and the declarations page.
    if (!policy.priorInsurance.none && !policy.priorInsurance.agentName?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Name the prior agent.',
        path: ['priorInsurance', 'agentName'],
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

    /*
     * The second cross-card invariant, of exactly the same kind (PAC-65 #18).
     * Ticking "prior insurance" on the discounts card and "no prior insurance"
     * here is a contradiction; David: *"if they select prior insurance, that
     * top button should not be a selection."*
     *
     * The UI disables the toggle, but this is **rejected, not stripped** —
     * picking a winner server-side means silently discarding one of two answers
     * the producer gave, and neither is safe to drop: clearing `none` invents
     * prior coverage, clearing the discount loses the declarations page and the
     * audit item that chases it.
     */
    if (policy.discounts.priorInsuranceDiscount && policy.priorInsurance.none) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Prior insurance was claimed on the discounts card, so this policy cannot have none.',
        path: ['priorInsurance', 'none'],
      });
    }

    /*
     * ⚠ The one upload on this form that is **required** (PAC-65 #18).
     *
     * Every Card 5 proof became optional, but this is not a discount proof: the
     * declarations page is what Allstate wants to see for the coverage period
     * the producer keyed in, and failing to supply it in time gets the policy
     * cancelled or repriced. Optional here would be a different, worse rule.
     */
    if (
      policy.discounts.priorInsuranceDiscount &&
      !policy.priorInsurance.none &&
      !policy.priorInsurance.attachment
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Attach the proof of insurance (the declarations page).',
        path: ['priorInsurance', 'attachment'],
      });
    }

    refineEscrow(policy, ctx);
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
  .superRefine(refinePolicyBatch);

/**
 * The two whole-submission rules, shared by both write paths.
 *
 * A transfer loops over policies exactly as a sale does, so both traps apply
 * unchanged — this is factored out rather than duplicated so they cannot drift.
 */
export function refinePolicyBatch(
  dto: {
    policies: {
      policyNumber: string;
      policyType: string;
      discounts?: SoldPolicyDiscounts;
    }[];
  },
  ctx: z.RefinementCtx,
): void {
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
}

export type CreateSoldDealDto = z.infer<typeof createSoldDealSchema>;

/**
 * One policy row as the **intake steps** see it, from either write path.
 *
 * `fromPolicyId` is optional here and set only by the transfer: the steps are
 * shared, so their input type is the union of what the two schemas produce
 * rather than either one of them.
 */
export type SoldIntakePolicy = CreateSoldDealDto['policies'][number] & {
  fromPolicyId?: string;
};

/**
 * What the intake pipeline actually consumes.
 *
 * **`leadId` is deliberately absent.** No step reads it off the DTO — it comes
 * from `SoldIntakeContext`, where it is now optional — so typing the steps on
 * this rather than on `CreateSoldDealDto` is what lets a leadless transfer run
 * the identical pipeline. `CreateSoldDealDto` is assignable to it.
 */
export type SoldIntakeDto = Omit<CreateSoldDealDto, 'leadId' | 'policies'> & {
  policies: SoldIntakePolicy[];
};

/** Query DTO for `GET /sold-deals/context`. */
export const soldDealContextSchema = z.object({ leadId: objectId });
export type SoldDealContextDto = z.infer<typeof soldDealContextSchema>;
