import type { AgencyUser, UserStatus } from "@/lib/users-api";

/**
 * Shared display vocabulary for the agency directory — the desktop table, the
 * mobile card and the row menu's labels all render the same person, so the
 * name/initials/status rules live in one place.
 *
 * Modelled on `features/lead/components/lead-display.ts`, which is the pattern
 * for this in the app. Colours are **tokens**, not the raw palette that file is
 * the sanctioned exception for: "active / invited / removed" is not a product
 * vocabulary needing hues of its own, it maps onto success / attention / muted,
 * all three of which the theme already defines for both light and dark.
 */

/**
 * Badge copy and colour per status.
 *
 * `deactivated` is deliberately muted rather than destructive: red reads as
 * "something is wrong", and a removed employee is a completed action, not a
 * problem. The attention colour stays reserved for the pending invite, which is
 * the row that still needs somebody to do something.
 */
export const STATUS_BADGE: Record<
  UserStatus,
  { label: string; className: string }
> = {
  active: { label: "Active", className: "bg-success/12 text-success" },
  invited: {
    label: "Invited",
    className: "bg-destructive/15 text-destructive",
  },
  deactivated: {
    label: "Removed",
    className: "bg-muted text-muted-foreground",
  },
};

/** Full name, falling back to the email's handle so a row is never blank. */
export function displayName(user: AgencyUser): string {
  const full = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  if (full) return full;
  return user.email.split("@")[0] ?? user.email;
}

/** Up to two letters for the avatar fallback. */
export function initials(user: AgencyUser): string {
  const parts = [user.firstName, user.lastName].filter(Boolean) as string[];
  if (parts.length) {
    return parts
      .map((part) => part.charAt(0).toUpperCase())
      .join("")
      .slice(0, 2);
  }
  return (user.email.slice(0, 2) || "U").toUpperCase();
}

/**
 * What to show in the Branch column.
 *
 * A user with no branch is not merely unlabelled — `BranchGuard` refuses every
 * branch-scoped request they make — so this says "Unassigned" rather than an
 * em-dash that would read as "not applicable".
 */
export function branchLabel(
  user: AgencyUser,
  branchNames: Map<string, string>,
): string {
  if (!user.branchId) return "Unassigned";
  return branchNames.get(user.branchId) ?? "Unknown branch";
}
