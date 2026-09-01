import type { BugReportStatus, BugSeverity } from "@sfa/shared";

/**
 * Display mapping for the bug queue.
 *
 * Kept out of the components so the list rows and the detail sheet cannot drift
 * into rendering the same status two different ways — the exact failure
 * TYPOGRAPHY.md was written about.
 */

type BadgeVariant =
  | "default"
  | "secondary"
  | "destructive"
  | "success"
  | "outline"
  | "ghost";

/**
 * Status → badge.
 *
 * `new` is `default` (the Allstate sky primary) because untriaged is the one
 * state that wants attention; the two terminal states go quiet — `success` for
 * resolved, `outline` for won't-fix, which is a decision rather than a win.
 */
export const BUG_STATUS_VARIANT: Record<BugReportStatus, BadgeVariant> = {
  new: "default",
  triaged: "secondary",
  in_progress: "secondary",
  resolved: "success",
  wont_fix: "outline",
};

/**
 * Severity → badge.
 *
 * Only the top step is `destructive` (the amber token, not red — see
 * `packages/web/CLAUDE.md`). A queue where everything is loud is a queue where
 * nothing is.
 */
export const BUG_SEVERITY_VARIANT: Record<BugSeverity, BadgeVariant> = {
  low: "outline",
  normal: "secondary",
  high: "secondary",
  blocking: "destructive",
};

/** Short severity text for a dense list row — the full copy is on the detail. */
export const BUG_SEVERITY_SHORT: Record<BugSeverity, string> = {
  low: "Minor",
  normal: "Normal",
  high: "High",
  blocking: "Blocking",
};

/**
 * `2h ago` / `3d ago`.
 *
 * Same shape as `HotLeadRow`'s local copy. Not imported from there: that one is
 * a private helper inside a producer-dashboard component, and reaching across
 * features for it would couple the Super Admin panel to a page that is being
 * reworked. If a third copy appears, promote it to `lib/`.
 */
export function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";

  const minutes = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.round(days / 30)}mo ago`;
}

/** `1.4 MB` — screenshot sizes on the detail sheet. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
