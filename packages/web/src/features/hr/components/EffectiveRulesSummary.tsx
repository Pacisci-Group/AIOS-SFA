import type {
  EffectiveLeaveRules,
  EffectiveScheduleView,
  LeaveAllocations,
} from "@sfa/shared";
import { DataRow } from "@/components/common/DetailCard";
import { Badge } from "@/components/ui/badge";
import { NOT_AVAILABLE } from "@/lib/not-available";
import { ruleLabel } from "../settings/policies/leave-policy-form";
import { formatWeeklyHours, scheduleLines } from "./ScheduleEditor";
import { WEEKDAY_SHORT } from "../settings/calendar/calendar-display";

interface EffectiveRulesSummaryProps {
  effective: EffectiveLeaveRules | null;
  schedule: EffectiveScheduleView;
  allocations: LeaveAllocations;
  /** The admin's view names the custom rules; the employee's just says "custom". */
  showCustomPaths?: boolean;
}

/**
 * The rules a person is actually on, read-only (PAC-162): the key numbers
 * of their effective policy, their week, and their allocations. Rendered on
 * the admin's employee page and on the employee's own profile card; PAC-165's
 * My Time Off page shows the same.
 */
export function EffectiveRulesSummary({
  effective,
  schedule,
  allocations,
  showCustomPaths = false,
}: EffectiveRulesSummaryProps) {
  const rules = effective?.rules;
  const balanceTypes = rules?.leaveTypes.filter((t) => t.active && t.drawsFromBalance) ?? [];

  return (
    <div className="space-y-4">
      {effective ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-foreground">{effective.policyName}</span>
          {effective.overriddenPaths.length > 0 && (
            <Badge variant="secondary" size="sm">
              {effective.overriddenPaths.length} custom rule
              {effective.overriddenPaths.length === 1 ? "" : "s"}
            </Badge>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No leave policy yet.</p>
      )}

      {showCustomPaths && effective && effective.overriddenPaths.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Custom: {effective.overriddenPaths.map(ruleLabel).join(", ")}
        </p>
      )}

      {rules && (
        <div className="grid gap-4 sm:grid-cols-2">
          <DataRow
            label="Leave types"
            value={rules.leaveTypes
              .filter((t) => t.active)
              .map((t) => t.label)
              .join(", ") || NOT_AVAILABLE}
          />
          <DataRow
            label="Annual allocation"
            value={
              balanceTypes.length
                ? balanceTypes
                    .map((t) => `${t.label}: ${allocations[t.key] ?? rules.pto.annualAllocationHours} h`)
                    .join(" · ")
                : NOT_AVAILABLE
            }
          />
          <DataRow label="Partial-day increment" value={`${rules.requests.partialDayIncrementMinutes} minutes`} />
          <DataRow
            label="Advance notice"
            value={
              rules.requests.validation.advanceNotice === "off" || rules.requests.advanceNoticeDays === null
                ? "No rule"
                : `${rules.requests.advanceNoticeDays} business days`
            }
          />
          <DataRow label="PTO resets" value={rules.pto.resetBasis.replace(/_/g, " ")} />
          <DataRow
            label="Cancel approved leave until"
            value={`${rules.pto.employeeCancelCutoffHours} h before it starts`}
          />
        </div>
      )}

      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Weekly schedule ·{" "}
          {schedule.source === "override"
            ? "custom"
            : schedule.source === "template"
              ? (schedule.templateName ?? "template")
              : "agency workweek"}{" "}
          · {formatWeeklyHours(schedule.weeklyMinutes)}
        </p>
        <ul className="mt-1.5 grid grid-cols-7 gap-1 text-center text-xs">
          {scheduleLines(schedule.effective).map(({ day, text }) => (
            <li key={day} className="rounded-md border border-border bg-card px-1 py-1.5">
              <p className="font-medium text-foreground">{WEEKDAY_SHORT[day]}</p>
              <p className="text-muted-foreground tabular-nums">{text}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
