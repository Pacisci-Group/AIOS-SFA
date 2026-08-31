import { useCallback } from "react";
import type { StructuredAddress } from "@sfa/shared";
import { FormGrid } from "@/components/form";
import { withFieldGroup } from "@/hooks/form";

/**
 * The four address inputs, with Google-backed autocomplete on the street line
 * (PAC-60).
 *
 * ## Why this is a field group and not a field component
 *
 * Selecting a suggestion has to write *four* fields. A field component cannot:
 * the whole point of that tier is that a component never names a path, and one
 * that filled in city/state/zip would have to name three. String-concatenating
 * a prefix (`` `${base}.city` ``) is worse still — it is untyped, so renaming
 * `escrow.address` would be a silent runtime break rather than a compile error,
 * which is the exact defect the rule exists to prevent.
 *
 * A `withFieldGroup` solves it properly. Paths inside are **relative**, so the
 * four names are written once, here, for the whole app; and the `fields` prop
 * at the call site is typed against the parent schema, so renaming the parent's
 * address object *is* a compile error. Same shape as `PolicyFields`.
 *
 * `AddressAutocompleteField` stays a real field component bound to the street
 * path alone, and hands the resolved address up through `onAddressSelected` —
 * so the field tier's rule is kept intact rather than bent.
 *
 * ## Where it does not live
 * Not in `components/form/`. That directory is deliberately the
 * library-agnostic layout tier — nothing in it imports a form library — and
 * `withFieldGroup` is TanStack Form. Beside `components/policies/PolicyFields.tsx`
 * instead, which is the precedent for an app composite that binds a group.
 */

const ADDRESS_LABELS: Record<keyof StructuredAddress, string> = {
  street: "Street",
  city: "City",
  state: "State",
  zip: "ZIP",
};

export const AddressFields = withFieldGroup({
  defaultValues: { street: "", city: "", state: "", zip: "" } as StructuredAddress,
  /*
   * Cast to a type with genuinely optional keys.
   *
   * `withFieldGroup` derives the call-site prop type straight from this object,
   * and TypeScript treats a property as *required* even when `undefined` is in
   * its union — so without the cast every call site would have to pass all four,
   * including the two that only ever want the defaults. The object literal still
   * supplies the runtime defaults; only the declared type changes.
   */
  props: {
    disabled: false,
    shareToken: undefined,
    inputClassName: undefined,
    gap: 4,
  } as {
    /**
     * DOM-disable all four and suppress lookup.
     *
     * `PolicyFields`' "same as household" toggle: the values stay in form state
     * because an effect there owns them, so this is presentation only — never
     * the library's own disable, which nulls the value.
     */
    disabled?: boolean;
    /**
     * Share-link token on the public intake form; omitted = authenticated.
     *
     * Routes lookups to `/public/address/:token/*`, which re-verifies the link
     * by hand (`@Public()` bypasses the guard chain) and draws on that link's
     * daily allowance.
     */
    shareToken?: string;
    /** On each `<input>`. The intake forms use `bg-card border-border`; the Sold wizard does not. */
    inputClassName?: string;
    /** Matches `FormGrid`'s own scale — 4 on an intake card, 3 inside a drawer. */
    gap?: 3 | 4;
  },
  render: function Render({ group, disabled, shareToken, inputClassName, gap }) {
    /*
     * `group` and `setFieldValue` are referentially stable (the group instance
     * outlives a render), so this callback is stable too — which matters
     * because it is a prop on the autocomplete field's effect path.
     */
    const applyAddress = useCallback(
      (address: StructuredAddress) => {
        // The one place in the app that names all four address paths. React 18
        // batches these into a single render.
        group.setFieldValue("street", address.street);
        group.setFieldValue("city", address.city);
        group.setFieldValue("state", address.state);
        group.setFieldValue("zip", address.zip);

        /*
         * Re-validate, because a programmatic write fires no blur.
         *
         * These forms validate with `validators: { onBlur: schema }` against
         * one form-level zod object, so by the time a suggestion is clicked the
         * empty City and ZIP are already carrying a "Required" error from the
         * whole-form run that Street's own blur triggered. `setFieldValue`
         * validates with cause `"change"`, which no validator here answers — so
         * without this the four fields fill in and two of them stay red,
         * showing a message about a value that is now present.
         *
         * Same fix, for the same reason, as the `validateField(...)` the New
         * Lead form runs after committing a policy from its drawer.
         */
        void group.validateField("street", "blur");
        void group.validateField("city", "blur");
        void group.validateField("state", "blur");
        void group.validateField("zip", "blur");
      },
      [group],
    );

    return (
      <FormGrid gap={gap ?? 4}>
        <group.AppField name="street">
          {(f) => (
            <f.AddressAutocompleteField
              label={ADDRESS_LABELS.street}
              autoComplete="address-line1"
              className="sm:col-span-2"
              inputClassName={inputClassName}
              disabled={disabled}
              shareToken={shareToken}
              onAddressSelected={applyAddress}
            />
          )}
        </group.AppField>
        <group.AppField name="city">
          {(f) => (
            <f.TextField
              label={ADDRESS_LABELS.city}
              autoComplete="address-level2"
              inputClassName={inputClassName}
              disabled={disabled}
            />
          )}
        </group.AppField>
        <group.AppField name="state">
          {(f) => (
            <f.TextField
              label={ADDRESS_LABELS.state}
              autoComplete="address-level1"
              inputClassName={inputClassName}
              disabled={disabled}
            />
          )}
        </group.AppField>
        <group.AppField name="zip">
          {(f) => (
            <f.TextField
              label={ADDRESS_LABELS.zip}
              inputMode="numeric"
              autoComplete="postal-code"
              inputClassName={inputClassName}
              disabled={disabled}
            />
          )}
        </group.AppField>
      </FormGrid>
    );
  },
});
