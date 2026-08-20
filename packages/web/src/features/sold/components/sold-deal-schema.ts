import type { CarrierOption, PolicyType, SoldPolicyInput } from "@sfa/shared";
import {
  AUTO_DISCOUNT_KEYS,
  CANCELLED_BY_OPTIONS,
  CARRIER_OTHER,
  POLICY_TYPES,
  PROPERTY_DISCOUNT_KEYS,
  UNIVERSAL_DISCOUNT_KEYS,
  carrierPolicyNumberMatches,
  carrierSlug,
  isAutoPolicyType,
  isPropertyPolicyType,
  policyNumberKey,
} from "@sfa/shared";
import type { DeepKeys } from "@tanstack/react-form";
import { z } from "zod";
import { issuePath, ownsPath } from "@/lib/field-paths";
import { numericString } from "@/lib/zod-helpers";

/**
 * Validation for the Sold wizard (PAC-40).
 *
 * ## Why two schemas rather than one
 *
 * The wizard edits **one policy at a time** and appends it to an array.
 * Validating the whole array on every keystroke would revalidate finished
 * policies, turn error paths into `policies.3.priorInsurance.carrier` soup,
 * and — worst — leak `mode: "onBlur"` touched-state between policies, so
 * entering policy 2 would show policy 1's errors.
 *
 * So the schema here validates **one draft policy**, in its own form, remounted
 * per policy — which is what actually delivers the ticket's "keep per-policy
 * state isolated so the loop doesn't leak selections". The assembled submission
 * is validated by the API's own DTO.
 */

const ymd = z
  .string()
  .trim()
  // Ahead of the format rule so an *empty* date reads as "Enter the date"
  // rather than "Use YYYY-MM-DD". Both issues are raised, and the wizard's
  // blocked-reason hint shows the first — which is now the one that describes
  // what to do rather than what went wrong.
  .min(1, "Enter the date")
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((value) => !Number.isNaN(Date.parse(value)), "Not a real date");

/** An uploaded proof, as the API returns it from the presign flow. */
const attachmentSchema = z.object({
  key: z.string().min(1),
  filename: z.string().min(1),
  contentType: z.string().min(1),
  size: z.number().nonnegative(),
});

/**
 * A discount that can carry its proof — but does not have to (PAC-65).
 *
 * This reverses PAC-56 #21, which required the document up front. Ticking the
 * box generates the audit item either way; the upload only decides whether the
 * auditor verifies a document in place or is told to call the client for it.
 *
 * It is a plain schema rather than #21's `proofSchema(document)` factory: the
 * factory existed only so each required-proof message could name its own
 * document in the wizard's blocking-issues footer. With nothing to block on,
 * the document's name belongs in `ProofField`'s `proofPrompt` — UI copy, not
 * validation. Reintroducing the factory would invite the refine back with it.
 */
const proofSchema = z.object({
  selected: z.boolean(),
  attachment: attachmentSchema.optional(),
});

const discountsSchema = z.object({
  /**
   * A bare boolean: what the audit reads is the keyed-in loan detail on
   * `escrow`, not a document. PAC-65 removed the statement upload, and the
   * sibling `inspection` key with it — there is no document a producer can
   * attach to a passed home inspection, and `Home`/`Landlord Inspection` come
   * from the policy type regardless.
   */
  escrow: z.boolean(),
  fireSubscription: proofSchema,
  roofReceipt: proofSchema,
  acvPersonalProperty: z.boolean(),
  acvDwellingProtection: z.boolean(),
  /** ⚠ Bare boolean, and generates no audit item at all (PAC-65). */
  drivewise: z.boolean(),
  defensiveDriver: z
    .object({
      selected: z.boolean(),
      drivers: z
        .array(
          z.object({
            name: z.string().trim().min(1, "Name the driver").max(120),
            contactId: z.string().optional(),
            /** Per driver, and optional since PAC-65. */
            attachment: attachmentSchema.optional(),
          }),
        )
        .max(10, "At most 10 drivers"),
    })
    // Naming the drivers is still required — the audit generator emits one
    // item per name, so an unnamed selection produces a single item nobody can
    // act on. Their certificates are optional (PAC-65).
    .superRefine((value, ctx) => {
      if (!value.selected) return;
      if (value.drivers.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Add at least one driver.",
          path: ["drivers"],
        });
      }
    }),
  studentDiscount: proofSchema,
  /**
   * Applies to every policy type — see `UNIVERSAL_DISCOUNT_KEYS`. Ticking it
   * makes the prior-insurance card mandatory and its "none" toggle unreachable.
   */
  priorInsuranceDiscount: z.boolean(),
});

