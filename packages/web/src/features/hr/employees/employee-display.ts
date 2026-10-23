import {
  EMPLOYEE_PROFILE_STATUS_LABELS,
  type EmployeeProfileStatus,
  type EmployeeUserView,
} from "@sfa/shared";
import { NOT_AVAILABLE } from "@/lib/not-available";

/**
 * How an employee profile reads on screen (PAC-162). Token pairs only, on
 * the `X-600 dark:X-400` rule the lead and policy displays follow.
 */
export const STATUS_LABELS = EMPLOYEE_PROFILE_STATUS_LABELS;

export const STATUS_BADGE_CLASS: Record<EmployeeProfileStatus, string> = {
  pending: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  active: "bg-success/15 text-success",
  terminated: "bg-muted text-muted-foreground",
};

export const ACCOUNT_STATUS_LABELS: Record<EmployeeUserView["accountStatus"], string> = {
  active: "Active account",
  invited: "Invite pending",
  deactivated: "Removed",
};

export function employeeName(user: EmployeeUserView): string {
  return user.name?.trim() || user.email;
}

export function initialsOf(user: EmployeeUserView): string {
  const name = user.name?.trim();
  if (!name) return user.email.slice(0, 2).toUpperCase();
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/** `'2026-01-10'` → `'10 Jan 2026'`, without touching the browser zone. */
export function formatDay(iso: string | null | undefined): string {
  if (!iso) return NOT_AVAILABLE;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** `'03-15'` → `'15 Mar'`. */
export function formatMonthDay(monthDay: string | null | undefined): string {
  if (!monthDay) return NOT_AVAILABLE;
  const [m, d] = monthDay.split("-").map(Number);
  if (!m || !d) return monthDay;
  return `${d} ${MONTHS[m - 1]}`;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "3 days" / "today" from an ISO instant, for "pending since". */
export function daysSince(iso: string, now = new Date()): string {
  const days = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 86400000));
  if (days === 0) return "today";
  if (days === 1) return "1 day";
  return `${days} days`;
}
