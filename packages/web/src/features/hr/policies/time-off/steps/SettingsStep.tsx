import { useStore } from "@tanstack/react-form";
import { WAITING_PERIOD_PRESETS } from "@sfa/shared";
import { FormSection } from "@/components/form";
import { withForm } from "@/hooks/form";
import { EMPTY_TIME_OFF } from "../time-off-form";

/**
 * Step 2 — the toggles, all off by default: the usage waiting period,
 * negative balances, pay-out on leaving (stored only; PAC-123 reads it,
 * and it has no meaning on an unpaid or unlimited policy, so it hides).
 */
export const SettingsStep = withForm({
  defaultValues: EMPTY_TIME_OFF,
  render: function Render({ form }) {
    const compensation = useStore(form.store, (s) => s.values.compensation);
    const accrualType = useStore(form.store, (s) => s.values.accrualType);
    const payoutApplies = compensation === "paid" && accrualType !== "unlimited";

    return (
      <FormSection
        title="Settings"
        description="Everything here is off unless you switch it on."
      >
        <div className="grid gap-3">
          <form.AppField name="waitingPeriodEnabled">
            {(f) => (
              <f.SwitchField
                label="Waiting period"
                hint="New hires wait this many calendar days after their hire date before they can request time off. Nobody waits until their hire date is on file."
              >
                <form.AppField name="waitingPeriodDays">
                  {(d) => (
                    <d.NumberField
                      label="Days after hire"
                      description={`${WAITING_PERIOD_PRESETS.join(", ")} days are the usual choices.`}
                      inputMode="numeric"
                      step="1"
                      min="1"
                      className="max-w-xs"
                    />
                  )}
                </form.AppField>
              </f.SwitchField>
            )}
          </form.AppField>

          <form.AppField name="allowNegativeBalance">
            {(f) => (
              <f.SwitchField
                label="Negative balances"
                hint="Requests may take the balance below zero. It accrues back toward zero from there."
              />
            )}
          </form.AppField>

          {payoutApplies && (
            <form.AppField name="payOutOnTermination">
              {(f) => (
                <f.SwitchField
                  label="Unused time off payout"
                  hint="Pay out the balance when someone leaves. Recorded on the policy now; paying it out comes with payroll."
                />
              )}
            </form.AppField>
          )}
        </div>
      </FormSection>
    );
  },
});