const escrowSchema = z.object({
  loanNumber: z.string().trim().min(1, "Enter the loan number").max(60),
  companyName: z.string().trim().min(1, "Enter the escrow company").max(160),
  // Named rather than a bare "Required", so each one still means something in
  // the wizard's list of blocking messages — four identical "Required" lines
  // tell the producer nothing.
  address: z.object({
    street: z.string().trim().min(1, "Enter the escrow street").max(200),
    city: z.string().trim().min(1, "Enter the escrow city").max(120),
    state: z.string().trim().min(1, "Enter the escrow state").max(60),
    zip: z.string().trim().min(1, "Enter the escrow ZIP").max(20),
  }),
  /** The escrow statement (#21). Required by the policy-level rule below. */
  attachment: attachmentSchema.optional(),
});

/**
 * The draft policy's value shape.
 *
 * Split out from the validated schema because the cross-field rules now depend
 * on **data** — each carrier's policy-number pattern — so the schema is built by
 * {@link buildSoldPolicySchema} rather than being a module constant. The value
 * shape is not data-dependent, so the inferred type stays stable.
 */
const soldPolicyShape = z
  .object({
    policyType: z.enum(POLICY_TYPES),
    effectiveDate: ymd,
    /**
     * A catalog carrier name, or {@link CARRIER_OTHER}.
     *
     * The sentinel never leaves the form: `toPolicyInput` swaps it for
     * `carrierOther`, and the API rejects it outright. Kept as a plain string
     * rather than an enum of catalog names because the options arrive at
     * runtime and a migrated value we do not recognise must still round-trip.
     */
    carrier: z.string().trim().min(1, "Select the carrier").max(120, "Too long"),
    /** Only used when `carrier` is the "Other" sentinel. */
    carrierOther: z.string().trim().max(120, "Too long").optional(),
    policyNumber: z
      .string()
      .trim()
      .min(1, "Enter the policy number")
      .max(60, "Too long"),
    /** Set when the producer confirmed the duplicate check's match. */
    existingPolicyId: z.string().optional(),
    /**
     * The policy this one replaces — **transfer variant only**, where the
     * `transferFrom` card requires it (see `buildSoldPolicySchema`).
     *
     * Optional in the shape because the sale variant never shows that card and
     * a required field nobody can fill would block Continue with no message
     * anywhere on screen.
     */
    fromPolicyId: z.string().optional(),
    // Strings in form state; see `numericString` for why not coercion.
    premium: numericString({
      required: "Enter the premium",
      min: 0,
      max: 1_000_000,
      tooSmall: "Premium must be 0 or greater",
      tooLarge: "Too large",
    }),
    itemCount: numericString({
      required: "Enter a count",
      min: 1,
      max: 99,
      tooSmall: "At least 1",
      tooLarge: "Too many",
      integer: "Whole numbers only",
    }),
    /**
     * The signed new business application (PAC-56 #23). Required, PDF-only.
     *
     * `.refine` rather than `.optional()`: the field genuinely starts unset
     * while the card is being filled, but a submission without it is invalid,
     * and the message has to land on the field the producer can act on.
     */
    newBusinessApplication: attachmentSchema.optional().refine(Boolean, {
      message: "Attach the new business application.",
    }),
    discounts: discountsSchema,
    escrow: escrowSchema.optional(),
    priorInsurance: z.object({
      none: z.boolean(),
      carrier: z.string().trim().max(120, "Too long").optional(),
      /** Only used when `priorInsurance.carrier` is the "Other" sentinel. */
      carrierOther: z.string().trim().max(120, "Too long").optional(),
      agentName: z.string().trim().max(120, "Too long").optional(),
      /** "Proof of Insurance" — the declarations page (PAC-65 #18). */
      attachment: attachmentSchema.optional(),
    }),
    // Asked inside the prior-insurance card since #24.
    cancellation: z.object({
      cancelled: z.boolean(),
      effectiveDate: z.union([ymd, z.literal("")]).optional(),
      /** "" until answered — the select's empty state (PAC-65 #11). */
      cancelledBy: z.union([z.enum(CANCELLED_BY_OPTIONS), z.literal("")]),
      cancelledByUserId: z.string().optional(),
    }),
  });

