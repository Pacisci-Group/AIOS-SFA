import { CARRIER_OTHER, POLICY_TYPE_OPTIONS } from "@sfa/shared";
import { useStore } from "@tanstack/react-form";
import { useEffect, useMemo, useRef, useState } from "react";
import { FormSubPanel } from "@/components/form";
import { FieldShell, useFieldError } from "@/components/form/fields";
import type { SelectOption } from "@/components/form/fields";
import { Input } from "@/components/ui/input";
import { withForm } from "@/hooks/form";
import {
  ALLOWED_NBA_UPLOAD_TYPES,
  checkPolicyNumber,
  type UploadScope,
} from "@/lib/sold-deals-api";
import { DuplicatePolicyNotice } from "./DuplicatePolicyNotice";
import { SoldDocumentUpload } from "./SoldDocumentUpload";
import type { CarrierOption, PolicyCheckMatch } from "@sfa/shared";
import { clearInapplicableDiscounts, emptyPolicy } from "./sold-deal-schema";

/**
 * The wizard's individual cards.
 *
 * Each is a `withForm` component bound to the **draft** policy form and reached
 * as `<PolicyTypeCard form={draft} />`, except the sold-date card, which edits the
 * deal-level sold date and takes it as a prop — that is the one field outside
 * the per-policy loop.
 *
 * `defaultValues: emptyPolicy()` on each is type inference only; the values come
 * from whichever form is passed in. It is what checks every `name` below against
 * the real schema, so renaming a field breaks the build here rather than at
 * runtime.
 */

/**
 * The sold date — one for the whole deal.
 *
 * Deliberately **outside** the form library: it is deal-level, not policy-level,
 * so it cannot live in the draft form (which is reset per policy), and a second
 * form instance for one date buys nothing. It borrows {@link FieldShell} — the
 * library-agnostic half of the field tier — so the markup stays identical to
 * every other field without binding to anything.
 *
 * The previous version rendered `FormItem`/`FormLabel`/`FormControl` with no
 * enclosing `FormField`, which only worked because react-hook-form's `get()`
 * returns a default on a falsy path.
 */
