import {
  AlertCircle,
  ArrowLeftRight,
  CreditCard,
  FileCheck,
  FileSignature,
  FileText,
  MessageSquare,
  RefreshCw,
  ShieldCheck,
  ShieldX,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import type {
  ServiceTicketActivity,
  ServiceTicketCategory,
  ServiceTicketPriority,
  ServiceTicketStatus,
  ServiceTicketView,
} from "@sfa/shared";

/**
 * The ticket workspace now renders live data from the CRM Service API. These
 * aliases keep the component prop types stable while pointing at the shared
 * domain types (source of truth in `@sfa/shared`).
 */
export type Ticket = ServiceTicketView;
export type TimelineEntry = ServiceTicketActivity;
export type TicketStatus = ServiceTicketStatus;
export type TicketCategory = ServiceTicketCategory;
export type Priority = ServiceTicketPriority;

/**
 * Shared display vocabulary for the CRM Service surfaces — the ticket feed, the
 * ticket workspace, the service-dashboard queue and the household activity
 * column all render the same pills and glyphs, so the class maps live here.
 *
 * ## Why these are Tailwind pairs and not `--kpi-*`
 *
 * Every map below used to read `var(--kpi-blue)` / `var(--kpi-amber-bg)` and so
 * on. Those four hues (plus their tints) were declared **only inside `.dark`**
 * in `styles/theme.css`, so on the light theme every one of them resolved to
 * nothing: status dots vanished, the selected ticket lost its highlight, and
 * "Post Note" rendered as white-on-transparent. They are gone from `theme.css`
 * now; nothing should reintroduce them.
 *
 * This file is the CRM Service twin of `features/lead/components/lead-display.ts`
 * and follows its rules exactly (see the long note there):
 *
 * - Prefer a **token** where one carries the meaning. `--primary` is the app's
 *   accent, `--success` the brand emerald, and `--destructive` is amber in this
 *   app — which is precisely the "needs attention" hue the mockup used for
 *   overdue, so overdue is `destructive` rather than a raw amber.
 * - Where no token exists, use a `X-600 dark:X-400` **pair**. The mockup's
 *   values were chosen against navy and fail on `#F8FAFC` (`red-400` is ~2.5:1
 *   on white, `slate-300` ~1.4:1). The `dark:` half pins the navy rendering to
 *   what shipped.
 * - `/12` and `/15` alpha tints need no pair — a wash of the same hue reads
 *   correctly over either surface.
 */

/**
 * Presentation for each ticket status. Shared so the status picker looks and
 * behaves the same wherever it appears (ticket workspace header, service
 * dashboard queue rows, household activity feed).
 *
 * ## Why every `bg` repeats itself under `dark:`
 *
 * These tints land on `SelectTrigger` (`TicketStatusSelect`), whose own base
 * `cva` carries `dark:bg-input/30`. `cn` is tailwind-merge, which resolves
 * conflicts per *modifier set*: an unmodified `bg-primary/12` of ours does not
 * displace their `dark:bg-input/30`, so both survive into the class list — and
 * the dark one wins, because `.dark\:bg-input\/30:is(.dark *)` is specificity
 * (0,2,0) against our (0,1,0). The pill then renders as a neutral chip on the
 * navy theme, which is the app's default.
 *
 * Naming the `dark:` twin makes tailwind-merge *delete* the primitive's, so the
 * tint lands on both themes with no specificity race at all.
 *
 * ⚠ It has to be written out, not derived. Tailwind scans source text for
 * literal class names, so a helper returning `` `dark:${token}` `` generates no
 * CSS — the class is simply absent from the stylesheet. (That is exactly how the
 * first attempt at this failed, silently.)
 */
export const TICKET_STATUS_CONFIG: Record<
  TicketStatus,
  { label: string; bg: string; text: string; dot: string }
> = {
  open: {
    label: "Open",
    bg: "bg-primary/12 dark:bg-primary/12",
    text: "text-primary",
    dot: "bg-primary",
  },
  waiting: {
    label: "Waiting",
    bg: "bg-violet-400/12 dark:bg-violet-400/12",
    text: "text-violet-600 dark:text-violet-400",
    dot: "bg-violet-500 dark:bg-violet-400",
  },
  resolved: {
    label: "Resolved",
    bg: "bg-success/12 dark:bg-success/12",
    text: "text-success",
    dot: "bg-success",
  },
  overdue: {
    label: "Overdue",
    bg: "bg-destructive/12 dark:bg-destructive/12",
    text: "text-destructive",
    dot: "bg-destructive",
  },
  // Statuses a ticket can be opened with from the create form. They render
  // wherever a ticket is shown even though the status pickers don't offer them.
  in_progress: {
    label: "In Progress",
    bg: "bg-primary/12 dark:bg-primary/12",
    text: "text-primary",
    dot: "bg-primary",
  },
  waiting_on_client: {
    label: "Waiting on Client",
    bg: "bg-violet-400/12 dark:bg-violet-400/12",
    text: "text-violet-600 dark:text-violet-400",
    dot: "bg-violet-500 dark:bg-violet-400",
  },
  waiting_on_carrier: {
    label: "Waiting on Carrier",
    bg: "bg-violet-400/12 dark:bg-violet-400/12",
    text: "text-violet-600 dark:text-violet-400",
    dot: "bg-violet-500 dark:bg-violet-400",
  },
  closed: {
    label: "Closed",
    bg: "bg-muted dark:bg-muted",
    text: "text-muted-foreground",
    dot: "bg-muted-foreground",
  },
};

/**
 * Priority pill tint.
 *
 * Red rather than `--destructive` (which is amber here): high priority and
 * overdue are different claims, and a CSR scanning the feed has to be able to
 * tell "this is urgent by nature" from "this has been sitting too long".
 */
export const TICKET_PRIORITY_CLASS: Record<Priority, string> = {
  high: "bg-red-500/12 text-red-600 dark:text-red-400",
  medium: "bg-amber-500/15 text-amber-700 dark:text-amber-500",
  low: "bg-slate-500/12 text-slate-600 dark:text-slate-400",
};

/**
 * Icon and accent per ticket category, carried over from the mockup's activity
 * types. Categories that mean the same thing to a reader — a payment and a
 * billing question, an endorsement and a policy change — share an accent.
 *
 * Exhaustive by design: `Record<ServiceTicketCategory, …>` is what turns a new
 * category into a compile error here rather than a colourless row at runtime.
 */
export const TICKET_CATEGORY_DISPLAY: Record<
  ServiceTicketCategory,
  { icon: LucideIcon; tone: string; tint: string }
> = {
  Onboarding: { icon: UserPlus, tone: "text-primary", tint: "bg-primary/12" },
  Endorsement: {
    icon: FileSignature,
    tone: "text-cyan-600 dark:text-cyan-400",
    tint: "bg-cyan-400/12",
  },
  "Policy Change": {
    icon: FileSignature,
    tone: "text-cyan-600 dark:text-cyan-400",
    tint: "bg-cyan-400/12",
  },
  Billing: { icon: CreditCard, tone: "text-success", tint: "bg-success/12" },
  Payment: { icon: CreditCard, tone: "text-success", tint: "bg-success/12" },
  "Claims Assist": {
    icon: FileCheck,
    tone: "text-red-600 dark:text-red-400",
    tint: "bg-red-500/12",
  },
  "Renewal Review": {
    icon: RefreshCw,
    tone: "text-amber-600 dark:text-amber-500",
    tint: "bg-amber-500/15",
  },
  "Renewal Taken": {
    icon: ShieldCheck,
    tone: "text-amber-600 dark:text-amber-500",
    tint: "bg-amber-500/15",
  },
  "Company Transfer": {
    icon: ArrowLeftRight,
    tone: "text-violet-600 dark:text-violet-400",
    tint: "bg-violet-400/12",
  },
  Save: { icon: ShieldCheck, tone: "text-success", tint: "bg-success/12" },
  Termination: {
    icon: ShieldX,
    tone: "text-red-600 dark:text-red-400",
    tint: "bg-red-500/12",
  },
  // Violet, matching the "Start Quote" quick action this ticket comes from.
  Quote: {
    icon: FileText,
    tone: "text-violet-600 dark:text-violet-400",
    tint: "bg-violet-400/12",
  },
  Other: {
    icon: MessageSquare,
    tone: "text-slate-600 dark:text-slate-400",
    tint: "bg-slate-400/12",
  },
};

/** For a category the API invented after this map was written. */
export const TICKET_CATEGORY_FALLBACK = {
  icon: AlertCircle,
  tone: "text-amber-600 dark:text-amber-500",
  tint: "bg-amber-500/15",
};

export function categoryDisplay(category: ServiceTicketCategory) {
  return TICKET_CATEGORY_DISPLAY[category] ?? TICKET_CATEGORY_FALLBACK;
}

/**
 * Abbreviations for the narrow feed rows; anything unlisted falls back to the
 * full name.
 */
export const CATEGORY_SHORT: Record<string, string> = {
  "Renewal Review": "Renewal",
  "Renewal Taken": "Renewal Taken",
  "Claims Assist": "Claims",
  "Policy Change": "Pol. Change",
  "Company Transfer": "Transfer",
  Endorsement: "Endorse",
  Onboarding: "Onboard",
};
