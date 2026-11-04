import { PEOPLE_STATUS_LABELS, type PeopleStatus } from "@sfa/shared";
import type { AgencyUser } from "@/lib/users-api";

/**
 * Shared display vocabulary for the People list — the desktop table, the
 * mobile card and the row menu's labels all render the same person, so the
 * name/initials/status rules live in one place.
 *
 * Modelled on `features/lead/components/lead-display.ts`, which is the pattern
 * for this in the app. Colours are **tokens**, not the raw palette that file is
 * the sanctioned exception for: the four statuses map onto the theme's
 * informational / attention / success / muted, all defined for both themes.
 */

/**
 * Badge copy and colour per status (PAC-162).
 *
 * **Pending onboarding** holds the attention colour: it is the row HR still
 * has to do something about. **Invited** is informational — the ball is in
 * the invitee's court. `deactivated` is deliberately muted rather than
 * destructive: red reads as "something is wrong", and a removed employee is a
 * completed action, not a problem.
 */
export const STATUS_BADGE: Record<
  PeopleStatus,
  { label: string; className: string }
> = {
  invited: {
    label: PEOPLE_STATUS_LABELS.invited,
    className: "bg-primary/12 text-primary",
  },
  pending_onboarding: {
    label: PEOPLE_STATUS_LABELS.pending_onboarding,
    className: "bg-destructive/15 text-destructive",
  },
  active: {
    label: PEOPLE_STATUS_LABELS.active,
    className: "bg-success/12 text-success",
  },
  deactivated: {
    label: "Removed",
    className: "bg-muted text-muted-foreground",
  },
};

/** The facet's order — the order a directory is worked in. */
export const STATUS_FACET_ORDER: readonly PeopleStatus[] = [
  "pending_onboarding",
  "invited",
  "active",
  "deactivated",
];

/** Full name, falling back to the email's handle so a row is never blank. */
export function displayName(user: Pick<AgencyUser, "firstName" | "lastName" | "email">): string {
  const full = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  if (full) return full;
  return user.email.split("@")[0] ?? user.email;
}

/**
 * What to show in the Branch column.
 *
 * A user with no branch is not merely unlabelled — `BranchGuard` refuses every
 * branch-scoped request they make — so this says "Unassigned" rather than an
 * em-dash that would read as "not applicable".
 */
export function branchLabel(
  user: Pick<AgencyUser, "branchId">,
  branchNames: Map<string, string>,
): string {
  if (!user.branchId) return "Unassigned";
  return branchNames.get(user.branchId) ?? "Unknown branch";
}

/** The avatar fallback's token pair — the sidebar chip's, so people look the same everywhere. */
export const AVATAR_FALLBACK_CLASS =
  "bg-sidebar-accent text-xs font-bold text-sidebar-accent-foreground dark:bg-blue-900 dark:text-foreground";
