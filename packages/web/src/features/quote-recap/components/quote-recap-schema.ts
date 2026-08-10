import type {
  QuoteDocumentMeta,
  QuoteRecapEditView,
  QuoteRecapPolicyInput,
  UpdateQuoteRecapInput,
} from "@sfa/shared";
import { INSURANCE_MONTHS, POLICY_TYPES } from "@sfa/shared";
import { z } from "zod";
import {
  emptyPolicyAddress,
  policyAddressInput,
  policyAddressShape,
  requirePolicyPropertyAddress,
} from "@/lib/property-address-rule";
import { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES } from "@/lib/quote-recaps-api";
import { numericString } from "@/lib/zod-helpers";

/**
 * One quoted policy, dwelling included (PAC-56 #14).
 *
 * Premium and item count stay **strings** in form state and are converted at
 * the submit boundary ({@link toPolicyInputs}) — see {@link numericString} for
 * why coercion in the schema is the wrong shape here.
 *
 * The `sfaforms` prototype's address fields are bare `z.string()`, so a property
 * policy with a completely blank address validates there;
 * `requirePolicyPropertyAddress` is what does not port that bug.
 */
export const quotedPolicySchema = z
  .object({
    policyType: z.enum(POLICY_TYPES),
    premium: numericString({
      required: "Enter a premium",
      min: 0,
      max: 1_000_000,
      tooSmall: "Premium must be 0 or greater",
      tooLarge: "Too large",
    }),
    itemCount: numericString({
      required: "Enter an item count",
      min: 1,
      max: 99,
      tooSmall: "At least 1 item",
      tooLarge: "Too many",
      integer: "Whole numbers only",
    }),
    ...policyAddressShape,
  })
  .superRefine(requirePolicyPropertyAddress);

export type QuotedPolicyFormValues = z.infer<typeof quotedPolicySchema>;

/**
 * A blank row for a freshly opened drawer.
 *
 * Premium starts empty so the field reads blank rather than pre-seeded with a
 * misleading 0. "Same as household" defaults to whatever the caller can back up
 * — on with an address on file, off without, since a ticked box over four blank
 * disabled fields strands the producer.
 */
export function emptyQuotedPolicy(sameAsHousehold: boolean): QuotedPolicyFormValues {
  return {
    policyType: "Auto",
    premium: "",
    itemCount: "1",
    sameAsHousehold,
    propertyAddress: emptyPolicyAddress(),
  };
}

/** A newly chosen file, whichever form is asking for one. */
const quoteDocumentFile = z
  .instanceof(File, { message: "Attach the quote document" })
  .refine(
    (f) => (ALLOWED_UPLOAD_TYPES as readonly string[]).includes(f.type),
    "Use a PDF",
  )
  .refine(
    (f) => f.size > 0 && f.size <= MAX_UPLOAD_BYTES,
    "File must be under 10MB",
  );

/** Everything both forms agree on. */
const quoteRecapBaseShape = {
  policies: z
    .array(quotedPolicySchema)
    .min(1, "Add at least one policy")
    .max(12, "At most 12 policies"),
  notes: z.string().trim().max(2000, "Too long").optional(),
};

export const quoteRecapSchema = z.object({
  ...quoteRecapBaseShape,
  /** Required (PAC-39 decision 4) — no recap without its carrier quote. */
  quoteDocument: quoteDocumentFile,
  /**
   * Required on create (PAC-56 #16). Outside `quoteRecapBaseShape` for exactly
   * the reason `quoteDocument` is: the edit schema has to accept `""`, because
   * every migrated recap predates the field and requiring it would make all of
   * them un-saveable.
   */
  insuranceRenewalMonth: z.enum(INSURANCE_MONTHS, {
    message: "Pick the renewal month",
  }),
});

/**
 * The same form in **edit** mode (PAC-56 #11).
 *
 * Two schemas over one shared shape rather than a discriminated union: TanStack
 * Form's `defaultValues` type drives every literal `form.Field name=` path, so a
 * union would make `quoteDocument`'s type depend on a discriminant the form
 * would have to carry as a real field. Here `QuoteRecapFormState` stays a single
 * stable type and `QuoteRecapForm` compiles once for both modes.
 *
 * `quoteDocument` is optional because the recap already has one. Absent means
 * "keep it" all the way to the API — which is also what keeps a pre-PAC-56-#9
 * recap holding a JPEG editable, since re-validating the stored document would
 * reject exactly those records.
 */
export const quoteRecapEditSchema = z.object({
  ...quoteRecapBaseShape,
  quoteDocument: quoteDocumentFile.optional(),
  /**
   * `""` is accepted here and nowhere else. A recap recorded before PAC-56 #16
   * has no month; rejecting that would lock every migrated recap out of the
   * edit form over a field its author was never asked for.
   */
  insuranceRenewalMonth: z.union([z.enum(INSURANCE_MONTHS), z.literal("")]),
});

export type QuoteRecapFormValues = z.infer<typeof quoteRecapSchema>;

