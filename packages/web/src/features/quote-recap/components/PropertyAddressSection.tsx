import type { QuoteRecapPropertyAddress } from "@sfa/shared";
import { useEffect } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { Checkbox } from "@/components/ui/checkbox";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import type { QuoteRecapFormValues } from "./quote-recap-schema";

interface PropertyAddressSectionProps {
  /** `null` when the household has nothing usable on file. */
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
 * quoted (Home, Renters, Condominium, Landlord).
 *
 * The "Same as Household Address" interaction is ported from the `sfaforms`
 * prototype, deliberately including its **one-way copy** semantics: checking
 * the box fills the fields, unchecking leaves them as an editable starting
 * point rather than clearing them.
 */
export function PropertyAddressSection({
  householdAddress,
}: PropertyAddressSectionProps) {
  const form = useFormContext<QuoteRecapFormValues>();
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
    // the address even though the toggle itself never changed.
  }, [sameAsHousehold, householdAddress, setValue]);

  return (
    <section className="rounded-xl bg-card border border-border p-4 md:p-5 space-y-4">
      <div>
        <h2 className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Property address
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          The address being insured — not necessarily where the client lives.
        </p>
      </div>

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

      <div className="grid gap-4 sm:grid-cols-2">
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
      </div>
    </section>
  );
}
