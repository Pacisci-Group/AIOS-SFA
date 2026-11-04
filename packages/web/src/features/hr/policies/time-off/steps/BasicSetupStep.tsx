import { useState } from "react";
import { useStore } from "@tanstack/react-form";
import {
  ACCRUAL_TYPE_LABELS,
  COMPENSATION_LABELS,
  POLICY_NAME_MAX_LENGTH,
  TIME_OFF_TYPE_META,
  type Compensation,
  type OfferedAccrualType,
} from "@sfa/shared";
import { FormSection } from "@/components/form";
import { Button } from "@/components/ui/button";
import { withForm } from "@/hooks/form";
import { EMPTY_TIME_OFF } from "../time-off-form";

const COMPENSATION_OPTIONS: { value: Compensation; label: string; caption: string }[] = [
  {
    value: "paid",
    label: COMPENSATION_LABELS.paid,
    caption: "Counts as paid time. A label and a ledger flag — payroll comes later.",
  },
  {
    value: "unpaid",
    label: COMPENSATION_LABELS.unpaid,
    caption: "Tracked, never paid.",
  },
];

const ACCRUAL_OPTIONS: { value: OfferedAccrualType; label: string; caption: string }[] = [
  {
    value: "fixed_amount",
    label: ACCRUAL_TYPE_LABELS.fixed_amount,
    caption: "A set number of hours a year, granted all at once or monthly.",
  },
  {
    value: "unlimited",
    label: ACCRUAL_TYPE_LABELS.unlimited,
    caption: "No balance is tracked. Requests are approved on trust.",
  },
];

/**
 * Step 1 — name, description, paid or unpaid, fixed amount or unlimited.
 *
 * `locked` is the activated policy's drawer: paid/unpaid and Unlimited never
 * change once a policy is live (delete and recreate), so the two choices
 * render disabled with the reason. Unpaid Time Off is unpaid by definition
 * and locks compensation from the start.
 */
export const BasicSetupStep = withForm({
  defaultValues: EMPTY_TIME_OFF,
  props: { locked: false },
  render: function Render({ form, locked }) {
    const type = useStore(form.store, (s) => s.values.timeOffType);
    const description = useStore(form.store, (s) => s.values.description);
    const [describing, setDescribing] = useState(description.trim() !== "");
    const meta = TIME_OFF_TYPE_META[type];

    return (
      <FormSection
        title="Basic setup"
        description={`A ${meta.label} policy. ${meta.description}`}
      >
        <form.AppField name="name">
          {(f) => (
            <f.TextField
              label="Policy name"
              description={`Shown to the people in it. Up to ${POLICY_NAME_MAX_LENGTH} characters.`}
              className="max-w-md"
            />
          )}
        </form.AppField>

        {describing ? (
          <form.AppField name="description">
            {(f) => (
              <f.TextareaField
                label="Description"
                rows={3}
                placeholder="What this policy is for, in a sentence or two."
                className="max-w-xl"
              />
            )}
          </form.AppField>
        ) : (
          <Button type="button" variant="link" size="sm" className="px-0" onClick={() => setDescribing(true)}>
            Add a description
          </Button>
        )}

        <form.AppField name="compensation">
          {(f) => (
            <f.RadioGroupField
              label="Compensation"
              options={COMPENSATION_OPTIONS}
              disabled={locked || meta.compensationLocked}
              description={
                meta.compensationLocked
                  ? `${meta.label} is always unpaid.`
                  : locked
                    ? "Locked once the policy is active. Delete the policy and create a new one to change it."
                    : "Locked once the policy is active."
              }
            />
          )}
        </form.AppField>

        <form.AppField name="accrualType">
          {(f) => (
            <f.RadioGroupField
              label="Accrual type"
              options={ACCRUAL_OPTIONS}
              disabled={locked}
              description={
                locked
                  ? "Unlimited is locked once the policy is active."
                  : "Unlimited is locked once the policy is active. Hours worked arrives with time tracking."
              }
            />
          )}
        </form.AppField>
      </FormSection>
    );
  },
});
