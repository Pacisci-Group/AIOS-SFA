import type { QuoteRecapPropertyAddress } from "@sfa/shared";
import { useEffect } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { FormGrid, FormSection } from "@/components/form";
import { Checkbox } from "@/components/ui/checkbox";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";

/**
 * The slice of form state this section owns. Declared locally for the same
 * reason as {@link PolicyRowsFormValues} — both the Quote Recap form and the
 * New Lead form register exactly these paths.
 */
export interface PropertyAddressFormValues {
  sameAsHousehold: boolean;
  propertyAddress: {
    street: string;
    city: string;
    state: string;
    zip: string;
  };
}

interface PropertyAddressSectionProps {
  /**
   * `null` when there is nothing usable to copy — which disables the toggle.
   *
   * The Quote Recap passes the household's stored address; the New Lead form
   * passes what the submitter is typing into the household-address section of
   * the same form, so the copy tracks their edits live.
   */
  householdAddress: QuoteRecapPropertyAddress | null;
}

const FIELDS = [
  { name: "street", label: "Street" },
  { name: "city", label: "City" },
  { name: "state", label: "State" },
  { name: "zip", label: "ZIP" },
] as const;

/**
 * The insured-property address, shown only when a property-type policy is
 * selected (Home, Renters, Condominium, Landlord). Shared by the Quote Recap
 * form (PAC-39) and the New Lead form (PAC-56 #2/#6).
 *
 * The "Same as Household Address" interaction is ported from the `sfaforms`
 * prototype, deliberately including its **one-way copy** semantics: checking
 * the box fills the fields, unchecking leaves them as an editable starting
 * point rather than clearing them.
 */
export function PropertyAddressSection({
  householdAddress,
}: PropertyAddressSectionProps) {
  const form = useFormContext<PropertyAddressFormValues>();
  const { setValue } = form;
  const sameAsHousehold = useWatch({
    control: form.control,
    name: "sameAsHousehold",
  });

  useEffect(() => {
    if (!sameAsHousehold || !householdAddress) return;
    for (const { name } of FIELDS) {
      setValue(`propertyAddress.${name}`, householdAddress[name] ?? "", {
        shouldValidate: true,
      });
    }
    // Depends on `setValue` (a stable method off the form control), NEVER on the
    // whole `form` object: `useFormContext()` hands back a new identity on every
    // render of the provider, so `form` in these deps + `shouldValidate` is an
    // infinite render loop (validate -> re-render -> new `form` -> validate).
    //
    // Also re-runs when `householdAddress` resolves, so an async fetch backfills
    // the address even though the toggle itself never changed. The same applies
    // to the New Lead form, where the source address is being typed live — so
    // callers watching their own form MUST pass a referentially stable object
    // (memoized on the four strings), or this loops for the same reason.
  }, [sameAsHousehold, householdAddress, setValue]);

  return (
    // TODO(Phase 3): this component owns its own `<section>`, which makes it a
    // page section rather than a field group and is why it can't be embedded in
    // another layout. Splitting the fields out from the wrapper is part of the
    // field-binding tier work.
    <FormSection
      title="Property address"
      description="The address being insured — not necessarily where the client lives."
    >
      <FormField
        control={form.control}
        name="sameAsHousehold"
        render={({ field }) => (
          <FormItem className="flex flex-row items-center gap-2 space-y-0">
            <FormControl>
              <Checkbox
                checked={field.value}
                onCheckedChange={field.onChange}
                disabled={!householdAddress}
              />
            </FormControl>
            <FormLabel className="font-normal">
              Same as household address
            </FormLabel>
          </FormItem>
        )}
      />

      {!householdAddress && (
        <p className="text-xs text-muted-foreground">
          No household address on file — enter the property address below.
        </p>
      )}

      <FormGrid>
        {FIELDS.map(({ name, label }) => (
          <FormField
            key={name}
            control={form.control}
            name={`propertyAddress.${name}`}
            render={({ field }) => (
              <FormItem className={name === "street" ? "sm:col-span-2" : ""}>
                <FormLabel>{label}</FormLabel>
                <FormControl>
                  {/*
                   * `disabled` on the DOM input, never RHF's `disabled` option
                   * — the latter nulls the value. These fields were written by
                   * `setValue`, so they stay in form state and are submitted;
                   * that is fine, because the server discards them whenever
                   * `sameAsHousehold` is true and copies the household's own.
                   */}
                  <Input
                    className="bg-card border-border"
                    disabled={sameAsHousehold}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        ))}
      </FormGrid>
    </FormSection>
  );
}