export type SoldPolicyFormValues = z.infer<typeof soldPolicyShape>;

/**
 * Validate the draft policy against the live carrier catalog (PAC-56 #18/#20).
 *
 * A factory rather than a constant because two of the rules are keyed off
 * catalog rows: the "Other" free-text requirement, and each carrier's
 * policy-number format. Memoize it on the carrier list at the call site —
 * TanStack Form re-reads `validators` from its options on every render, so a
 * rebuilt schema takes effect on the next validation run.
 *
 * ⚠ Client-side validation here is an **assist**, not the gate. The same rules
 * are enforced in `SoldDealsService.create`, which is what a stale bundle or a
 * direct API call still has to satisfy.
 */
export function buildSoldPolicySchema(
  carriers: readonly CarrierOption[],
  variant: WizardVariant = "sale",
) {
  const bySlug = new Map(carriers.map((c) => [carrierSlug(c.name), c]));

  return soldPolicyShape.superRefine((policy, ctx) => {
    // Required on a transfer and meaningless on a sale, so it is enforced here
    // rather than in the shape — the sale variant never renders the card that
    // would let anyone satisfy it.
    if (variant === "transfer" && !policy.fromPolicyId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Choose the policy being replaced.",
        path: ["fromPolicyId"],
      });
    }

    if (policy.carrier === CARRIER_OTHER && !policy.carrierOther?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Name the carrier.",
        path: ["carrierOther"],
      });
    }

    // The carrier's own format rule. A carrier absent from the catalog — the
    // "Other" path — carries no pattern and is deliberately unvalidated.
    const carrier = bySlug.get(carrierSlug(policy.carrier));
    if (carrier?.policyNumberPattern && policy.policyNumber) {
      // Tested against the normalized key, so `123-456` satisfies a digits-only
      // rule: that is the form the number is stored and looked up in.
      const key = policyNumberKey(policy.policyNumber);
      if (!carrierPolicyNumberMatches(carrier.policyNumberPattern, key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            carrier.policyNumberHint ??
            `Not a valid ${carrier.name} policy number.`,
          path: ["policyNumber"],
        });
      }
    }

    if (!policy.priorInsurance.none) {
      if (!policy.priorInsurance.carrier?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Name the prior carrier, or tick "no prior insurance".',
          path: ["priorInsurance", "carrier"],
        });
      } else if (
        policy.priorInsurance.carrier === CARRIER_OTHER &&
        !policy.priorInsurance.carrierOther?.trim()
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Name the prior carrier.",
          path: ["priorInsurance", "carrierOther"],
        });
      }
    }

    // Only asked when prior insurance exists (PAC-56 #24), so a `none` policy
    // can never reach this. `toPolicyInput` collapses the pair regardless.
    if (
      !policy.priorInsurance.none &&
      policy.cancellation.cancelled &&
      !policy.cancellation.effectiveDate
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter the cancellation effective date.",
        path: ["cancellation", "effectiveDate"],
      });
    }

    // Who cancelled it (PAC-65 #11) — required whenever there *was* a
    // cancellation. A dropdown nobody has to answer is one nobody answers, and
    // the point is knowing who to ask about it later.
    if (
      !policy.priorInsurance.none &&
      policy.cancellation.cancelled &&
      !policy.cancellation.cancelledBy
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Say who cancelled the prior insurance.",
        path: ["cancellation", "cancelledBy"],
      });
    }
    if (
      !policy.priorInsurance.none &&
      policy.cancellation.cancelledBy === "SFA staff" &&
      !policy.cancellation.cancelledByUserId
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Name the staff member who cancelled it.",
        path: ["cancellation", "cancelledByUserId"],
      });
    }

    // The prior agent (PAC-65 #10). Required now — the service team calls this
    // person to chase the cancellation and the declarations page, so "Optional"
    // was costing them the one contact that makes the rest actionable.
    if (
      !policy.priorInsurance.none &&
      !policy.priorInsurance.agentName?.trim()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Name the prior agent.",
        path: ["priorInsurance", "agentName"],
      });
    }
    /*
     * The cross-card invariant (PAC-65 #18), mirroring the server. Reported at
     * `priorInsurance.none` rather than at the discounts checkbox because that
     * is the control the producer is looking at when they hit it — the
     * discounts card is several steps back by then.
     *
     * The toggle is rendered disabled, so this should be unreachable; it is
     * here because "should be unreachable" is not the same as "is", and the
     * server rejects the pair outright.
     */
    if (policy.discounts.priorInsuranceDiscount && policy.priorInsurance.none) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Prior insurance was claimed on the discounts card. Untick it there, or untick "no prior insurance" here.',
        path: ["priorInsurance", "none"],
      });
    }

    // ⚠ The one **required** upload on this form (PAC-65 #18). Every discount
    // proof became optional; the declarations page did not, because failing to
    // supply it in time gets the policy cancelled or repriced.
    if (
      policy.discounts.priorInsuranceDiscount &&
      !policy.priorInsurance.none &&
      !policy.priorInsurance.attachment
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Attach the proof of insurance (the declarations page).",
        path: ["priorInsurance", "attachment"],
      });
    }

    // Ticking escrow is what makes its sub-card required: the audit item it
    // generates asks the service team to verify exactly these three things.
    //
    // ⚠ The path is `escrow.loanNumber`, **not** `escrow`. Nothing is ever bound
    // to the bare `escrow` root — the panel binds `escrow.loanNumber`,
    // `escrow.companyName` and the four address parts — so an issue reported
    // there could never be rendered, and blocked Continue with no message
    // anywhere on screen. Unreachable in practice now that ticking the box
    // seeds `emptyEscrow()`, but a rule whose message cannot be displayed is
    // not a rule worth keeping either way.
    if (policy.discounts.escrow && !policy.escrow) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter the escrow details.",
        path: ["escrow", "loanNumber"],
      });
    }
    // The statement itself is **not** required (PAC-65) — the audit reads the
    // loan detail keyed in above, not an attachment.
  });
}

