import { POLICY_TYPE_OPTIONS } from "@sfa/shared";
import { useStore } from "@tanstack/react-form";
import { useEffect, useRef, useState } from "react";
import { FieldShell } from "@/components/form/fields";
import { Input } from "@/components/ui/input";
import { withForm } from "@/hooks/form";
import { checkPolicyNumber } from "@/lib/sold-deals-api";
import { DuplicatePolicyNotice } from "./DuplicatePolicyNotice";
import type { PolicyCheckMatch } from "@sfa/shared";
import { emptyPolicy } from "./sold-deal-schema";

/**
 * The wizard's individual cards.
 *
 * Each is a `withForm` component bound to the **draft** policy form and reached
 * as `<PolicyTypeCard form={draft} />`, except Card 1, which edits the
 * deal-level sold date and takes it as a prop — that is the one field outside
 * the per-policy loop.
 *
 * `defaultValues: emptyPolicy()` on each is type inference only; the values come
 * from whichever form is passed in. It is what checks every `name` below against
 * the real schema, so renaming a field breaks the build here rather than at
 * runtime.
 */

/**
 * Card 1 — one sold date for the whole deal.
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
  error,
  onChange,
}: {
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  return (
    <FieldShell
      label="Sold date"
      description="One date for the whole sale, however many policies it covers."
      error={error}
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

/** Card 2 — the loop's entry point. */
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
          />
        )}
      </form.AppField>
    );
  },
});

/** Card 3 — basic details, plus the duplicate check. */
export const PolicyDetailsCard = withForm({
  defaultValues: emptyPolicy(),
  render: function Render({ form }) {
    const [match, setMatch] = useState<PolicyCheckMatch | null>(null);
    const numberRef = useRef<HTMLInputElement | null>(null);

    const policyNumber = useStore(form.store, (s) => s.values.policyNumber);
    const policyType = useStore(form.store, (s) => s.values.policyType);
    const existingPolicyId = useStore(
      form.store,
      (s) => s.values.existingPolicyId,
    );

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
          {(f) => <f.TextField label="Carrier" placeholder="Allstate" />}
        </form.AppField>

        <form.AppField name="policyNumber">
          {(f) => (
            <f.TextField
              label="Policy number"
              placeholder="ABC-123-456"
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

/** Card 4 — premium and item count. */
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

/** Card 6 — prior insurance. Labels track the policy type. */
export const PriorInsuranceCard = withForm({
  defaultValues: emptyPolicy(),
  render: function Render({ form }) {
    const policyType = useStore(form.store, (s) => s.values.policyType);
    const none = useStore(form.store, (s) => s.values.priorInsurance.none);

    return (
      <div className="space-y-4">
        {/* The spec's "No prior [Type] insurance" toggle. */}
        <form.AppField name="priorInsurance.none">
          {(f) => <f.CheckboxField label={`No prior ${policyType} insurance`} />}
        </form.AppField>

        {/*
          * Hidden rather than disabled when the toggle is on: there is nothing to
          * read from a field that does not apply, and the values are dropped at
          * the submit boundary anyway.
          */}
        {!none && (
          <>
            <form.AppField name="priorInsurance.carrier">
              {(f) => (
                <f.TextField
                  label={`Prior ${policyType} carrier`}
                  placeholder="Geico"
                />
              )}
            </form.AppField>
            <form.AppField name="priorInsurance.agentName">
              {(f) => <f.TextField label="Prior agent" placeholder="Optional" />}
            </form.AppField>
          </>
        )}
      </div>
    );
  },
});

/** Card 7 — did the client cancel the prior policy? */
export const CancellationCard = withForm({
  defaultValues: emptyPolicy(),
  render: function Render({ form }) {
    const cancelled = useStore(
      form.store,
      (s) => s.values.cancellation.cancelled,
    );

    return (
      <div className="space-y-4">
        <form.AppField name="cancellation.cancelled">
          {(f) => (
            <f.CheckboxField label="The prior insurance has been cancelled" />
          )}
        </form.AppField>

        {cancelled && (
          <form.AppField name="cancellation.effectiveDate">
            {(f) => (
              <f.TextField label="Effective date of cancellation" type="date" />
            )}
          </form.AppField>
        )}

        {!cancelled && (
          <p className="text-xs text-muted-foreground">
            Left unticked, the service team is asked to cancel it during onboarding.
          </p>
        )}
      </div>
    );
  },
});
