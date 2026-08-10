import { SELECTABLE_LEAD_SOURCE_OPTIONS } from "@sfa/shared";
import { useMemo, useState } from "react";
import { FormError, FormGrid, FormSection } from "@/components/form";
import { PolicyList } from "@/components/policies/PolicyList";
import { Button } from "@/components/ui/button";
import { useAppForm } from "@/hooks/form";
import {
  HouseholdMembersShell,
  MemberRowGroup,
  emptyMember,
} from "./HouseholdMembersField";
import { IntakeProgress } from "./IntakeProgress";
import { LeadPolicySheet } from "./LeadPolicySheet";
import {
  emptyLeadIntake,
  emptyPolicyOfInterest,
  makeLeadIntakeSchema,
  type LeadIntakeFormValues,
  type LeadIntakeVariant,
  type LeadPolicyFormValues,
} from "./lead-intake-schema";
import {
  intakeSteps,
  type IntakeStep,
  type IntakeStepId,
} from "./lead-intake-sections";

interface LeadIntakeFormProps {
  /**
   * Which entry point this is, and what the two differ on:
   *
   * - **Lead source** is asked on `internal` only. It is internal vocabulary
   *   (Quotewizard, Soleo, Data Lot, JYA) — meaningless, sometimes revealing, to
   *   an outside submitter — so a producer sets it after the fact.
   * - **Policies of interest** are asked on `public` only. PAC-56 #2 scopes the
   *   question to the prospect stating what they want quoted; a producer at
   *   `/leads/new` records it on the Quote Recap instead.
   * - **Pagination.** The public form is one card per page with a progress bar
   *   (PAC-56 #5); the internal one is the flat stack it has always been.
   */
  variant: LeadIntakeVariant;
  submitting: boolean;
  errorMessage: string | null;
  submitLabel?: string;
  onSubmit: (values: LeadIntakeFormValues) => void;
}

const leadSourceOptions = SELECTABLE_LEAD_SOURCE_OPTIONS.map((o) => ({
  value: o.code,
  label: o.label,
}));

/**
 * Which policy the drawer is on. `index === null` means "adding"; the `key`
 * remounts the drawer's form so its `defaultValues` are re-read — without it,
 * opening policy 2 after policy 1 would show policy 1.
 */
interface PolicyEditorState {
  key: number;
  index: number | null;
  initial: LeadPolicyFormValues;
}

/**
 * The New Lead form itself (PAC-37) — one component behind both entry points.
 *
 * It owns the form state and nothing else: the wrappers own the mutation, the
 * submission token, and what happens on success. That split is what lets the
 * authenticated page navigate to the created lead while the public page shows a
 * bare confirmation, without either duplicating the fields or the validation.
 *
 * The cards themselves are declared once, in `cardContent` below, and the two
 * shells differ only in how many of them are on screen at a time.
 */