/** The built draft-policy schema — see {@link buildSoldPolicySchema}. */
export type SoldPolicySchema = ReturnType<typeof buildSoldPolicySchema>;

export interface SoldDealFormValues {
  soldDate: string;
  policies: SoldPolicyFormValues[];
}

/**
 * A blank policy.
 *
 * ⚠ **A factory that builds every level fresh, not a spread of a constant.**
 * The previous version spread a module-level `EMPTY_POLICY` and deep-cloned only
 * `discounts`, which left `priorInsurance` and `cancellation` shared between
 * every policy in a submission — harmless only because TanStack Form happens to
 * write immutably, and a landmine for anything that does not. With nested
 * attachments and a per-driver array now in the tree, build the whole thing.
 */
export function emptyPolicy(
  variant: WizardVariant = "sale",
): SoldPolicyFormValues {
  return {
    policyType: "Auto",
    effectiveDate: "",
    // Unselected, unlike `policyType`: defaulting the carrier would put a name
    // on the policy the producer never chose, and the catalog is
    // agency-specific.
    carrier: "",
    carrierOther: "",
    policyNumber: "",
    premium: "",
    itemCount: "1",
    newBusinessApplication: undefined,
    discounts: emptyDiscounts(),
    fromPolicyId: "",
    priorInsurance: {
      // A transfer never shows the prior-insurance card, so it defaults to the
      // answer that card would have produced: the policy being replaced is
      // already ours, so there is no prior coverage at another carrier.
      none: variant === "transfer",
      carrier: "",
      carrierOther: "",
      agentName: "",
    },
    cancellation: {
      cancelled: false,
      effectiveDate: "",
      cancelledBy: "",
      cancelledByUserId: "",
    },
  };
}

/**
 * A blank escrow details block.
 *
 * Seeded the moment the escrow box is ticked, and cleared to `undefined` the
 * moment it is un-ticked — see `DiscountsCard`. Holding a *complete* object
 * while the panel is open is what makes `escrowSchema` report all five missing
 * fields against the five inputs on screen; holding **nothing** while it is
 * closed is what stops a half-typed leftover failing `escrowSchema.optional()`
 * from behind a hidden panel, which is how un-ticking escrow used to jam
 * Continue with no message anywhere.
 */
