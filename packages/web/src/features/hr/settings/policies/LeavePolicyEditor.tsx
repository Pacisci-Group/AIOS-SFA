import { useRef, useState, type ReactNode } from "react";
import { Plus, RotateCcw, X } from "lucide-react";
import { NOTIFICATION_TRIGGERS } from "@sfa/shared";
import { FormError, FormGrid, FormSection, FormSubPanel } from "@/components/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useAppForm } from "@/hooks/form";
import {
  CARRYOVER_OPTIONS,
  CLASSIFICATION_OPTIONS,
  COVERAGE_NOTE_OPTIONS,
  EVENT_TYPE_OPTIONS,
  INCREMENT_OPTIONS,
  NEGATIVE_BALANCE_OPTIONS,
  POINT_RESET_OPTIONS,
  PRORATION_OPTIONS,
  PTO_RESET_OPTIONS,
  RECIPIENT_OPTIONS,
  SEQUENCE_OPTIONS,
  TRIGGER_LABELS,
  VALIDATION_MODE_OPTIONS,
  isUnder,
  leavePolicyFormSchema,
  ruleLabel,
  type LeavePolicyFormValues,
} from "./leave-policy-form";

interface LeavePolicyEditorProps {
  initial: LeavePolicyFormValues;
  saving: boolean;
  /** The server's one-line verdict on the last save, if it refused. */
  serverError: string | null;
  saveLabel: string;
  /**
   * `intent` is `'newPolicy'` when the secondary button was pressed (PAC-162):
   * the same validated values, meant to become a named policy of their own.
   */
  onSubmit: (values: LeavePolicyFormValues, intent?: "newPolicy") => void;
  onCancel?: () => void;
  /**
   * `overrides` (PAC-162): the same form over one employee's **merged**
   * rules. The name section is hidden (the policy keeps its name), every
   * section that an override touches carries a "Custom" badge, and the
   * banner lists the overridden rules with a reset that re-seeds the form
   * from the template. The caller turns the submitted values back into a
   * diff; nothing here knows what an override is beyond the paths.
   */
  mode?: "policy" | "overrides";
  /** Dotted rule paths the overrides change — the "Custom" badges. */
  overriddenPaths?: readonly string[];
  /** Re-seed the form from the template (the caller remounts with new values). */
  onResetToTemplate?: () => void;
  /**
   * Renders a secondary submit — "Save as new policy" — that validates the
   * same form and calls `onSubmit` with `intent: 'newPolicy'`. The epic's
   * rule: a person whose rules match nobody gets a new named policy, never a
   * clone with a large override set.
   */
  newPolicyLabel?: ReactNode;
}

/**
 * One section per area of the epic's §2 table (PAC-161). Mounted only once
 * its values exist and re-seeded by remount — the array-field `reset` trap
 * in `docs/tanstack-form-spike-findings.md` — so `defaultValues` is frozen.
 *
 * The cross-field rules (a fiscal-year start when the reset is fiscal, and
 * so on) are the API's: it answers with every problem in one sentence each,
 * shown under the form. The schema here keeps shapes honest, nothing more.
 */
