import { useStore } from "@tanstack/react-form";
import {
  ACCRUAL_FREQUENCY_LABELS,
  monthlyAccrualHours,
  RESET_DATE_KIND_LABELS,
  type OfferedAccrualFrequency,
  type ResetDateKind,
} from "@sfa/shared";
import { FormGrid, FormSection, FormSubPanel } from "@/components/form";
import { withForm } from "@/hooks/form";
import { MONTH_NAMES, formatBalance } from "../time-off-display";
import { EMPTY_TIME_OFF } from "../time-off-form";

const FREQUENCY_OPTIONS: { value: OfferedAccrualFrequency; label: string; caption: string }[] = [
  {
    value: "yearly",
    label: ACCRUAL_FREQUENCY_LABELS.yearly,
    caption: "The whole year's hours on the reset date.",
  },
  {
    value: "monthly",
    label: ACCRUAL_FREQUENCY_LABELS.monthly,
    caption: "A twelfth on the 1st of each month.",
  },
];

const RESET_OPTIONS: { value: ResetDateKind; label: string; caption: string }[] = [
  {
    value: "fixed",
    label: RESET_DATE_KIND_LABELS.fixed,
    caption: "One reset date for the whole policy, January 1 by default.",
  },
  {
    value: "hire_anniversary",
    label: RESET_DATE_KIND_LABELS.hire_anniversary,
    caption: "Resets on each person's own anniversary once their hire date is on file.",
  },
];

const MONTH_OPTIONS = MONTH_NAMES.map((name, index) => ({
  value: String(index + 1).padStart(2, "0"),
  label: name,
}));
const DAY_OPTIONS = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0"));

/**
 * Step 3 — the base rate, the reset date and the caps. Hidden for Unlimited
 * (the wizard drops the step). Carryover has no meaning on a lump sum that
 * resets on each person's own anniversary, so it hides there; the annual
 * usage cap is a Sick Leave feature.
 */
export const AccrualStep = withForm({
  defaultValues: EMPTY_TIME_OFF,
  render: function Render({ form }) {
    const type = useStore(form.store, (s) => s.values.timeOffType);
    const hours = useStore(form.store, (s) => s.values.hoursPerYear);
    const frequency = useStore(form.store, (s) => s.values.accrualFrequency);
    const resetKind = useStore(form.store, (s) => s.values.resetDateKind);
    const yearly = Number(hours) > 0 ? Number(hours) : null;
    const carryoverApplies = !(resetKind === "hire_anniversary" && frequency === "yearly");

    return (
      <FormSection title="Accrual" description="How hours are earned and when the year starts over.">
        <FormSubPanel title="Base rate">
          <div className="space-y-4">
            <form.AppField name="hoursPerYear">
              {(f) => (
                <f.NumberField
                  label="Total hours per year"
                  description={
                    yearly && frequency === "monthly"
                      ? `${formatBalance(monthlyAccrualHours(yearly))} on the 1st of each month.`
                      : "80 hours is two working weeks."
                  }
                  step="0.25"
                  min="0"
                  className="max-w-xs"
                />
              )}
            </form.AppField>
            <form.AppField name="accrualFrequency">
              {(f) => <f.RadioGroupField label="Accrual frequency" options={FREQUENCY_OPTIONS} />}
            </form.AppField>
            <form.AppField name="resetDateKind">
              {(f) => <f.RadioGroupField label="Reset date" options={RESET_OPTIONS} />}
            </form.AppField>
            {resetKind === "fixed" && (
              <FormGrid columns={2} gap={3} className="max-w-md">
                <form.AppField name="resetMonth">
                  {(f) => <f.SelectField label="Month" options={MONTH_OPTIONS} />}
                </form.AppField>
                <form.AppField name="resetDay">
                  {(f) => <f.SelectField label="Day" options={DAY_OPTIONS} />}
                </form.AppField>
              </FormGrid>
            )}
          </div>
        </FormSubPanel>

        <FormSubPanel title="Caps">
          <FormGrid columns={2} gap={3} className="max-w-xl">
            <form.AppField name="maxBalanceHours">
              {(f) => (
                <f.NumberField
                  label="Max balance (hours)"
                  description="Accrual stops at this balance. Blank for no cap."
                  step="0.25"
                  min="0"
                />
              )}
            </form.AppField>
            {carryoverApplies && (
              <form.AppField name="carryoverCapHours">
                {(f) => (
                  <f.NumberField
                    label="Carryover cap (hours)"
                    description="Hours that survive the reset. 0 means none carries; blank means all of it."
                    step="0.25"
                    min="0"
                  />
                )}
              </form.AppField>
            )}
          </FormGrid>
        </FormSubPanel>

        {type === "sick" && (
          <FormSubPanel title="Annual usage cap">
            <form.AppField name="annualUsageCapHours">
              {(f) => (
                <f.NumberField
                  label="Hours a person may use per year"
                  description="A request over the cap is blocked. Blank for no cap."
                  step="0.25"
                  min="0"
                  className="max-w-xs"
                />
              )}
            </form.AppField>
          </FormSubPanel>
        )}
      </FormSection>
    );
  },
});
