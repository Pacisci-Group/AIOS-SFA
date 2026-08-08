import type { ActivityType, LeadTemperature } from "@sfa/shared";
import {
  CheckCircle2,
  FileText,
  MessageSquare,
  Phone,
  Send,
  Settings,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import {
  formatAddress as formatAddressLine,
  type AddressLike,
} from "@/lib/format-address";

/**
 * Shared display vocabulary for the Leads list and the Lead Detail page — the
 * desktop table, the mobile card and the detail header all render the same
 * badges, so the class maps live in one place.
 *
 * Colours use Tailwind's default palette (which matches the mockup accents) and
 * theme tokens, never hard-coded hex.
 *
 * Note the mockup's own `var(--sky)` / `--coral` / `--emerald` / `--amber` are
 * **not** defined in `styles/theme.css` and never were — anything styled with
 * them renders with no colour at all. Use these maps instead of reintroducing
 * them.
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

/* ── Lead Detail (PAC-38) ─────────────────────────────────────────────────── */

/**
 * Timeline icon + tint per activity type.
 *
 * All eight `ACTIVITY_TYPES` are mapped. `lead_created`, `quoted`, `sold` and
 * `audit_resolved` are written by their own pipelines; `call`, `text`, `email`
 * and `note` are written by clients through `POST /activities` (PAC-16). The
 * map stays exhaustive because an unmapped type would render as a blank circle
 * rather than fail loudly.
 */
export const activityDisplay: Record<
  ActivityType,
  { icon: LucideIcon; tone: string; tint: string }
> = {
  lead_created: { icon: Sparkles, tone: "text-sky-400", tint: "bg-sky-400/12" },
  quoted: { icon: FileText, tone: "text-indigo-400", tint: "bg-indigo-400/12" },
  sold: {
    icon: CheckCircle2,
    tone: "text-emerald-500",
    tint: "bg-emerald-500/12",
  },
  audit_resolved: {
    icon: CheckCircle2,
    tone: "text-emerald-500",
    tint: "bg-emerald-500/12",
  },
  call: { icon: Phone, tone: "text-sky-400", tint: "bg-sky-400/12" },
  text: { icon: MessageSquare, tone: "text-sky-400", tint: "bg-sky-400/12" },
  email: { icon: Send, tone: "text-violet-400", tint: "bg-violet-400/12" },
  note: { icon: MessageSquare, tone: "text-amber-500", tint: "bg-amber-500/15" },
};

/** Human label for an activity type, used when a row carries no `summary`. */
export const activityLabel: Record<ActivityType, string> = {
  lead_created: "Lead created",
  quoted: "Quote recap created",
  sold: "Marked as sold",
  audit_resolved: "Hand-off item resolved",
  call: "Call logged",
  text: "Text logged",
  email: "Email logged",
  note: "Note added",
};

/** Up to two initials for an avatar; `?` when there is no name to work with. */
export function initials(name: string | null): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return parts
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

/**
 * `MM/DD/YYYY` from either a date-only string or an ISO instant.
 *
 * A date-only value is split by hand rather than passed through `new Date()`:
 * `new Date('1978-04-12')` is parsed as UTC midnight and then rendered in local
 * time, which shows the 11th for anyone west of Greenwich. Dates of birth are
 * the field where that is most obviously wrong.
 */
export function formatDate(value: string | null): string {
  if (!value) return "—";

  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    return `${month}/${day}/${year}`;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleDateString("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

/** Whole-dollar currency — premiums are quoted to the dollar, not the cent. */
export function formatCurrency(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

/**
 * `4821 Maple Grove Dr, Austin TX 78745`, or an em-dash when there is nothing
 * to show.
 *
 * A thin wrapper over the shared {@link formatAddressLine}, which returns `null`
 * instead: the label/value grids on this page always render a value, so the
 * placeholder belongs here rather than at every call site.
 */
export function formatAddress(address: AddressLike | null): string {
  return formatAddressLine(address) ?? "—";
}
