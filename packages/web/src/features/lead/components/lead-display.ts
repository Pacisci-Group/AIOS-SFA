import type { LeadTemperature } from "@sfa/shared";

/**
 * Shared display vocabulary for the Leads list — the desktop table and the
 * mobile card render the same badges, so the class maps live in one place.
 *
 * Colours use Tailwind's default palette (which matches the mockup accents) and
 * theme tokens, never hard-coded hex.
 */

/** Temperature dot colour — legacy showed a dot + label rather than a pill. */
export const temperatureDot: Record<LeadTemperature, string> = {
  Hot: "bg-amber-500",
  Warm: "bg-sky-400",
  Cold: "bg-slate-400",
  Unknown: "bg-slate-600",
};

export const temperatureText: Record<LeadTemperature, string> = {
  Hot: "text-amber-500",
  Warm: "text-sky-400",
  Cold: "text-slate-400",
  Unknown: "text-slate-600",
};

/**
 * Status pill styling. Keyed by canonical label (the API never returns a raw
 * code); anything uncatalogued falls back to the neutral treatment.
 */
const statusStyles: Record<string, string> = {
  New: "bg-sky-400/12 text-sky-400",
  Contacted: "bg-primary/12 text-primary",
  Qualified: "bg-primary/12 text-primary",
  Quoted: "bg-indigo-400/12 text-indigo-400",
  Requote: "bg-indigo-400/12 text-indigo-400",
  Sold: "bg-emerald-500/12 text-emerald-500",
  Converted: "bg-emerald-500/12 text-emerald-500",
  "Not Qualified": "bg-amber-500/15 text-amber-500",
  Lost: "bg-amber-500/15 text-amber-500",
  Closed: "bg-slate-500/12 text-slate-400",
};

export function statusBadgeClass(status: string): string {
  return statusStyles[status] ?? "bg-slate-500/12 text-slate-400";
}
