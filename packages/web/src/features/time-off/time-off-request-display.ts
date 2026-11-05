import {
  TIME_OFF_REQUEST_GROUP_LABELS,
  type ScheduledDayReason,
  type TimeOffRequestGroup,
  type TimeOffRequestRow,
  type TimeOffTimelineAction,
} from "@sfa/shared";
import { formatDay, formatRange } from "@/features/hr/policies/policy-display";

/**
 * Shared display vocabulary for time off requests (PAC-165) — the lists,
 * the request window and the profile all render the same request, so the
 * badge, date and timeline wording live in one place. Colours are tokens,
 * defined for both themes.
 */

/**
 * Badge copy and colour per list group.
 *
 * **Changes requested** holds the attention colour (`destructive` is the
 * app's amber): it is the one row the employee has to act on. **Pending** is
 * informational — the ball is with the reviewer. **Approved** is the success
 * colour; **Taken**, **Declined**, **Cancelled**, a **Draft** and an
 * **Imported** row are all muted — finished, or not yet anything.
 */
export const GROUP_BADGE: Record<TimeOffRequestGroup, { label: string; className: string }> = {
  changes_requested: {
    label: "Changes requested",
    className: "bg-destructive/15 text-destructive",
  },
  draft: { label: "Draft", className: "bg-muted text-muted-foreground" },
  pending: { label: "Pending", className: "bg-primary/12 text-primary" },
  approved: { label: "Approved", className: "bg-success/12 text-success" },
  taken: { label: "Taken", className: "bg-muted text-muted-foreground" },
  declined: { label: "Declined", className: "bg-muted text-muted-foreground" },
  cancelled: { label: "Cancelled", className: "bg-muted text-muted-foreground" },
  imported: { label: "Imported", className: "bg-muted text-muted-foreground" },
};

/** The employee's list headings; the reviewer reads `pending` as work to do. */
export const MY_GROUP_HEADING = TIME_OFF_REQUEST_GROUP_LABELS;

export const TEAM_GROUP_LABEL: Record<TimeOffRequestGroup, string> = {
  ...TIME_OFF_REQUEST_GROUP_LABELS,
  pending: "To review",
  draft: "Drafts",
};

/** What happened, in the timeline's words. */
export const TIMELINE_LABEL: Record<TimeOffTimelineAction, string> = {
  created: "Draft saved",
  submitted: "Sent for review",
  resubmitted: "Sent again",
  auto_approved: "Approved automatically",
  approved: "Approved",
  changes_requested: "Changes requested",
  declined: "Declined",
  cancelled: "Cancelled",
  recorded: "Recorded",
  imported: "Imported from SmartSuite",
};

/** Why a date in the range takes no hours. */
export const DAY_REASON_LABEL: Record<ScheduledDayReason, string> = {
  scheduled: "",
  weekend: "Weekend",
  holiday: "Holiday",
  closure: "Office closed",
  not_scheduled: "Not scheduled",
};

/** `'Thu, Nov 12, 2026'`, or `'Nov 12 – Nov 14'` for a range. */
export function requestDates(row: Pick<TimeOffRequestRow, "firstDay" | "lastDay">): string {
  if (!row.firstDay) return "No dates";
  if (!row.lastDay || row.lastDay === row.firstDay) return formatDay(row.firstDay);
  return `${formatRange(row.firstDay, row.lastDay)}, ${row.lastDay.slice(0, 4)}`;
}

/** The policy's name, or the SmartSuite label an imported row carries. */
export function requestPolicyName(row: Pick<TimeOffRequestRow, "policy" | "legacy">): string {
  return row.policy?.name ?? row.legacy?.type ?? "Time off";
}

/** `TOR-2026-007`, or "Imported" for a row with no reference. */
export function requestReference(row: Pick<TimeOffRequestRow, "reference">): string {
  return row.reference ?? "Imported";
}

const WHEN_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** `'Nov 5, 2026, 10:42 AM'` — a timeline entry's instant, in the reader's zone. */
export function formatWhen(iso: string): string {
  return WHEN_FORMAT.format(new Date(iso));
}