export function SoldDateCard({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <FieldShell
      label="Sold date"
      description="One date for the whole sale, however many policies it covers."
    >
      {({ id, describedBy, invalid }) => (
        <Input
          id={id}
          type="date"
          aria-describedby={describedBy}
          aria-invalid={invalid}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </FieldShell>
  );
}

/**
 * The loop's entry point.
 *
 * Changing the type **clears the discounts that no longer apply**. The
 * Discounts card renders one branch or the other, but `discountsSchema`
 * validates every key regardless, so a discount ticked as Auto and then
 * switched to Home used to keep failing from behind a control that was no
 * longer on screen — Continue silently refused to advance with no message
 * anywhere. Clearing here is also what keeps the sale submittable: the API
 * rejects a cross-branch selection rather than stripping it.
 */
export const PolicyTypeCard = withForm({
  defaultValues: emptyPolicy(),
  render: function Render({ form }) {
    return (
      <form.AppField name="policyType">
        {(f) => (
          <f.SelectField
            label="Policy type"
            options={POLICY_TYPE_OPTIONS}
            placeholder="Select a policy type"
            onChanged={(policyType) => {
              const { discounts, escrow } = clearInapplicableDiscounts(
                policyType,
                form.state.values,
              );
              form.setFieldValue("discounts", discounts);
              form.setFieldValue("escrow", escrow);
            }}
          />
        )}
      </form.AppField>
    );
  },
});

/**
 * Catalog carriers plus the "Other" escape (PAC-56 #18).
 *
 * "Other" is always last and always present: the seeded list covers the common
 * cases well enough that it is rare, not exhaustively enough that it is never
 * needed, and a carrier we forgot must not be able to block a sale.
 */
function useCarrierOptions(
  carriers: readonly CarrierOption[],
): SelectOption<string>[] {
  return useMemo(
    () => [
      ...carriers.map((c) => c.name),
      { value: CARRIER_OTHER, label: "Other…" },
    ],
    [carriers],
  );
}

/**
 * The selected carrier's format rule, stated up front.
 *
 * Shown as the field's description rather than waiting for the error: a
 * producer who knows the number must be digits typically has the right one to
 * hand, and telling them after they have typed the wrong one is worse.
 */
function policyNumberHint(
  carriers: readonly CarrierOption[],
  carrier: string,
): string | undefined {
  return carriers.find((c) => c.name === carrier)?.policyNumberHint ?? undefined;
}

/** Basic details, plus the duplicate check. */
export const PolicyDetailsCard = withForm({
  defaultValues: emptyPolicy(),
  props: { carriers: [] as CarrierOption[] },
  render: function Render({ form, carriers }) {
    const [match, setMatch] = useState<PolicyCheckMatch | null>(null);
    const numberRef = useRef<HTMLInputElement | null>(null);
    const carrierOptions = useCarrierOptions(carriers);

    const policyNumber = useStore(form.store, (s) => s.values.policyNumber);
    const policyType = useStore(form.store, (s) => s.values.policyType);
    const carrier = useStore(form.store, (s) => s.values.carrier);
    const numberTouched = useStore(
      form.store,
      (s) => s.fieldMeta.policyNumber?.isTouched ?? false,
    );
    const existingPolicyId = useStore(
      form.store,
      (s) => s.values.existingPolicyId,
    );

    /*
     * Re-validate the number when the carrier changes.
     *
     * Without this the sequence "pick Allstate → type a number → blur → Back →
     * switch to State Farm" leaves the error from Allstate's rule sitting under
     * a field the rule no longer applies to. `validateCard` re-runs on Continue
     * so the submit is safe either way, but the live feedback would be wrong
     * until then — which reads as the app accepting an invalid number.
     *
     * Gated on `isTouched` so switching carrier on a blank form does not light
     * it up. Same shape as the stale-match effect above.
     */
    useEffect(() => {
      if (!numberTouched) return;
      void form.validateField("policyNumber", "change");
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [carrier]);

    // Clear a stale warning as soon as the number changes — the old match is
    // about a number the producer is no longer entering.
    useEffect(() => {
      setMatch(null);
      if (existingPolicyId) form.setFieldValue("existingPolicyId", undefined);
      // Keyed on the number alone: re-running on the link itself would clear it
      // the instant it is set.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [policyNumber]);

    /**
     * Fired on blur rather than per keystroke: the API's short-window throttle is
     * 60/min, and a request per character would trip it on a single policy number.
     */
    const runCheck = async () => {
      const number = policyNumber?.trim();
      if (!number) return;
      try {
        const result = await checkPolicyNumber(number, policyType);
        setMatch(result.matches[0] ?? null);
      } catch {
        // A failed check must never block the sale. The server re-checks on
        // submit; this is an assist, not a gate.
        setMatch(null);
      }
    };

    return (
      <div className="space-y-4">
        <form.AppField name="effectiveDate">
          {(f) => <f.TextField label="Start date" type="date" />}
        </form.AppField>

        <form.AppField name="carrier">
          {(f) => (
            <f.SelectField
              label="Carrier"
              options={carrierOptions}
              placeholder="Select a carrier"
            />
          )}
        </form.AppField>

        {carrier === CARRIER_OTHER && (
          <form.AppField name="carrierOther">
            {(f) => (
              <f.TextField
                label="Carrier name"
                placeholder="Name the carrier"
                description="Not in the list — we'll record what you type."
              />
            )}
          </form.AppField>
        )}

        <form.AppField name="policyNumber">
          {(f) => (
            <f.TextField
              label="Policy number"
              placeholder="ABC-123-456"
              description={policyNumberHint(carriers, carrier)}
              inputRef={numberRef}
              onBlur={() => void runCheck()}
            />
          )}
        </form.AppField>

        {match && (
          <DuplicatePolicyNotice
            match={match}
            linked={Boolean(existingPolicyId)}
            onCorrect={() => {
              setMatch(null);
              numberRef.current?.focus();
            }}
            onLink={() => form.setFieldValue("existingPolicyId", match.id)}
          />
        )}
      </div>
    );
  },
});

/** Premium and item count. */
export const PolicyFinancialsCard = withForm({
  defaultValues: emptyPolicy(),
  render: function Render({ form }) {
    return (
      <div className="space-y-4">
        <form.AppField name="premium">
          {(f) => (
            <f.NumberField
              label="Premium"
              inputMode="decimal"
              step="0.01"
              min="0"
              placeholder="0.00"
              description="The deal total is summed from every policy — no need to add them up."
            />
          )}
        </form.AppField>

        <form.AppField name="itemCount">
          {(f) => (
            <f.NumberField
              label="Number of items"
              inputMode="numeric"
              min="1"
              step="1"
            />
          )}
        </form.AppField>
      </div>
    );
  },
});

/**
 * The signed new business application, per policy (PAC-56 #23).
 *
 * **Required and PDF-only** — the deliberate exception to the sold form's
 * PDF-or-image rule, because this is a signed application rather than a
 * photographed receipt, and David asked for it specifically for data accuracy.
 *
 * Per policy rather than legacy's five type-keyed columns on the Deal
 * (`Auto_`/`Home_`/`Landlord_`/`Renters_`/`Other_`): the wizard already loops
 * per policy, legacy's own Policies table carried the same field, and two
 * Landlord policies on one deal each need their own application.
 */
export const NewBusinessApplicationCard = withForm({
  defaultValues: emptyPolicy(),
  props: { uploadScope: { kind: "lead", leadId: "" } as UploadScope },
  render: function Render({ form, uploadScope }) {
    const policyType = useStore(form.store, (s) => s.values.policyType);

    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          The signed {policyType.toLowerCase()} application. Required, and a PDF
          — it is the record the audit checks the rest of this sale against.
        </p>
        <form.Field name="newBusinessApplication">
          {(field) => (
            <SoldDocumentUpload
              uploadScope={uploadScope}
              kind="new_business_application"
              accept={ALLOWED_NBA_UPLOAD_TYPES}
              hint="PDF up to 10MB"
              value={field.state.value}
              onChange={(meta) => {
                field.handleChange(meta);
                field.handleBlur();
              }}
              ariaLabel="Upload the new business application"
              error={useFieldError(field.state.meta)}
            />
          )}
        </form.Field>
      </div>
    );
  },
});

/**
 * Prior insurance — and, since PAC-56 #24, the cancellation question with it.
 *
 * They were two cards. Merging them is the honest shape: cancellation is a
 * follow-up about the *prior* policy, so asking it of someone who has just said
 * "no prior insurance" was a step with nothing on it. Everything below the
 * toggle is hidden in that branch, and `toPolicyInput` collapses the pair so a
 * stale value cannot survive a change of mind.
 *
 * Labels track the policy type.
 */
export const PriorInsuranceCard = withForm({
  defaultValues: emptyPolicy(),
  props: {
    carriers: [] as CarrierOption[],
    uploadScope: { kind: "lead", leadId: "" } as UploadScope,
  },
  render: function Render({ form, carriers, uploadScope }) {
    const policyType = useStore(form.store, (s) => s.values.policyType);
    const none = useStore(form.store, (s) => s.values.priorInsurance.none);
    const claimed = useStore(
      form.store,
      (s) => s.values.discounts.priorInsuranceDiscount,
    );
    const priorCarrier = useStore(
      form.store,
      (s) => s.values.priorInsurance.carrier,
    );
    const cancelled = useStore(
      form.store,
      (s) => s.values.cancellation.cancelled,
    );
    const carrierOptions = useCarrierOptions(carriers);

    return (
      <div className="space-y-4">
        {/*
          * The spec's "No prior [Type] insurance" toggle.
          *
          * ⚠ **Disabled, not hidden**, once prior insurance was claimed on the
          * discounts card (PAC-65 #18) — David: *"if they select prior
          * insurance, that top button should not be a selection."* Disabled
          * because the control still applies and is being *prevented*; hiding
          * it would leave the producer unable to see why the card they expected
          * to skip is now mandatory. The hint names the remedy and where it is.
          */}
        <form.AppField name="priorInsurance.none">
          {(f) => (
            <f.CheckboxField
              label={`No prior ${policyType} insurance`}
              disabled={claimed}
              hint={
                claimed
                  ? "Unavailable — prior insurance was ticked on the discounts card. Untick it there to enable this."
                  : undefined
              }
            />
          )}
        </form.AppField>

        {/*
          * Hidden rather than disabled when the toggle is on: there is nothing to
          * read from a field that does not apply, and the values are dropped at
          * the submit boundary anyway.
          */}
        {!none && (
          <>
            {/*
              * The same catalog as the sold policy's carrier (PAC-56 #18) —
              * and the place the multi-carrier list actually earns its keep,
              * since this agency writes Allstate and the prior carrier is
              * whoever the client is leaving.
              */}
            <form.AppField name="priorInsurance.carrier">
              {(f) => (
                <f.SelectField
                  label={`Prior ${policyType} carrier`}
                  options={carrierOptions}
                  placeholder="Select a carrier"
                />
              )}
            </form.AppField>
            {priorCarrier === CARRIER_OTHER && (
              <form.AppField name="priorInsurance.carrierOther">
                {(f) => (
                  <f.TextField
                    label="Prior carrier name"
                    placeholder="Name the carrier"
                  />
                )}
              </form.AppField>
            )}
            <form.AppField name="priorInsurance.agentName">
              {(f) => <f.TextField label="Prior agent" placeholder="Optional" />}
            </form.AppField>

            {/*
              * "Proof of Insurance" — David's wording, meaning the declarations
              * page showing the coverage period (PAC-65 #18).
              *
              * ⚠ The **only required upload on this form**. Every Card 5 proof
              * became optional in this same ticket; this one did not, because
              * failing to supply it in time gets the policy cancelled or
              * repriced. Shown only when the discount was claimed — otherwise
              * there is no coverage period to evidence.
              */}
            {claimed && (
              <FormSubPanel title="Proof of insurance">
                <form.Field name="priorInsurance.attachment">
                  {(field) => (
                    <SoldDocumentUpload
                      uploadScope={uploadScope}
                      value={field.state.value}
                      onChange={(meta) => {
                        field.handleChange(meta);
                        field.handleBlur();
                      }}
                      ariaLabel="Upload the proof of insurance"
                      hint="The declarations page showing the coverage period. PDF, JPEG or PNG."
                      error={useFieldError(field.state.meta)}
                    />
                  )}
                </form.Field>
              </FormSubPanel>
            )}

            {/*
              * Was its own card until PAC-56 #24. Inside the `!none` branch so
              * it disappears entirely when there is no prior policy to cancel —
              * which is the whole of the change David asked for.
              */}
            <FormSubPanel title="Cancellation">
              <form.AppField name="cancellation.cancelled">
                {(f) => (
                  <f.CheckboxField
                    label="The prior insurance has been cancelled"
                    hint="Left unticked, the service team is asked to cancel it during onboarding."
                  />
                )}
              </form.AppField>

              {cancelled && (
                <form.AppField name="cancellation.effectiveDate">
                  {(f) => (
                    <f.TextField
                      label="Effective date of cancellation"
                      type="date"
                    />
                  )}
                </form.AppField>
              )}
            </FormSubPanel>
          </>
        )}
      </div>
    );
  },
});
