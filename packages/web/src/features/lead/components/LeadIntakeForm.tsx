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
import { LeadPolicySheet } from "./LeadPolicySheet";
import {
  emptyLeadIntake,
  emptyPolicyOfInterest,
  makeLeadIntakeSchema,
  type LeadIntakeFormValues,
  type LeadIntakeVariant,
  type LeadPolicyFormValues,
} from "./lead-intake-schema";

interface LeadIntakeFormProps {
  /**
   * Which entry point this is, and the only thing the two differ on:
   *
   * - **Lead source** is asked on `internal` only. It is internal vocabulary
   *   (Quotewizard, Soleo, Data Lot, JYA) — meaningless, sometimes revealing, to
   *   an outside submitter — so a producer sets it after the fact.
   * - **Policies of interest** are asked on `public` only. PAC-56 #2 scopes the
   *   question to the prospect stating what they want quoted; a producer at
   *   `/leads/new` records it on the Quote Recap instead.
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
 */
export function LeadIntakeForm({
  variant,
  submitting,
  errorMessage,
  submitLabel = "Create lead",
  onSubmit,
}: LeadIntakeFormProps) {
  const isPublic = variant === "public";
  const form = useAppForm({
    defaultValues: emptyLeadIntake(),
    validators: { onBlur: makeLeadIntakeSchema(variant) },
    onSubmit: ({ value }) => onSubmit(value),
  });
  const [editor, setEditor] = useState<PolicyEditorState | null>(null);

  return (
    <form.AppForm>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
        className="space-y-6"
        noValidate
      >
        <FormSection title="Primary contact">
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
        </FormSection>

        <FormSection
          title="Household address"
          description={
            isPublic
              ? // The public form asks for the dwelling per policy below, so
                // pointing at the quote would send the submitter looking for a
                // step they will never see.
                "Where the household lives. A property policy can name a different address when you add it below."
              : "Where the household lives — not the insured property address, which is captured on the quote."
          }
        >
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
        </FormSection>

        {!isPublic ? (
          <FormSection title="Lead source">
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
          </FormSection>
        ) : null}

        <FormSection
          title="Additional household members"
          description="Spouse, children, and any other drivers on the policy."
        >
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
        </FormSection>

        {/*
          * Public form only. PAC-56 #2 asks the *prospect* what they want
          * quoted; the internal form is unchanged from PAC-37, and a producer
          * records the same thing on the Quote Recap with real premiums.
          *
          * Each policy is captured in a drawer (#15) carrying its own dwelling
          * address (#14), so someone insuring the home they live in and a
          * rental they let out can describe both.
          */}
        {isPublic && (
          <FormSection
            title="Policies of interest"
            description="What would you like quoted? Add one for each policy."
          >
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
                    // The array's own `.min(1)` is an `onBlur` rule, and
                    // removing a row fires no blur — without this, emptying the
                    // list leaves it looking valid until submit.
                    field.handleBlur();
                  }}
                />
              )}
            </form.Field>
          </FormSection>
        )}

        <FormError>{errorMessage}</FormError>

        <Button
          type="submit"
          variant="brand"
          disabled={submitting}
          className="w-full sm:w-auto active:scale-95"
        >
          {submitting ? "Submitting…" : submitLabel}
        </Button>
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
 * the submitter is typing into the household section of this very form.
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
