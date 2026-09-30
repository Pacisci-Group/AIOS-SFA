import { NOT_AVAILABLE } from "@/lib/not-available";

/**
 * `2h ago` / `3d ago` — how long ago an ISO timestamp was.
 *
 * Lived inside `HotLeadRow` until the Command Center's unclaimed pool (PAC-138)
 * needed the same phrasing for how long a lead has sat waiting. Two copies
 * would drift on the first change to a threshold, and "3d ago" has to mean the
 * same thing on both screens or the two pages disagree about the same lead.
 *
 * Coarse on purpose: months are 30 days and everything rounds. This answers
 * "how stale is this?", which is a glance, not an arithmetic claim — use a real
 * date whenever the exact day matters.
 *
 * `fallback` is what an absent timestamp reads as, because the two callers mean
 * different things by it: a lead nobody has ever touched has been touched
 * "never", while a lead with no arrival date is simply missing one.
 */
export function relativeTime(
  iso: string | null,
  fallback: string = NOT_AVAILABLE,
): string {
  if (!iso) return fallback;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return fallback;

  // Clamped at zero: a clock skew between the server and the browser should
  // read as "just now", never as a negative age.
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.round(days / 30)}mo ago`;
}
