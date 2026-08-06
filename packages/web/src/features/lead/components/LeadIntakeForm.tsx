import { zodResolver } from "@hookform/resolvers/zod";
import {
  SELECTABLE_LEAD_SOURCE_OPTIONS,
  isPropertyPolicyType,
} from "@sfa/shared";
import { useMemo } from "react";
import { useForm, useWatch, FormProvider } from "react-hook-form";
import { FormError, FormGrid, FormSection } from "@/components/form";
import { PolicyRowsField } from "@/components/policies/PolicyRowsField";
import { PropertyAddressSection } from "@/components/policies/PropertyAddressSection";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { HouseholdMembersField } from "./HouseholdMembersField";
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
  const form = useForm<LeadIntakeFormValues>({
    resolver: zodResolver(makeLeadIntakeSchema(showLeadSource)),
    defaultValues: EMPTY_LEAD_INTAKE,
    mode: "onBlur",
  });

  const policies = useWatch({ control: form.control, name: "policies" });
  const hasPropertyPolicy = (policies ?? []).some((p) =>
    isPropertyPolicyType(p?.policyType),
  );

  // Watched field-by-field and rebuilt only when a part actually changes.
  // `PropertyAddressSection` copies this into the property fields inside an
  // effect keyed on its identity, so watching the `address` object wholesale —
  // a fresh reference on every render — would loop.
  const street = useWatch({ control: form.control, name: "address.street" });
  const city = useWatch({ control: form.control, name: "address.city" });
  const state = useWatch({ control: form.control, name: "address.state" });
  const zip = useWatch({ control: form.control, name: "address.zip" });
  const householdAddress = useMemo(
    () =>
      // `null` disables the "same as household" toggle. The one thing worth
      // gating on is the street: copying a city with no street would produce a
      // property address nobody can find.
      street?.trim()
        ? { street, city: city ?? "", state: state ?? "", zip: zip ?? "" }
        : null,
    [street, city, state, zip],
  );

  return (
    <FormProvider {...form}>
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="space-y-6"
          noValidate
        >
          <FormSection title="Primary contact">
            <FormGrid>
              <FormField
                control={form.control}
                name="primaryContact.firstName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>First name</FormLabel>
                    <FormControl>
                      <Input
                        autoComplete="given-name"
                        className="bg-card border-border"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="primaryContact.lastName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Last name</FormLabel>
                    <FormControl>
                      <Input
                        autoComplete="family-name"
                        className="bg-card border-border"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="primaryContact.dateOfBirth"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date of birth</FormLabel>
                    <FormControl>
                      <Input
                        type="date"
                        className="bg-card border-border"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="primaryContact.phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone</FormLabel>
                    <FormControl>
                      <Input
                        type="tel"
                        inputMode="tel"
                        autoComplete="tel"
                        placeholder="(555) 123-4567"
                        className="bg-card border-border"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="primaryContact.email"
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        inputMode="email"
                        autoComplete="email"
                        className="bg-card border-border"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </FormGrid>
          </FormSection>

          <FormSection
            title="Household address"
            description="Where the household lives — not the insured property address, which is captured on the quote."
          >
            <FormGrid>
              <FormField
                control={form.control}
                name="address.street"
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>Street</FormLabel>
                    <FormControl>
                      <Input
                        autoComplete="address-line1"
                        className="bg-card border-border"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="address.city"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>City</FormLabel>
                    <FormControl>
                      <Input
                        autoComplete="address-level2"
                        className="bg-card border-border"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="address.state"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>State</FormLabel>
                    <FormControl>
                      <Input
                        autoComplete="address-level1"
                        className="bg-card border-border"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="address.zip"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>ZIP</FormLabel>
                    <FormControl>
                      <Input
                        inputMode="numeric"
                        autoComplete="postal-code"
                        className="bg-card border-border"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </FormGrid>
          </FormSection>

          {showLeadSource ? (
            <FormSection title="Lead source">
              <FormField
                control={form.control}
                name="leadSourceCode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Where did this lead come from?</FormLabel>
                    <Select
                      value={field.value ?? ""}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full bg-card border-border">
                          <SelectValue placeholder="Select a source" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {/* `Test` is excluded at the source — a lead created
                            with it would be silently hidden from every list. */}
                        {SELECTABLE_LEAD_SOURCE_OPTIONS.map((option) => (
                          <SelectItem key={option.code} value={option.code}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </FormSection>
          ) : null}

          <FormSection
            title="Additional household members"
            description="Spouse, children, and any other drivers on the policy."
          >
            <HouseholdMembersField />
          </FormSection>

          {/*
            * Last on the form, and the same rows the Quote Recap uses — minus
            * premium, which nobody can answer before a quote exists (PAC-56 #2).
            */}
          <FormSection
            title="Policies of interest"
            description="What would you like quoted? One row per policy."
          >
            <PolicyRowsField showPremium={false} />
            {form.formState.errors.policies?.root && (
              <p className="text-sm text-destructive">
                {form.formState.errors.policies.root.message}
              </p>
            )}
          </FormSection>

          {/* Same trigger as the Quote Recap: Home, Renters, Condominium or
              Landlord means there is a dwelling whose address we don't have. */}
          {hasPropertyPolicy && (
            <PropertyAddressSection householdAddress={householdAddress} />
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
      </Form>
    </FormProvider>
  );
}
