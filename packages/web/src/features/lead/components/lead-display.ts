import type { ActivityType, LeadTemperature } from "@sfa/shared";
import {
  CheckCircle2,
  FileText,
  MessageSquare,
  PenLine,
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
 *
 * ## Why every foreground here is a `X-600 dark:X-400` pair
 *
 * This file is the app's one sanctioned exception to "tokens only" — these hues
 * *are* the product's semantic vocabulary and there is no token for "warm lead".
 * The exception does not extend to ignoring the light theme.
 *
 * The mockup's values were picked against the navy background and every one of
 * them fails on `#F8FAFC`: `sky-400` is ~1.9:1 on white, `amber-500` ~2.0:1,
 * `emerald-500` ~2.5:1 — unreadable, not merely low-contrast. The 600 weights
 * clear 4.5:1 on white, and the `dark:` half pins the original rendering so the
 * navy theme is byte-identical to what shipped. Same precedent as
 * `components/form/FormError.tsx`.
 *
 * The `/12` and `/15` background tints need no pair: an alpha wash of the same
 * hue reads correctly over either surface.
 */

/**
 * Temperature dot colour — legacy showed a dot + label rather than a pill.
 *
 * Backgrounds, not text, so these only need to be *visible*: the light-side
 * values are one step darker where the mockup value would disappear into a
 * white row.
 */
export const temperatureDot: Record<LeadTemperature, string> = {
  Hot: "bg-amber-500",
  Warm: "bg-sky-500 dark:bg-sky-400",
  Cold: "bg-slate-400",
  Unknown: "bg-slate-300 dark:bg-slate-600",
};

export const temperatureText: Record<LeadTemperature, string> = {
  Hot: "text-amber-600 dark:text-amber-500",
  Warm: "text-sky-600 dark:text-sky-400",
  Cold: "text-slate-500 dark:text-slate-400",
  // The dimmest of the four by design. `--muted-foreground` is the one colour
  // the theme guarantees on both surfaces, which is exactly what "we don't know"
  // wants — `slate-600` was invisible on navy and near-black on white.
  Unknown: "text-muted-foreground",
};

/**
 * Status pill styling. Keyed by canonical label (the API never returns a raw
 * code); anything uncatalogued falls back to the neutral treatment.
 */
const statusStyles: Record<string, string> = {
  New: "bg-sky-400/12 text-sky-600 dark:text-sky-400",
  Contacted: "bg-primary/12 text-primary",
  Qualified: "bg-primary/12 text-primary",
  Quoted: "bg-indigo-400/12 text-indigo-600 dark:text-indigo-400",
  Requote: "bg-indigo-400/12 text-indigo-600 dark:text-indigo-400",
  Sold: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-500",
  Converted: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-500",
  "Not Qualified": "bg-amber-500/15 text-amber-700 dark:text-amber-500",
  Lost: "bg-amber-500/15 text-amber-700 dark:text-amber-500",
  Closed: "bg-slate-500/12 text-slate-600 dark:text-slate-400",
};

export function statusBadgeClass(status: string): string {
  return (
    statusStyles[status] ?? "bg-slate-500/12 text-slate-600 dark:text-slate-400"
  );
}

/**
 * The foreground half of {@link statusBadgeClass}, with no background tint.
 *
 * For the inside of a control that already carries the tint — a `SelectItem`
 * whose content Radix mirrors into the trigger. Rendering a full pill there
 * gives you a pill drawn inside a pill on the trigger; rendering nothing gives
 * you a menu with no colour coding at all. The text alone is the one treatment
 * that reads correctly in both places.
 */
export function statusTextClass(status: string): string {
  const style = statusStyles[status];
  if (!style) return "text-slate-600 dark:text-slate-400";
  return style
    .split(" ")
    .filter((token) => !token.startsWith("bg-"))
    .join(" ");
}

/* ── Lead Detail (PAC-38) ─────────────────────────────────────────────────── */

/**
 * Timeline icon + tint per activity type.
 *
 * Every `ACTIVITY_TYPES` member is mapped. `lead_created`, `quoted`, `sold` and
 * `audit_resolved` are written by their own pipelines; `call`, `text`, `email`
 * and `note` are written by clients through `POST /activities` (PAC-16); and
 * `field_changed` is the quote/sold edit log (PAC-65 #9). The map stays
 * exhaustive because an unmapped type would render as a blank circle rather
 * than fail loudly — the `Record<ActivityType, …>` is what turns a new union
 * member into a compile error here.
 */
export const activityDisplay: Record<
  ActivityType,
  { icon: LucideIcon; tone: string; tint: string }
> = {
  lead_created: {
    icon: Sparkles,
    tone: "text-sky-600 dark:text-sky-400",
    tint: "bg-sky-400/12",
  },
  quoted: {
    icon: FileText,
    tone: "text-indigo-600 dark:text-indigo-400",
    tint: "bg-indigo-400/12",
  },
  sold: {
    icon: CheckCircle2,
    tone: "text-emerald-700 dark:text-emerald-500",
    tint: "bg-emerald-500/12",
  },
  audit_resolved: {
    icon: CheckCircle2,
    tone: "text-emerald-700 dark:text-emerald-500",
    tint: "bg-emerald-500/12",
  },
  call: {
    icon: Phone,
    tone: "text-sky-600 dark:text-sky-400",
    tint: "bg-sky-400/12",
  },
  text: {
    icon: MessageSquare,
    tone: "text-sky-600 dark:text-sky-400",
    tint: "bg-sky-400/12",
  },
  email: {
    icon: Send,
    tone: "text-violet-600 dark:text-violet-400",
    tint: "bg-violet-400/12",
  },
  note: {
    icon: MessageSquare,
    tone: "text-amber-600 dark:text-amber-500",
    tint: "bg-amber-500/15",
  },
  /*
   * The quote/sold edit log (PAC-65 #9). Deliberately the quietest row on the
   * timeline — slate rather than a brand hue — because an edit is a record of
   * housekeeping, not a milestone, and only owners and managers ever see it.
   */
  field_changed: {
    icon: PenLine,
    tone: "text-slate-600 dark:text-slate-400",
    tint: "bg-slate-400/12",
  },
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
  field_changed: "Record edited",
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
 * Currency to the cent — for the edit log only (PAC-65 #9).
 *
 * {@link formatCurrency} rounds to whole dollars, which is right everywhere it
 * is used and wrong here: a change row exists precisely to say a value moved,
 * and `900 → 900.40` rendered through it reads `$900 → $900` — an audit entry
 * asserting that nothing happened. Cents are shown only when there are any, so
 * the common whole-dollar correction still reads as `$1,200 → $1,400`.
 */
export function formatCurrencyExact(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
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