export function LeadIntakeForm({
  variant,
  submitting,
  errorMessage,
  submitLabel = "Create lead",
  onSubmit,
}: LeadIntakeFormProps) {
  const isPublic = variant === "public";
  // One schema for the whole component: `validators` below and the per-step
  // checks both read it, and rebuilding it per render would hand the form a new
  // validator object on every keystroke.
  const schema = useMemo(() => makeLeadIntakeSchema(variant), [variant]);
  const form = useAppForm({
    defaultValues: emptyLeadIntake(),
    validators: { onBlur: schema },
    onSubmit: ({ value }) => onSubmit(value),
  });
  const [editor, setEditor] = useState<PolicyEditorState | null>(null);

  const steps = useMemo(() => intakeSteps(variant), [variant]);
  const [stepIndex, setStepIndex] = useState(0);
  const step = steps[stepIndex];
  const atLastStep = stepIndex === steps.length - 1;

  /** Does `path` sit at or under one of `roots`? */
  const owns = (roots: readonly string[], path: string) =>
    roots.some(
      (root) =>
        path === root ||
        path.startsWith(`${root}.`) ||
        path.startsWith(`${root}[`),
    );

  const stepHasErrors = (target: IntakeStep) =>
    Object.entries(form.state.fieldMeta).some(
      ([path, meta]) =>
        owns(target.fields, path) && (meta?.errors.length ?? 0) > 0,
    );

  /**
   * Is this card's slice of the form valid — and, if not, showing why?
   *
   * The same shape as `SoldDealWizard.validateCard`, for the same two reasons,
   * both recorded in `docs/tanstack-form-spike-findings.md` and both silent if
   * you get them wrong:
   *
   * 1. **`validateField`'s return value is unreliable** on a mounted field — it
   *    reports `[]` even when the field is invalid. The verdict has to be read
   *    back out of field meta, which is what `stepHasErrors` does.
   * 2. **`validateAllFields` only walks mounted fields**, so it cannot stand in
   *    for a whole-form check once one card at a time is on screen.
   *
   * `step.fields` are path roots, so they are joined by every path the form has
   * actually registered beneath them — a blank member row errors at
   * `members[0].firstName`, which no static list can name. `validateField` also
   * marks each path touched, which is what lets a blocked step show its errors
   * at all (see `useFieldError`).
   */
  const validateStep = async (target: IntakeStep) => {
    const registered = Object.keys(form.state.fieldMeta) as Array<
      keyof typeof form.state.fieldMeta
    >;
    const paths = new Set([
      ...target.fields,
      ...registered.filter((path) => owns(target.fields, String(path))),
    ]);
    await Promise.all([...paths].map((p) => form.validateField(p, "submit")));
    // One authoritative form-level run, so a path that errors without a mounted
    // field still lands in meta before the scan.
    await form.validate("submit");
    return !stepHasErrors(target);
  };

  /** A card change is a page change — start the new one at the top. */
  const goToStep = (index: number) => {
    setStepIndex(index);
    window.scrollTo({ top: 0 });
  };

  const advance = async () => {
    if (await validateStep(step)) goToStep(stepIndex + 1);
  };

  const submitAll = async () => {
    if (isPublic) {
      // Only the last card is mounted, so `handleSubmit`'s own
      // `validateAllFields` cannot see the earlier ones (trap 2 above). Check
      // the whole form here instead, and send the submitter back to the first
      // card that fails rather than to an error they cannot see.
      await form.validate("submit");
      const failed = steps.findIndex(stepHasErrors);
      if (failed >= 0) {
        // Re-validated so its fields are marked touched — otherwise the card
        // would come back into view looking clean.
        await validateStep(steps[failed]);
        goToStep(failed);
        return;
      }
    }
    await form.handleSubmit();
  };

  /**
   * The sub-line under each card's heading, where it has one.
   *
   * Separate from `cardContent` because it belongs to the card's *header*,
   * which `renderCard` owns — see there for why the heading is not baked into
   * the content.
   */
  const cardDescriptions: Partial<Record<IntakeStepId, React.ReactNode>> = {
    address: isPublic
      ? // The public form asks for the dwelling per policy on a later card, so
        // pointing at the quote would send the submitter looking for a step
        // they will never see.
        "Where the household lives. A property policy can name a different address when you add it later."
      : "Where the household lives — not the insured property address, which is captured on the quote.",
    members: "Spouse, children, and any other drivers on the policy.",
    policies: "What would you like quoted? Add one for each policy.",
  };

  /**
   * Every card's fields, keyed by id. Built eagerly because a React element is
   * only a description of what to render — the paginated shell mounts exactly
   * one of these, so the rest cost nothing.
   */
  const cardContent: Record<IntakeStepId, React.ReactNode> = {
    primaryContact: (
      <FormGrid>
          <form.AppField name="primaryContact.firstName">
            {(f) => (
              <f.TextField
                label="First name"
                autoComplete="given-name"
                inputClassName="bg-card border-border"
              />
            )}
          </form.AppField>
          <form.AppField name="primaryContact.lastName">
            {(f) => (
              <f.TextField
                label="Last name"
                autoComplete="family-name"
                inputClassName="bg-card border-border"
              />
            )}
          </form.AppField>
          <form.AppField name="primaryContact.dateOfBirth">
            {(f) => (
              <f.TextField
                label="Date of birth"
                type="date"
                inputClassName="bg-card border-border"
              />
            )}
          </form.AppField>
          <form.AppField name="primaryContact.phone">
            {(f) => (
              <f.TextField
                label="Phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="(555) 123-4567"
                inputClassName="bg-card border-border"
              />
            )}
          </form.AppField>
          <form.AppField name="primaryContact.email">
            {(f) => (
              <f.TextField
                label="Email"
                type="email"
                inputMode="email"
                autoComplete="email"
                className="sm:col-span-2"
                inputClassName="bg-card border-border"
              />
            )}
          </form.AppField>
      </FormGrid>
    ),

    address: (
      <FormGrid>
          <form.AppField name="address.street">
            {(f) => (
              <f.TextField
                label="Street"
                autoComplete="address-line1"
                className="sm:col-span-2"
                inputClassName="bg-card border-border"
              />
            )}
          </form.AppField>
          <form.AppField name="address.city">
            {(f) => (
              <f.TextField
                label="City"
                autoComplete="address-level2"
                inputClassName="bg-card border-border"
              />
            )}
          </form.AppField>
          <form.AppField name="address.state">
            {(f) => (
              <f.TextField
                label="State"
                autoComplete="address-level1"
                inputClassName="bg-card border-border"
              />
            )}
          </form.AppField>
          <form.AppField name="address.zip">
            {(f) => (
              <f.TextField
                label="ZIP"
                inputMode="numeric"
                autoComplete="postal-code"
                inputClassName="bg-card border-border"
              />
            )}
          </form.AppField>
      </FormGrid>
    ),

    leadSource: (
      <form.AppField name="leadSourceCode">
        {(f) => (
          <f.SelectField
            label="Where did this lead come from?"
            /* `Test` is excluded at the source — a lead created with it
               would be silently hidden from every list. */
            options={leadSourceOptions}
            placeholder="Select a source"
            triggerClassName="w-full bg-card border-border"
          />
        )}
      </form.AppField>
    ),

    members: (
      <form.Field name="members" mode="array">
          {(field) => (
            <HouseholdMembersShell
              count={field.state.value.length}
              onAdd={() => field.pushValue(emptyMember())}
            >
              {field.state.value.map((_, i) => (
                <MemberRowGroup
                  key={i}
                  form={form}
                  fields={`members[${i}]`}
                  index={i}
                  onRemove={() => field.removeValue(i)}
                />
              ))}
            </HouseholdMembersShell>
          )}
      </form.Field>
    ),

    /*
     * Public form only. PAC-56 #2 asks the *prospect* what they want quoted; the
     * internal form is unchanged from PAC-37, and a producer records the same
     * thing on the Quote Recap with real premiums.
     *
     * Each policy is captured in a drawer (#15) carrying its own dwelling
     * address (#14), so someone insuring the home they live in and a rental they
     * let out can describe both.
     */
    policies: (
      <form.Field name="policiesOfInterest" mode="array">
          {(field) => (
            <PolicyList
              policies={field.state.value}
              emptyMessage="No policies added yet — tell us what you'd like quoted."
              error={
                field.state.meta.isTouched
                  ? field.state.meta.errors[0]?.message
                  : undefined
              }
              onAdd={() =>
                setEditor({
                  key: nextEditorKey(),
                  index: null,
                  initial: emptyPolicyOfInterest(),
                })
              }
              onEdit={(index) =>
                setEditor({
                  key: nextEditorKey(),
                  index,
                  initial: field.state.value[index]!,
                })
              }
              onRemove={(index) => {
                field.removeValue(index);
                // The array's own `.min(1)` is an `onBlur` rule, and removing a
                // row fires no blur — without this, emptying the list leaves it
                // looking valid until submit.
                field.handleBlur();
              }}
            />
          )}
      </form.Field>
    ),
  };

  /**
   * One card, header and all.
   *
   * The heading is applied here rather than baked into `cardContent` because
   * the two shells want it in different places: the flat form puts it on the
   * card, while the paginated one hands it to the progress header and leaves
   * the card bare — the same split `SoldDealWizard` uses. Naming it twice on
   * one screen would just be the same words twice.
   */
  const renderCard = (s: IntakeStep) => (
    <FormSection
      key={s.id}
      title={isPublic ? undefined : s.title}
      description={cardDescriptions[s.id]}
    >
      {cardContent[s.id]}
    </FormSection>
  );

  return (
    <form.AppForm>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          // Next is a submit button, so pressing Enter in a field does what
          // clicking it does — advance, or commit on the last card.
          void (isPublic && !atLastStep ? advance() : submitAll());
        }}
        className="space-y-6"
        noValidate
      >
        {isPublic ? (
          <>
            <IntakeProgress
              step={stepIndex + 1}
              total={steps.length}
              title={step.title}
            />
            {renderCard(step)}
          </>
        ) : (
          steps.map(renderCard)
        )}

        <FormError>{errorMessage}</FormError>

        <div className="flex items-center gap-3">
          {isPublic && stepIndex > 0 && (
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={() => goToStep(stepIndex - 1)}
            >
              Back
            </Button>
          )}
          <Button
            type="submit"
            variant="brand"
            disabled={submitting}
            className="ml-auto active:scale-95"
          >
            {isPublic && !atLastStep
              ? "Next"
              : submitting
                ? "Submitting…"
                : submitLabel}
          </Button>
        </div>
      </form>

      {/*
        Outside the `<form>` element: the drawer is a separate form of its own,
        and nesting one inside another is invalid HTML even though Radix
        portals the content to the body anyway.

        Mounted only while open, and keyed by `editor.key`, so `useAppForm`
        re-reads its `defaultValues` every time — which is what makes "edit
        policy 2" show policy 2 rather than whatever was opened first.
      */}
      {editor && (
        <form.Subscribe selector={(s) => s.values.address}>
          {(address) => (
            <HouseholdAddressGate address={address}>
              {(householdAddress) => (
                <LeadPolicySheet
                  key={editor.key}
                  open
                  onOpenChange={(next) => !next && setEditor(null)}
                  initial={editor.initial}
                  isEdit={editor.index !== null}
                  householdAddress={householdAddress}
                  onSave={(policy) => {
                    if (editor.index === null) {
                      form.pushFieldValue("policiesOfInterest", policy);
                    } else {
                      void form.replaceFieldValue(
                        "policiesOfInterest",
                        editor.index,
                        policy,
                      );
                    }
                    // The array's `.min(1)` is an `onBlur` rule and writing to
                    // it from the drawer fires no blur — the mirror of the
                    // `handleBlur()` on remove. Without it, a submitter who is
                    // blocked on "Add at least one policy", then adds one, is
                    // still looking at the error they just fixed.
                    void form.validateField("policiesOfInterest", "submit");
                  }}
                />
              )}
            </HouseholdAddressGate>
          )}
        </form.Subscribe>
      )}
    </form.AppForm>
  );
}

/** Monotonic, so a re-open of the same row still remounts the drawer's form. */
let editorKey = 0;
const nextEditorKey = () => ++editorKey;

interface HouseholdAddressGateProps {
  address: LeadIntakeFormValues["address"];
  children: (
    householdAddress: LeadIntakeFormValues["address"] | null,
  ) => React.ReactNode;
}

/**
 * Builds the address the drawer's "same as household" toggle copies from — what
 * the submitter typed into the household address card.
 *
 * Split out solely so the `useMemo` can exist: `PolicyFields` copies this object
 * inside an effect keyed on its identity, so a fresh object every render would
 * re-run the copy on every keystroke. Memoizing on the four strings — rather
 * than passing `s.values.address` straight through — is what keeps it stable.
 */
function HouseholdAddressGate({ address, children }: HouseholdAddressGateProps) {
  const { street, city, state, zip } = address;
  const householdAddress = useMemo(
    () =>
      // `null` disables the toggle. The one thing worth gating on is the
      // street: copying a city with no street would produce a property address
      // nobody can find.
      street?.trim() ? { street, city, state, zip } : null,
    [street, city, state, zip],
  );

  return <>{children(householdAddress)}</>;
}