export function emptyEscrow(): NonNullable<SoldPolicyFormValues["escrow"]> {
  return {
    loanNumber: "",
    companyName: "",
    address: { street: "", city: "", state: "", zip: "" },
  };
}

/**
 * Drop every discount that cannot belong to `policyType`, and the escrow block
 * with it.
 *
 * Called when the policy type changes. `discountsSchema` validates all ten
 * keys unconditionally while `DiscountsCard` renders only the branch matching
 * the type, so a discount ticked as Auto and then switched to Home kept failing
 * the schema from behind a control that was no longer on screen — Continue went
 * dead with nothing to read. Clearing at the point the branch stops applying is
 * also what keeps the submission acceptable: the API **rejects** a cross-branch
 * selection (`findCrossBranchDiscounts`) rather than stripping it.
 *
 * Keyed off the same `AUTO_DISCOUNT_KEYS` / `PROPERTY_DISCOUNT_KEYS` the server
 * rejects by, so the two cannot drift. A type in neither branch (Umbrella,
 * Life, Boat Owners, Valuable Item Protection) correctly clears both — and
 * still keeps `UNIVERSAL_DISCOUNT_KEYS`, which apply to every line.
 */
export function clearInapplicableDiscounts(
  policyType: PolicyType,
  values: SoldPolicyFormValues,
): Pick<SoldPolicyFormValues, "discounts" | "escrow"> {
  const blank = emptyDiscounts();
  const branch = isAutoPolicyType(policyType)
    ? AUTO_DISCOUNT_KEYS
    : isPropertyPolicyType(policyType)
      ? PROPERTY_DISCOUNT_KEYS
      : [];
  // ⚠ The universal keys are kept on **every** switch. Omitting them is not a
  // no-op: this function rebuilds from `emptyDiscounts()`, so a key it does not
  // copy forward is silently un-ticked the moment the producer changes the
  // policy type — with the box still on screen and nothing to explain it.
  const keep = [...UNIVERSAL_DISCOUNT_KEYS, ...branch];

  const discounts = { ...blank };
  for (const key of keep) {
    // `as never` only because a union of two key sets indexing one object is
    // beyond what TS narrows here; every key is a real key of `discounts`.
    discounts[key] = values.discounts[key] as never;
  }

  return {
    discounts,
    // Details without their selection are exactly the leftover the schema then
    // fails on invisibly, so they leave together.
    escrow: discounts.escrow ? values.escrow : undefined,
  };
}

/** Also a factory — `drivers: []` must not be one array shared by every policy. */
export function emptyDiscounts(): SoldPolicyFormValues["discounts"] {
  return {
    escrow: false,
    fireSubscription: { selected: false },
    roofReceipt: { selected: false },
    acvPersonalProperty: false,
    acvDwellingProtection: false,
    drivewise: false,
    defensiveDriver: { selected: false, drivers: [] },
    studentDiscount: { selected: false },
    priorInsuranceDiscount: false,
  };
}

/**
 * The wizard's cards, in order.
 *
 * The **sold date** is outside the loop (one per deal); everything from
 * `policyType` to `priorInsurance` is the loop body; `loop` decides whether to
 * run it again.
 *
 * ⚠ Referred to by **name**, never by ordinal. PAC-56 merged cancellation into
 * prior insurance (#24) and added a review card (#25), so every "Card 5" style
 * comment this codebase used to carry is now wrong. Say "the Discounts card".
 */
export const WIZARD_CARDS = [
  "soldDate",
  // Transfer variant only, and first in the loop: you say which policy is being
  // replaced before describing its replacement.
  "transferFrom",
  "policyType",
  "policyDetails",
  "financials",
  // The paperwork, before the discounts that also carry paperwork (#23).
  "application",
  "discounts",
  // Cancellation lives inside this card now (PAC-56 #24) — it is a follow-up
  // question about the prior policy, not a peer step, and asking it of someone
  // who just said "no prior insurance" was a dead end.
  "priorInsurance",
  "loop",
  // Last, after the loop decides it is done (PAC-56 #25). `nextCard` is a
  // linear index bump, so `loop → review → null` falls out for free.
  "review",
] as const;