/** Form strings → the numeric wire shape, once validation has passed. */
export function toPolicyInputs(
  policies: QuoteRecapFormValues["policies"],
): QuoteRecapPolicyInput[] {
  return policies.map((p) => ({
    policyType: p.policyType,
    premium: Number(p.premium),
    itemCount: Number(p.itemCount),
    sameAsHousehold: p.sameAsHousehold,
    // Dropped for a row that owns no address — see `policyAddressInput`.
    propertyAddress: policyAddressInput(p),
  }));
}

/**
 * What the form **holds while being filled**, as distinct from what is valid on
 * submit: `quoteDocument` legitimately starts unset, while the create schema
 * requires it.
 *
 * It is now literally the edit schema's output type, which is the same
 * statement said once instead of twice — "what the form holds" and "what a valid
 * edit looks like" are the same shape by construction, so they cannot drift.
 *
 * {@link parseQuoteRecap} closes the gap at the create submit boundary.
 */
export type QuoteRecapFormState = z.infer<typeof quoteRecapEditSchema>;

/**
 * Form state → validated values. Validation has already run by the time this is
 * called, so this is a real check that also narrows `quoteDocument` to present —
 * not a cast pretending it is.
 */
export function parseQuoteRecap(state: QuoteRecapFormState): QuoteRecapFormValues {
  return quoteRecapSchema.parse(state);
}

/** The edit-mode counterpart: `quoteDocument` may legitimately stay absent. */
export function parseQuoteRecapEdit(
  state: QuoteRecapFormState,
): z.infer<typeof quoteRecapEditSchema> {
  return quoteRecapEditSchema.parse(state);
}

/**
 * Blank form state.
 *
 * No seeded policy row: policies are added through the drawer (PAC-56 #15), and
 * an "Auto ×1" the producer never opened would be a row they never confirmed.
 * The schema's `.min(1)` is what insists on one.
 */
export function emptyQuoteRecap(): QuoteRecapFormState {
  return {
    policies: [],
    insuranceRenewalMonth: "",
    notes: "",
    quoteDocument: undefined,
  };
}

/**
 * Stored recap → form state (PAC-56 #11).
 *
 * Mirrors `features/lead/components/policy-schema.ts`'s `toPolicyFormValues`:
 * numbers become strings because that is what the inputs hold, and nothing is
 * silently rewritten on the way in.
 */
export function toQuoteRecapFormValues(
  view: QuoteRecapEditView,
): QuoteRecapFormState {
  const canCopyHouseholdAddress = Boolean(view.context.householdAddress);

  return {
    policies: view.policies.map((policy) => ({
      /*
       * Seeded verbatim, even though a migrated row can hold a type that
       * `normalizePolicyType` passed through uncatalogued. Such a row fails
       * `z.enum(POLICY_TYPES)` and the producer has to pick a type in the
       * drawer — which is the honest outcome. Defaulting it to "Auto" would
       * rewrite the record on the first unrelated save.
       */
      policyType: policy.policyType as QuotedPolicyFormValues["policyType"],
      premium: String(policy.premium),
      itemCount: String(policy.itemCount),
      /*
       * The producer's stored choice, plus the same fallback
       * `emptyQuotedPolicy` applies: a property row that has no address on
       * file, on a household that has one to copy, starts toggled **on** so
       * nobody is faced with four blank disabled fields.
       */
      sameAsHousehold:
        policy.sameAsHousehold ||
        (!policy.propertyAddress && canCopyHouseholdAddress),
      propertyAddress: policy.propertyAddress
        ? {
            street: policy.propertyAddress.street ?? "",
            city: policy.propertyAddress.city ?? "",
            state: policy.propertyAddress.state ?? "",
            zip: policy.propertyAddress.zip ?? "",
          }
        : emptyPolicyAddress(),
    })),
    /*
     * Seeded verbatim like `policyType` above, and for the same reason: an
     * unrecognised stored month fails the enum and the producer has to pick
     * one, rather than being silently rewritten. `null` (a migrated recap)
     * becomes `""`, which the edit schema accepts.
     */
    insuranceRenewalMonth:
      (view.insuranceRenewalMonth as QuoteRecapFormState["insuranceRenewalMonth"]) ??
      "",
    notes: view.notes ?? "",
    // Never a `File` — an already-attached document is metadata, and leaving
    // this unset is what tells the API to keep it.
    quoteDocument: undefined,
  };
}

/**
 * Form state → the `PATCH /quote-recaps/:id` body.
 *
 * `quoteDocument` is passed separately because the file has to be uploaded to
 * storage first; omitting the key entirely is what keeps the existing document.
 */
export function toUpdateQuoteRecapInput(
  values: QuoteRecapFormState,
  quoteDocument?: QuoteDocumentMeta,
): UpdateQuoteRecapInput {
  return {
    policies: toPolicyInputs(values.policies),
    // Sent only when set. `""` — a migrated recap the producer left alone —
    // would fail the API's enum, and the patch has no way to express "clear
    // it", so omitting is the honest encoding of "unchanged".
    ...(values.insuranceRenewalMonth
      ? { insuranceRenewalMonth: values.insuranceRenewalMonth }
      : {}),
    // `null` clears; the API distinguishes it from absent.
    notes: values.notes?.trim() ? values.notes.trim() : null,
    ...(quoteDocument ? { quoteDocument } : {}),
  };
}