export function LeavePolicyEditor({
  initial,
  saving,
  serverError,
  saveLabel,
  onSubmit,
  onCancel,
  mode = "policy",
  overriddenPaths = [],
  onResetToTemplate,
  newPolicyLabel,
}: LeavePolicyEditorProps) {
  const [defaultValues] = useState(initial);
  // Which button submitted: read once in `onSubmit`, then cleared.
  const intentRef = useRef<"newPolicy" | undefined>(undefined);
  const form = useAppForm({
    defaultValues,
    validators: { onBlur: leavePolicyFormSchema },
    onSubmit: ({ value }) => {
      const intent = intentRef.current;
      intentRef.current = undefined;
      onSubmit(value, intent);
    },
  });

  const overrides = mode === "overrides";
  /** The "Custom" badge on a section whose rules an override touches. */
  const customBadge = (prefix: string) =>
    overrides && overriddenPaths.some((path) => isUnder(path, prefix)) ? (
      <Badge variant="secondary" size="sm">
        Custom
      </Badge>
    ) : undefined;

  /** A checkbox group over a `string[]` field. */
  const checkboxGroup = (
    value: readonly string[],
    onChange: (next: string[]) => void,
    options: readonly { value: string; label: string }[],
    idPrefix: string,
  ) => (
    <div className="flex flex-wrap gap-x-5 gap-y-2">
      {options.map((option) => {
        const id = `${idPrefix}-${option.value}`;
        const on = value.includes(option.value);
        return (
          <div key={option.value} className="flex items-center gap-2">
            <Checkbox
              id={id}
              checked={on}
              onCheckedChange={(checked) =>
                onChange(
                  checked === true
                    ? [...value, option.value]
                    : value.filter((v) => v !== option.value),
                )
              }
            />
            <Label htmlFor={id} className="font-normal">
              {option.label}
            </Label>
          </div>
        );
      })}
    </div>
  );

  return (
    <form.AppForm>
      <form
        noValidate
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        {overrides ? (
          <div className="rounded-xl border border-border bg-card px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-semibold text-card-foreground">
                  {overriddenPaths.length === 0
                    ? "On the policy as written"
                    : `${overriddenPaths.length} custom rule${overriddenPaths.length === 1 ? "" : "s"}`}
                </p>
                <p className="text-sm text-muted-foreground">
                  {overriddenPaths.length === 0
                    ? "Change any value below to give this person a custom rule. Only what differs from the policy is stored."
                    : "Only these differ from the policy; everything else follows it, including future edits to the policy."}
                </p>
                {overriddenPaths.length > 0 && (
                  <ul className="flex flex-wrap gap-1.5 pt-1">
                    {overriddenPaths.map((path) => (
                      <li key={path}>
                        <Badge variant="secondary" size="sm">
                          {ruleLabel(path)}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {onResetToTemplate && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={saving}
                  onClick={onResetToTemplate}
                >
                  <RotateCcw className="size-4" />
                  Reset to policy
                </Button>
              )}
            </div>
          </div>
        ) : (
          <FormSection title="Policy">
            <form.AppField name="name">
              {(f) => (
                <f.TextField label="Name" placeholder="Company policy" autoComplete="off" />
              )}
            </form.AppField>
          </FormSection>
        )}

        <FormSection
          title="Leave types"
          description="Each type says whether a request draws from the PTO balance."
          action={customBadge("leaveTypes")}
        >
          <form.Field name="leaveTypes" mode="array">
            {(field) => (
              <div className="space-y-3">
                {field.state.value.map((_, index) => (
                  <FormSubPanel
                    key={index}
                    title={`Leave type ${index + 1}`}
                    action={
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-muted-foreground hover:text-foreground"
                        aria-label={`Remove leave type ${index + 1}`}
                        onClick={() => field.removeValue(index)}
                      >
                        <X size={14} />
                      </Button>
                    }
                  >
                    <FormGrid gap={3}>
                      <form.AppField name={`leaveTypes[${index}].label`}>
                        {(f) => <f.TextField label="Label" placeholder="Paid" />}
                      </form.AppField>
                      <form.AppField name={`leaveTypes[${index}].key`}>
                        {(f) => (
                          <f.TextField
                            label="Key"
                            description="Stored on every request; never renamed once used."
                            placeholder="paid"
                            inputClassName="font-mono"
                          />
                        )}
                      </form.AppField>
                      <form.AppField name={`leaveTypes[${index}].drawsFromBalance`}>
                        {(f) => <f.CheckboxField label="Draws from the PTO balance" />}
                      </form.AppField>
                      <form.AppField name={`leaveTypes[${index}].active`}>
                        {(f) => <f.CheckboxField label="Offered on the request form" />}
                      </form.AppField>
                    </FormGrid>
                  </FormSubPanel>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    field.pushValue({ key: "", label: "", drawsFromBalance: false, active: true })
                  }
                >
                  <Plus size={14} />
                  Add leave type
                </Button>
              </div>
            )}
          </form.Field>
        </FormSection>

        <FormSection
          title="Reasons"
          description="One per line, in the order the forms list them."
          action={customBadge("reasons")}
        >
          <FormGrid>
            <form.AppField name="reasonsTimeOff">
              {(f) => <f.TextareaField label="Time-off requests" rows={7} />}
            </form.AppField>
            <form.AppField name="reasonsAttendance">
              {(f) => <f.TextareaField label="Attendance events" rows={7} />}
            </form.AppField>
          </FormGrid>
        </FormSection>

        <FormSection title="Requests" action={customBadge("requests")}>
          <FormGrid>
            <form.AppField name="partialDayIncrementMinutes">
              {(f) => (
                <f.SelectField
                  label="Partial-day increment"
                  options={INCREMENT_OPTIONS}
                  triggerClassName="w-full bg-card border-border"
                />
              )}
            </form.AppField>
            <form.AppField name="coverageNote">
              {(f) => (
                <f.SelectField
                  label="Coverage note"
                  options={COVERAGE_NOTE_OPTIONS}
                  triggerClassName="w-full bg-card border-border"
                />
              )}
            </form.AppField>
            <form.AppField name="acknowledgmentText">
              {(f) => (
                <f.TextareaField
                  label="Acknowledgment text"
                  rows={2}
                  className="sm:col-span-2"
                />
              )}
            </form.AppField>
          </FormGrid>
          <FormGrid columns={3} gap={3}>
            <form.AppField name="validationOverlap">
              {(f) => (
                <f.SelectField
                  label="Overlapping leave"
                  options={VALIDATION_MODE_OPTIONS}
                  triggerClassName="w-full bg-card border-border"
                />
              )}
            </form.AppField>
            <form.AppField name="validationClosure">
              {(f) => (
                <f.SelectField
                  label="Day the office is closed"
                  options={VALIDATION_MODE_OPTIONS}
                  triggerClassName="w-full bg-card border-border"
                />
              )}
            </form.AppField>
            <form.AppField name="validationNonScheduledDay">
              {(f) => (
                <f.SelectField
                  label="Day not on the schedule"
                  options={VALIDATION_MODE_OPTIONS}
                  triggerClassName="w-full bg-card border-border"
                />
              )}
            </form.AppField>
            <form.AppField name="validationAdvanceNotice">
              {(f) => (
                <f.SelectField
                  label="Advance notice"
                  options={VALIDATION_MODE_OPTIONS}
                  triggerClassName="w-full bg-card border-border"
                />
              )}
            </form.AppField>
            <form.AppField name="advanceNoticeDays">
              {(f) => (
                <f.NumberField
                  label="Advance notice (business days)"
                  description="Blank means no rule."
                  inputMode="numeric"
                  min="0"
                />
              )}
            </form.AppField>
            <form.AppField name="validationBlackout">
              {(f) => (
                <f.SelectField
                  label="Blackout dates"
                  options={VALIDATION_MODE_OPTIONS}
                  triggerClassName="w-full bg-card border-border"
                />
              )}
            </form.AppField>
          </FormGrid>
          <form.Field name="blackoutRanges" mode="array">
            {(field) => (
              <div className="space-y-3">
                {field.state.value.map((_, index) => (
                  <FormSubPanel
                    key={index}
                    title={`Blackout ${index + 1}`}
                    action={
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-muted-foreground hover:text-foreground"
                        aria-label={`Remove blackout ${index + 1}`}
                        onClick={() => field.removeValue(index)}
                      >
                        <X size={14} />
                      </Button>
                    }
                  >
                    <FormGrid columns={3} gap={3}>
                      <form.AppField name={`blackoutRanges[${index}].label`}>
                        {(f) => <f.TextField label="Label" placeholder="Year end" />}
                      </form.AppField>
                      <form.AppField name={`blackoutRanges[${index}].from`}>
                        {(f) => <f.TextField label="From" type="date" />}
                      </form.AppField>
                      <form.AppField name={`blackoutRanges[${index}].to`}>
                        {(f) => <f.TextField label="To" type="date" />}
                      </form.AppField>
                    </FormGrid>
                  </FormSubPanel>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => field.pushValue({ from: "", to: "", label: "" })}
                >
                  <Plus size={14} />
                  Add blackout range
                </Button>
              </div>
            )}
          </form.Field>
        </FormSection>

        <FormSection title="PTO" action={customBadge("pto")}>
          <FormGrid columns={3} gap={3}>
            <form.AppField name="annualAllocationHours">
              {(f) => <f.NumberField label="Annual allocation (hours)" min="0" />}
            </form.AppField>
            <form.AppField name="resetBasis">
              {(f) => (
                <f.SelectField
                  label="Resets on"
                  options={PTO_RESET_OPTIONS}
                  triggerClassName="w-full bg-card border-border"
                />
              )}
            </form.AppField>
            <form.AppField name="fiscalYearStart">
              {(f) => (
                <f.TextField
                  label="Fiscal year starts (MM-DD)"
                  placeholder="07-01"
                  description="Only for a fiscal-year reset."
                />
              )}
            </form.AppField>
            <form.AppField name="proration">
              {(f) => (
                <f.SelectField
                  label="New-hire proration"
                  options={PRORATION_OPTIONS}
                  triggerClassName="w-full bg-card border-border"
                />
              )}
            </form.AppField>
            <form.AppField name="carryoverMode">
              {(f) => (
                <f.SelectField
                  label="Carryover"
                  options={CARRYOVER_OPTIONS}
                  triggerClassName="w-full bg-card border-border"
                />
              )}
            </form.AppField>
            <form.AppField name="carryoverCapHours">
              {(f) => (
                <f.NumberField label="Carryover cap (hours)" description="When capped." min="0" />
              )}
            </form.AppField>
            <form.AppField name="carryoverExpiryDays">
              {(f) => (
                <f.NumberField
                  label="Carried hours expire after (days)"
                  description="Blank means never."
                  inputMode="numeric"
                  min="0"
                />
              )}
            </form.AppField>
            <form.AppField name="negativeBalanceMode">
              {(f) => (
                <f.SelectField
                  label="Negative balance"
                  options={NEGATIVE_BALANCE_OPTIONS}
                  triggerClassName="w-full bg-card border-border"
                />
              )}
            </form.AppField>
            <form.AppField name="negativeFloorHours">
              {(f) => (
                <f.NumberField label="Floor (hours below zero)" description="When floored." min="0" />
              )}
            </form.AppField>
            <form.AppField name="employeeCancelCutoffHours">
              {(f) => (
                <f.NumberField
                  label="Employee may cancel until (hours before start)"
                  inputMode="numeric"
                  min="0"
                />
              )}
            </form.AppField>
            <form.AppField name="reserveApprovedFutureLeave">
              {(f) => (
                <f.CheckboxField
                  label="Reserve approved future leave"
                  hint="Approved days ahead reduce the available balance now."
                  className="sm:col-span-2"
                />
              )}
            </form.AppField>
          </FormGrid>
        </FormSection>

        <FormSection
          title="Reminders"
          description="Business days on the agency calendar."
          action={customBadge("reminders")}
        >
          <FormGrid columns={3} gap={3}>
            <form.AppField name="reminderBusinessDays">
              {(f) => <f.NumberField label="Remind reviewers after" inputMode="numeric" min="0" />}
            </form.AppField>
            <form.AppField name="escalationBusinessDays">
              {(f) => <f.NumberField label="Escalate to admins after" inputMode="numeric" min="0" />}
            </form.AppField>
            <form.AppField name="upcomingLeaveLeadBusinessDays">
              {(f) => <f.NumberField label="Upcoming-leave reminder" inputMode="numeric" min="0" />}
            </form.AppField>
          </FormGrid>
        </FormSection>

        <FormSection title="Attendance" action={customBadge("attendance")}>
          <FormGrid gap={3}>
            <form.AppField name="tardyGraceMinutes">
              {(f) => <f.NumberField label="Tardy grace (minutes)" inputMode="numeric" min="0" />}
            </form.AppField>
          </FormGrid>
          <form.Field name="eventTypes">
            {(field) => (
              <div className="space-y-2">
                <Label>Event types in use</Label>
                {checkboxGroup(field.state.value, field.handleChange, EVENT_TYPE_OPTIONS, "hr-event")}
              </div>
            )}
          </form.Field>
        </FormSection>

        <FormSection title="Points" action={customBadge("points")}>
          <form.AppField name="pointsEnabled">
            {(f) => <f.CheckboxField label="Attendance points are on" />}
          </form.AppField>
          <form.Field name="earningClassifications">
            {(field) => (
              <div className="space-y-2">
                <Label>Classifications that earn points</Label>
                {checkboxGroup(
                  field.state.value,
                  field.handleChange,
                  CLASSIFICATION_OPTIONS,
                  "hr-class",
                )}
              </div>
            )}
          </form.Field>
          <FormGrid gap={3}>
            <form.AppField name="ladderTardy">
              {(f) => (
                <f.TextField
                  label="Tardy ladder"
                  description="Points per occurrence; the last repeats. Leaving early counts here."
                  placeholder="1, 2, 3, 4"
                />
              )}
            </form.AppField>
            <form.AppField name="ladderAbsence">
              {(f) => (
                <f.TextField
                  label="Absence ladder"
                  description="No call, no show counts here."
                  placeholder="2, 3, 4"
                />
              )}
            </form.AppField>
            <form.AppField name="sequences">
              {(f) => (
                <f.SelectField
                  label="Tardies and absences"
                  options={SEQUENCE_OPTIONS}
                  triggerClassName="w-full bg-card border-border"
                />
              )}
            </form.AppField>
            <form.AppField name="pointsResetBasis">
              {(f) => (
                <f.SelectField
                  label="Cycle resets on"
                  options={POINT_RESET_OPTIONS}
                  triggerClassName="w-full bg-card border-border"
                />
              )}
            </form.AppField>
          </FormGrid>
          <form.Field name="thresholds" mode="array">
            {(field) => (
              <div className="space-y-3">
                {field.state.value.map((_, index) => (
                  <FormSubPanel
                    key={index}
                    title={`Threshold ${index + 1}`}
                    action={
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-muted-foreground hover:text-foreground"
                        aria-label={`Remove threshold ${index + 1}`}
                        onClick={() => field.removeValue(index)}
                      >
                        <X size={14} />
                      </Button>
                    }
                  >
                    <FormGrid gap={3}>
                      <form.AppField name={`thresholds[${index}].points`}>
                        {(f) => <f.NumberField label="Points" inputMode="numeric" min="1" />}
                      </form.AppField>
                      <form.Field name={`thresholds[${index}].recipients`}>
                        {(sub) => (
                          <div className="space-y-2">
                            <Label>Notify</Label>
                            {checkboxGroup(
                              sub.state.value,
                              sub.handleChange,
                              RECIPIENT_OPTIONS,
                              `hr-threshold-${index}`,
                            )}
                          </div>
                        )}
                      </form.Field>
                      <form.AppField name={`thresholds[${index}].guidance`}>
                        {(f) => (
                          <f.TextareaField label="Guidance" rows={2} className="sm:col-span-2" />
                        )}
                      </form.AppField>
                    </FormGrid>
                  </FormSubPanel>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => field.pushValue({ points: "", recipients: [], guidance: "" })}
                >
                  <Plus size={14} />
                  Add threshold
                </Button>
              </div>
            )}
          </form.Field>
        </FormSection>

        <FormSection
          title="Routing"
          description="Who is told, per trigger."
          action={customBadge("routing")}
        >
          <div className="space-y-3">
            {NOTIFICATION_TRIGGERS.map((trigger) => (
              <form.Field key={trigger} name={`routing.${trigger}`}>
                {(field) => (
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,14rem)_1fr] sm:items-center">
                    <Label className="text-sm">{TRIGGER_LABELS[trigger]}</Label>
                    {checkboxGroup(
                      field.state.value ?? [],
                      field.handleChange,
                      RECIPIENT_OPTIONS,
                      `hr-route-${trigger}`,
                    )}
                  </div>
                )}
              </form.Field>
            ))}
          </div>
        </FormSection>

        <FormError>{serverError}</FormError>

        <div className="flex flex-wrap justify-end gap-2">
          {onCancel && (
            <Button type="button" variant="ghost" disabled={saving} onClick={onCancel}>
              Cancel
            </Button>
          )}
          {newPolicyLabel && (
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => {
                intentRef.current = "newPolicy";
                void form.handleSubmit();
              }}
            >
              {newPolicyLabel}
            </Button>
          )}
          <Button type="submit" variant="brand" disabled={saving}>
            {saving ? "Saving…" : saveLabel}
          </Button>
        </div>
      </form>
    </form.AppForm>
  );
}
