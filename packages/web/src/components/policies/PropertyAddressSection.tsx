import type { QuoteRecapPropertyAddress } from "@sfa/shared";
import { useEffect } from "react";
import { FormGrid, FormSection } from "@/components/form";
import { withFieldGroup } from "@/hooks/form";

/** The slice of form state this group owns. */
const propertyAddressDefaults = {
  sameAsHousehold: true,
  propertyAddress: { street: "", city: "", state: "", zip: "" },
};

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
 *
 * The caller owns the surrounding `FormSection` — this is a field group, not a
 * page section, which is what lets it sit anywhere in either form's layout.
 */
export const PropertyAddressFields = withFieldGroup({
  defaultValues: propertyAddressDefaults,
  props: {
    /**
     * `null` when there is nothing usable to copy, which disables the toggle.
     *
     * MUST be referentially stable — it is an effect dependency below. The Quote
     * Recap passes the household's stored address; the New Lead form passes what
     * the submitter is typing into the household-address section of the same
     * form, memoized on the four strings so the copy tracks their edits live
     * without the object identity changing every render.
     */
    householdAddress: null as QuoteRecapPropertyAddress | null,
  },
  render: function Render({ group, householdAddress }) {
    const sameAsHousehold = group.state.values.sameAsHousehold;

    useEffect(() => {
      if (!sameAsHousehold || !householdAddress) return;
      for (const { name } of FIELDS) {
        group.setFieldValue(`propertyAddress.${name}`, householdAddress[name] ?? "");
      }
      // Re-runs when `householdAddress` resolves, so an async fetch backfills the
      // address even though the toggle itself never changed.
      //
      // Unlike the react-hook-form version this replaced, `group`/`setFieldValue`
      // are referentially stable (the form instance is held in `useState`), so
      // the infinite-loop hazard that version carried — new context identity each
      // render feeding a validating `setValue` — does not exist here. The
      // stability requirement on `householdAddress` still stands, because that
      // object is the caller's.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sameAsHousehold, householdAddress]);

    return (
      <FormGrid>
        {FIELDS.map(({ name, label }) => (
          <group.AppField key={name} name={`propertyAddress.${name}`}>
            {(f) => (
              <f.TextField
                label={label}
                className={name === "street" ? "sm:col-span-2" : undefined}
                inputClassName="bg-card border-border"
                /*
                 * `disabled` on the DOM input only. These fields were written by
                 * the effect above, so they stay in form state and are
                 * submitted; that is fine, because the server discards them
                 * whenever `sameAsHousehold` is true and copies the household's
                 * own.
                 */
                disabled={sameAsHousehold}
              />
            )}
          </group.AppField>
        ))}
      </FormGrid>
    );
  },
});

interface PropertyAddressSectionProps {
  children: React.ReactNode;
  householdAddress: QuoteRecapPropertyAddress | null;
}

/** The panel wrapper both forms put around {@link PropertyAddressFields}. */
export function PropertyAddressSection({
  children,
  householdAddress,
}: PropertyAddressSectionProps) {
  return (
    <FormSection
      title="Property address"
      description="The address being insured — not necessarily where the client lives."
    >
      {children}
      {!householdAddress && (
        <p className="text-xs text-muted-foreground">
          No household address on file — enter the property address below.
        </p>
      )}
    </FormSection>
  );
}