export type WizardCard = (typeof WIZARD_CARDS)[number];

/**
 * Which flow the wizard is running.
 *
 * A `transfer` is the same form recording the same information — a policy needs
 * the same fields to exist however it came about — with two differences:
 *   - it asks which policy each new one **replaces** (`transferFrom`);
 *   - it does **not** ask for prior insurance, because the policy being
 *     replaced is already in our own book. There is no other carrier to name
 *     and nothing to cancel.
 */
export type WizardVariant = "sale" | "transfer";

/**
 * The ordered cards for a variant.
 *
 * The `WizardCard` **union stays whole** so `CARD_TITLES` and `CARD_FIELDS`
 * remain exhaustive — only the ordered array differs, which is what keeps a new
 * card from silently skipping validation in either flow.
 */
export function cardsFor(variant: WizardVariant): readonly WizardCard[] {
  return variant === "transfer"
    ? WIZARD_CARDS.filter((card) => card !== "priorInsurance")
    : WIZARD_CARDS.filter((card) => card !== "transferFrom");
}

/** Where each variant's loop restarts. */
export function firstLoopCard(variant: WizardVariant): WizardCard {
  return variant === "transfer" ? "transferFrom" : "policyType";
}

export const CARD_TITLES: Record<WizardCard, string> = {
  soldDate: "Sold date",
  transferFrom: "Policy being replaced",
  policyType: "Policy type",
  policyDetails: "Policy details",
  financials: "Financials",
  application: "New business application",
  discounts: "Discounts & documentation",
  priorInsurance: "Prior insurance",
  loop: "Add another policy?",
  review: "Review the sale",
};

/**
 * Which draft fields each card owns.
 *
 * Data rather than scattered logic: "can I advance?" is
 * `validateCard(CARD_FIELDS[card])`, so adding a card cannot forget to validate
 * it.
 *
 * Entries are path **roots**, not necessarily leaves. The wizard validates every
 * path at or under each one, which is how errors zod reports deeper down get
 * caught — `discounts.defensiveDriver.drivers` from a `superRefine`, or an array
 * item like `…drivers[0].name` that no static list could name.
 *
 * Typed `DeepKeys` rather than `keyof`: `form.validateField` takes these
 * directly (the old `keyof` list needed a cast at the call site), and a nested
 * path such as `priorInsurance.carrier` is now nameable if a card ever needs one.
 */
export const CARD_FIELDS: Record<
  WizardCard,
  Array<DeepKeys<SoldPolicyFormValues>>
> = {
  soldDate: [],
  transferFrom: ["fromPolicyId"],
  policyType: ["policyType"],
  // `carrierOther` must be listed explicitly: `owns()` matches a root exactly or
  // followed by `.`/`[`, so `"carrier"` does **not** own `"carrierOther"`, and a
  // blank Other box would sail past Continue with no message anywhere.
  policyDetails: ["effectiveDate", "carrier", "carrierOther", "policyNumber"],
  financials: ["premium", "itemCount"],
  application: ["newBusinessApplication"],
  discounts: ["discounts", "escrow"],
  // Both roots, since PAC-56 #24 merged the cancellation question into this
  // card. `"cancellation"` owns `cancellation.effectiveDate` via the `.` branch.
  priorInsurance: ["priorInsurance", "cancellation"],
  loop: [],
  // The review card edits nothing itself — every value on it was validated by
  // the card that owns it.
  review: [],
};

/** One reason the current card will not let the producer move on. */
export interface CardIssue {
  /** The field path, named the way TanStack Form registers it. */
  path: string;
  message: string;
}

/**
 * Everything blocking `card`, read straight off the schema.
 *
 * ## Why this and not the form's field meta
 *
 * The previous gate scanned `form.state.fieldMeta` for errors under the card's
 * roots. That answered a subtly different question — "does any field the form
 * has *registered* under these roots carry an error?" — and `FormApi` writes
 * form-level errors onto **unmounted** fields too (`validateSync` walks every
 * path in the schema's error map, with no mount check). So a rule failing
 * behind a hidden control blocked Continue while rendering nothing, and there
 * was no way for the wizard to know it had happened.
 *
 * Parsing here instead makes the verdict a pure function of the values, and —
 * the point — hands back the **reasons**, so a blocked card can always say what
 * it is waiting for even when the offending field is not on screen. The two
 * traps in `docs/tanstack-form-spike-findings.md` stop applying: nothing is
 * read back out of meta, and nothing depends on what is mounted.
 *
 * The `loop` card owns no fields of its own and is checked against **all** of
 * them, because its buttons commit the whole draft — `commitDraft` returning
 * `null` was the same dead-button failure one step further on.
 *
 * One issue per path: zod raises `min` and `regex` together on an empty date,
 * and the first is the one that says what to do.
 */
