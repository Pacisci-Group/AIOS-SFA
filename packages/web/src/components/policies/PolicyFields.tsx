import type { QuoteRecapPropertyAddress } from "@sfa/shared";
import { POLICY_TYPE_OPTIONS, isPropertyPolicyType, type PolicyType } from "@sfa/shared";
import { useStore } from "@tanstack/react-form";
import { useEffect } from "react";
import { FormGrid, FormSubPanel } from "@/components/form";
import { withFieldGroup } from "@/hooks/form";
import { ADDRESS_FIELDS } from "@/lib/format-address";

/**
 * The fields **one policy** owns — and only the ones both forms share.
 *
 * Premium is deliberately absent. The Quote Recap records what a policy costs;
 * the New Lead form asks the same question *before* a quote exists, where nobody
 * — least of all a prospect — can answer it. Modelling that with an optional
 * `premium` plus a `showPremium` boolean does not typecheck here: a field group
 * requires every key it declares to exist on the parent, and the New Lead schema
 * has no premium at all. The Quote Recap composes its premium field in through
 * `children` instead.
 *
 * `policyType` is annotated rather than left to inference: a bare `"Auto"`
 * widens to `string`, which then fails to line up with either parent's
 * `z.enum(POLICY_TYPES)` and makes the `fields` path unresolvable.
 */
const policyDefaults = {
  policyType: "Auto" as PolicyType,
  itemCount: "1",
  sameAsHousehold: true,
  propertyAddress: { street: "", city: "", state: "", zip: "" },
};

const ADDRESS_LABELS: Record<(typeof ADDRESS_FIELDS)[number], string> = {
  street: "Street",
  city: "City",
  state: "State",
  zip: "ZIP",
};

/**
 * Everything about one policy, address included (PAC-56 #14/#15).
 *
 * Paths are relative to the group, so nothing here names the parent's array —
 * that lives entirely at the call site, which is what makes renaming it a
 * compile error instead of a silent runtime break.
 *
 * The dwelling used to be a separate section further down the form, filled in
 * once for the whole submission. Capturing it here, beside the policy it
 * belongs to, is the point of the drawer: a producer adding a landlord policy
 * is asked which building, at the moment they are thinking about that building.
 */
export const PolicyFields = withFieldGroup({
  defaultValues: policyDefaults,
  props: {
    /**
     * The address the "same as household" toggle copies from, or `null` when
     * there is nothing usable to copy — which disables the toggle.
     *
     * MUST be referentially stable: it is an effect dependency below. The Quote
     * Recap passes the household's stored address; the New Lead form passes what
     * the submitter is typing into its own household section, memoized on the
     * four strings so the copy tracks their edits live without the object
     * identity changing every render.
     */
    householdAddress: null as QuoteRecapPropertyAddress | null,
  },
  render: function Render({ group, householdAddress, children }) {
    /*
     * Subscribed, not read off `group.state`. `useFieldGroup` never subscribes
     * its host component to the store — `state` is a live getter, so a plain
     * read returns the right value but never re-renders. Reading it directly
     * left the toggle unable to re-enable the fields, and stopped the effect
     * below from ever re-running.
     */
    const policyType = useStore(group.store, (state) => state.values.policyType);
    const sameAsHousehold = useStore(
      group.store,
      (state) => state.values.sameAsHousehold,
    );
    const needsAddress = isPropertyPolicyType(policyType);

    useEffect(() => {
      if (!needsAddress || !sameAsHousehold || !householdAddress) return;
      for (const name of ADDRESS_FIELDS) {
        group.setFieldValue(`propertyAddress.${name}`, householdAddress[name] ?? "");
      }
      // Re-runs when `householdAddress` resolves, so an async fetch backfills
      // the address even though the toggle never changed, and when the type
      // switches to a property one after the drawer was opened.
      //
      // `group`/`setFieldValue` are referentially stable (the form instance is
      // held in `useState`), so the infinite-loop hazard the react-hook-form
      // version carried — a new context identity each render feeding a
      // validating `setValue` — does not exist. The stability requirement on
      // `householdAddress` still stands, because that object is the caller's.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [needsAddress, sameAsHousehold, householdAddress]);

    return (
      <div className="space-y-4">
        <FormGrid gap={3} columns={2}>
          <group.AppField name="policyType">
            {(f) => (
              <f.SelectField
                label="Policy type"
                options={POLICY_TYPE_OPTIONS}
                triggerClassName="w-full bg-card border-border"
              />
            )}
          </group.AppField>
          <group.AppField name="itemCount">
            {(f) => (
              <f.NumberField
                label="Item count"
                inputMode="numeric"
                min="1"
                inputClassName="bg-card border-border"
              />
            )}
          </group.AppField>
          {/* Slot under type and count — where Quote Recap puts premium. */}
          {children}
        </FormGrid>

        {/*
          Home, Renters, Condominium or Landlord means there is a dwelling whose
          address we don't have. An Auto or Umbrella policy insures no building,
          so asking would be a question with no answer.
        */}
        {needsAddress && (
          <FormSubPanel title="Property address">
            <p className="text-xs text-muted-foreground">
              The address being insured — not necessarily where the client lives.
            </p>

            <group.AppField name="sameAsHousehold">
              {(f) => (
                <f.CheckboxField
                  label="Same as household address"
                  // Nothing to copy, so the toggle would strand the fields blank
                  // *and* disabled.
                  disabled={!householdAddress}
                />
              )}
            </group.AppField>

            {!householdAddress && (
              <p className="text-xs text-muted-foreground">
                No household address on file — enter the property address below.
              </p>
            )}

            <FormGrid gap={3}>
              {ADDRESS_FIELDS.map((name) => (
                <group.AppField key={name} name={`propertyAddress.${name}`}>
                  {(f) => (
                    <f.TextField
                      label={ADDRESS_LABELS[name]}
                      className={name === "street" ? "sm:col-span-2" : undefined}
                      inputClassName="bg-card border-border"
                      /*
                       * `disabled` on the DOM input only. These fields were
                       * written by the effect above, so they stay in form state
                       * — which is fine, because the client drops them from the
                       * payload for a "same as" row and the server would
                       * discard them anyway.
                       */
                      disabled={sameAsHousehold}
                    />
                  )}
                </group.AppField>
              ))}
            </FormGrid>
          </FormSubPanel>
        )}
      </div>
    );
  },
});
