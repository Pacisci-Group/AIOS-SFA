import { History, ScrollText } from "lucide-react";
import {
  EMPLOYEE_PROFILE_EVENT_LABELS,
  type ActivityChange,
  type EmployeeProfileView,
} from "@sfa/shared";
import { DetailCard } from "@/components/common/DetailCard";
import { Badge } from "@/components/ui/badge";
import { NOT_AVAILABLE } from "@/lib/not-available";
import { ruleLabel } from "../../settings/policies/leave-policy-form";
import { formatDay } from "../employee-display";

/**
 * The assignment history (PAC-162): one row per entry, newest first — the
 * rules in force from each day, and who put them there. This is what "which
 * rules applied on day X" reads, so it is shown exactly as stored.
 */
export function AssignmentHistory({ profile }: { profile: EmployeeProfileView }) {
  return (
    <DetailCard title="Rules history" icon={History}>
      {profile.assignments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No rules yet — this person has not been onboarded.</p>
      ) : (
        <ol className="space-y-3">
          {profile.assignments.map((entry, i) => (
            <li
              key={`${entry.effectiveFrom}:${entry.recordedAt}`}
              className="rounded-lg border border-border bg-sunken/40 px-4 py-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-foreground">
                  From {formatDay(entry.effectiveFrom)}
                </span>
                {i === 0 && (
                  <Badge variant="success" size="sm">
                    Current
                  </Badge>
                )}
                <span className="text-xs text-muted-foreground">
                  · {entry.actor?.name ?? "System"} ·{" "}
                  {new Date(entry.recordedAt).toLocaleDateString()}
                </span>
              </div>
              <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">Policy</dt>
                  <dd className="text-foreground">{entry.leavePolicyName ?? NOT_AVAILABLE}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">Schedule</dt>
                  <dd className="text-foreground">
                    {entry.scheduleOverride
                      ? `Day-by-day override${entry.scheduleTemplateName ? ` over ${entry.scheduleTemplateName}` : ""}`
                      : (entry.scheduleTemplateName ?? "Agency workweek")}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">Custom rules</dt>
                  <dd className="text-foreground">
                    {entry.overriddenPaths.length === 0
                      ? "None"
                      : entry.overriddenPaths.map(ruleLabel).join(", ")}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">Allocations</dt>
                  <dd className="text-foreground tabular-nums">
                    {Object.keys(entry.allocations).length === 0
                      ? "Policy defaults"
                      : Object.entries(entry.allocations)
                          .map(([key, hours]) => `${key}: ${hours} h`)
                          .join(", ")}
                  </dd>
                </div>
              </dl>
              {entry.reason && (
                <p className="mt-2 text-sm text-muted-foreground">“{entry.reason}”</p>
              )}
            </li>
          ))}
        </ol>
      )}
    </DetailCard>
  );
}

/** The before/after audit log (PAC-162), newest first; the last 50. */
export function ChangeLog({ profile }: { profile: EmployeeProfileView }) {
  return (
    <DetailCard title="Change log" icon={ScrollText}>
      {profile.events.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing yet.</p>
      ) : (
        <ol className="space-y-3">
          {profile.events.map((event) => (
            <li key={event.id} className="border-b border-border pb-3 last:border-b-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium text-foreground">
                  {EMPLOYEE_PROFILE_EVENT_LABELS[event.kind]}
                </span>
                <span className="text-xs text-muted-foreground">
                  {event.actor?.name ?? "System"} · {new Date(event.at).toLocaleString()}
                </span>
              </div>
              {event.reason && (
                <p className="mt-1 text-sm text-muted-foreground">“{event.reason}”</p>
              )}
              {event.changes.length > 0 && (
                <ul className="mt-1.5 space-y-0.5">
                  {event.changes.map((change) => (
                    <li key={change.field} className="text-sm">
                      <span className="text-muted-foreground">{change.label}: </span>
                      <span className="text-foreground">
                        {changeValue(change)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
    </DetailCard>
  );
}

/** "before → after", with the custom-rule paths read as the editor labels them. */
function changeValue(change: ActivityChange): string {
  const render = (value: ActivityChange["from"]): string => {
    if (value === null) return NOT_AVAILABLE;
    if (Array.isArray(value)) {
      if (!value.length) return NOT_AVAILABLE;
      return (change.field === "customRules" ? value.map(ruleLabel) : value).join(", ");
    }
    return String(value);
  };
  return `${render(change.from)} → ${render(change.to)}`;
}