export function blockingIssues(
  schema: SoldPolicySchema,
  card: WizardCard,
  values: SoldPolicyFormValues,
): CardIssue[] {
  const roots = card === "loop" ? ALL_CARD_FIELDS : CARD_FIELDS[card];
  if (roots.length === 0) return [];

  const result = schema.safeParse(values);
  if (result.success) return [];

  const seen = new Set<string>();
  const issues: CardIssue[] = [];
  for (const issue of result.error.issues) {
    const path = issuePath(issue.path, values);
    if (!ownsPath(roots, path) || seen.has(path)) continue;
    seen.add(path);
    issues.push({ path, message: issue.message });
  }
  return issues;
}

/** Every root any card owns — see {@link blockingIssues} on the `loop` card. */
const ALL_CARD_FIELDS = Object.values(CARD_FIELDS).flat();

/**
 * Resolve the "Other" sentinel to the name the producer typed.
 *
 * The sentinel is form state only. It never reaches the wire — the API rejects
 * it outright, precisely so a UI bug here surfaces as a 400 rather than as a
 * carrier literally named `__other__` in the database.
 */
function resolveCarrier(selected: string, other?: string): string {
  return selected === CARRIER_OTHER ? (other?.trim() ?? "") : selected;
}

/** Form strings → the numeric wire shape, once validation has passed. */
export function toPolicyInput(values: SoldPolicyFormValues): SoldPolicyInput {
  return {
    discounts: values.discounts,
    // Only sent when escrow was actually ticked — the server rejects details
    // without the selection, and vice versa.
    escrow: values.discounts.escrow ? values.escrow : undefined,
    policyType: values.policyType,
    effectiveDate: values.effectiveDate,
    // Non-null by validation: the schema requires it before submit is reachable.
    newBusinessApplication: values.newBusinessApplication!,
    carrier: resolveCarrier(values.carrier, values.carrierOther),
    policyNumber: values.policyNumber,
    existingPolicyId: values.existingPolicyId || undefined,
    // Transfer only; the transfer endpoint requires it and the sold one ignores
    // it, so an empty string must not be sent as a malformed id either way.
    fromPolicyId: values.fromPolicyId || undefined,
    premium: Number(values.premium),
    itemCount: Number(values.itemCount),
    priorInsurance: values.priorInsurance.none
      ? { none: true }
      : {
          none: false,
          carrier:
            resolveCarrier(
              values.priorInsurance.carrier ?? "",
              values.priorInsurance.carrierOther,
            ) || undefined,
          agentName: values.priorInsurance.agentName?.trim() || undefined,
          // Dropped in the `none` branch above with the rest of the card — a
          // declarations page for coverage the client does not have is the same
          // kind of leftover the cancellation collapse below guards against.
          attachment: values.priorInsurance.attachment,
        },
    // Normalized, not just collapsed: with no prior insurance there is nothing
    // to cancel, and the API rejects the contradiction rather than stripping it
    // (PAC-56 #24). The UI hides the question in that branch, so this only
    // guards a stale value left behind by un-ticking "no prior insurance" and
    // re-ticking it.
    cancellation:
      values.priorInsurance.none || !values.cancellation.cancelled
        ? { cancelled: false }
        : {
            cancelled: true,
            effectiveDate: values.cancellation.effectiveDate || undefined,
            cancelledBy: values.cancellation.cancelledBy || undefined,
            // Collapsed unless the answer was "SFA staff", the same way the
            // whole cancellation collapses under "no prior insurance": a user
            // id left behind by a changed mind would name the wrong person.
            cancelledByUserId:
              values.cancellation.cancelledBy === "SFA staff"
                ? values.cancellation.cancelledByUserId || undefined
                : undefined,
          },
  };
}
