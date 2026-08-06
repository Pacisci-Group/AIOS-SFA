import {
  SELECTABLE_LEAD_SOURCE_OPTIONS,
  isPropertyPolicyType,
} from "@sfa/shared";
import { useMemo } from "react";
import { FormError, FormGrid, FormSection } from "@/components/form";
import {
  PolicyRowGroup,
  PolicyRowsShell,
} from "@/components/policies/PolicyRowsField";
import {
  PropertyAddressFields,
  PropertyAddressSection,
} from "@/components/policies/PropertyAddressSection";
import { Button } from "@/components/ui/button";
import { useAppForm } from "@/hooks/form";
import {
  HouseholdMembersShell,
  MemberRowGroup,
  emptyMember,
} from "./HouseholdMembersField";
import {
  EMPTY_LEAD_INTAKE,
  makeLeadIntakeSchema,
  type LeadIntakeFormValues,
} from "./lead-intake-schema";

interface LeadIntakeFormProps {
  /**
   * The authenticated form asks for a lead source; the public one never does.
   * Lead source is internal vocabulary (Quotewizard, Soleo, Data Lot, JYA) and
   * is meaningless — sometimes revealing — to an outside submitter, so a
   * producer sets it after the fact.
   */
  showLeadSource: boolean;
  submitting: boolean;
  errorMessage: string | null;
  submitLabel?: string;
  onSubmit: (values: LeadIntakeFormValues) => void;
}

const leadSourceOptions = SELECTABLE_LEAD_SOURCE_OPTIONS.map((o) => ({
  value: o.code,
  label: o.label,
}));

const emptyPolicy = () => ({ policyType: "Auto" as const, itemCount: "1" });

/**
 * The New Lead form itself (PAC-37) — one component behind both entry points.
 *
 * It owns the form state and nothing else: the wrappers own the mutation, the
 * submission token, and what happens on success. That split is what lets the
 * authenticated page navigate to the created lead while the public page shows a
 * bare confirmation, without either duplicating the fields or the validation.
 */
export function LeadIntakeForm({
  showLeadSource,
  submitting,
  errorMessage,
  submitLabel = "Create lead",
  onSubmit,
}: LeadIntakeFormProps) {
  const form = useAppForm({
    defaultValues: EMPTY_LEAD_INTAKE,
    validators: { onBlur: makeLeadIntakeSchema(showLeadSource) },
    onSubmit: ({ value }) => onSubmit(value),
  });

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
          description="Where the household lives — not the insured property address, which is captured on the quote."
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

        {showLeadSource ? (
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
          * Last on the form, and the same rows the Quote Recap uses — minus
          * premium, which nobody can answer before a quote exists (PAC-56 #2).
          */}
        <FormSection
          title="Policies of interest"
          description="What would you like quoted? One row per policy."
        >
          <form.Field name="policies" mode="array">
            {(field) => (
              <PolicyRowsShell
                count={field.state.value.length}
                onAdd={() => field.pushValue(emptyPolicy())}
              >
                {field.state.value.map((_, i) => (
                  <PolicyRowGroup
                    key={i}
                    form={form}
                    fields={`policies[${i}]`}
                    index={i}
                    columns={2}
                    onRemove={
                      field.state.value.length > 1
                        ? () => field.removeValue(i)
                        : undefined
                    }
                  />
                ))}
              </PolicyRowsShell>
            )}
          </form.Field>
        </FormSection>

        {/* Same trigger as the Quote Recap: Home, Renters, Condominium or
            Landlord means there is a dwelling whose address we don't have. */}
        <form.Subscribe
          selector={(s) => ({
            policies: s.values.policies,
            address: s.values.address,
          })}
        >
          {({ policies, address }) => (
            <PropertyAddressGate policies={policies} address={address}>
              {(householdAddress) => (
                <PropertyAddressSection>
                  <PropertyAddressFields
                    form={form}
                    fields={{
                      sameAsHousehold: "sameAsHousehold",
                      propertyAddress: "propertyAddress",
                    }}
                    householdAddress={householdAddress}
                  />
                </PropertyAddressSection>
              )}
            </PropertyAddressGate>
          )}
        </form.Subscribe>

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
    </form.AppForm>
  );
}

interface PropertyAddressGateProps {
  policies: LeadIntakeFormValues["policies"];
  address: LeadIntakeFormValues["address"];
  children: (
    householdAddress: LeadIntakeFormValues["address"] | null,
  ) => React.ReactNode;
}

/**
 * Decides whether the property-address section is needed, and builds the
 * household address it copies from.
 *
 * Split out solely so the `useMemo` can exist: `PropertyAddressFields` copies
 * this object inside an effect keyed on its identity, so a fresh object every
 * render would re-run the copy on every keystroke. Memoizing on the four
 * strings — rather than passing `s.values.address` straight through — is what
 * keeps that stable.
 */
function PropertyAddressGate({
  policies,
  address,
  children,
}: PropertyAddressGateProps) {
  const { street, city, state, zip } = address;
  const householdAddress = useMemo(
    () =>
      // `null` disables the "same as household" toggle. The one thing worth
      // gating on is the street: copying a city with no street would produce a
      // property address nobody can find.
      street?.trim() ? { street, city, state, zip } : null,
    [street, city, state, zip],
  );

  const hasPropertyPolicy = (policies ?? []).some((p) =>
    isPropertyPolicyType(p?.policyType),
  );
  if (!hasPropertyPolicy) return null;
  return <>{children(householdAddress)}</>;
}
