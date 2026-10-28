import {
  RECONCILIATION_ISSUE_LABELS,
  type ReconciliationIssue,
  type ReconciliationReviewStatus,
  type ReconciliationRowView,
  type ReconciliationRunView,
} from "@sfa/shared";
import { ApiError } from "@/lib/api-client";
import { NOT_AVAILABLE } from "@/lib/not-available";

const CURRENCY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const CURRENCY_CENTS = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const CURRENCY_DELTA = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  signDisplay: "exceptZero",
});

/** `$19,232` — whole dollars for totals. */
export function formatMoney(value: number | null | undefined): string {
  return value == null ? NOT_AVAILABLE : CURRENCY.format(value);
}

/** `$1,886.15` — a single policy's premium, as Dash prints it. */
export function formatPremium(value: number | null | undefined): string {
  return value == null ? NOT_AVAILABLE : CURRENCY_CENTS.format(value);
}

/** `+$12.40` / `-$0.01` — how far the app's premium is from Dash's, signed. */
export function formatPremiumDelta(value: number | null | undefined): string {
  return value == null ? NOT_AVAILABLE : CURRENCY_DELTA.format(value);
}

export function formatCount(value: number | null | undefined): string {
  return value == null ? NOT_AVAILABLE : value.toLocaleString("en-US");
}

/** `88.9%` from a 0–1 rate. */
export function formatRate(value: number | null | undefined): string {
  return value == null ? NOT_AVAILABLE : `${(value * 100).toFixed(1)}%`;
}

const DAY = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/** A calendar date (`YYYY-MM-DD`) as `Sep 15, 2026` — read in UTC, so it never shifts. */
export function formatDay(day: string | null | undefined): string {
  if (!day) return NOT_AVAILABLE;
  const at = Date.parse(`${day}T00:00:00Z`);
  return Number.isNaN(at) ? NOT_AVAILABLE : DAY.format(at);
}

const INSTANT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function formatInstant(iso: string | null | undefined): string {
  if (!iso) return NOT_AVAILABLE;
  const at = Date.parse(iso);
  return Number.isNaN(at) ? NOT_AVAILABLE : INSTANT.format(at);
}

/** `Jul 1 – Sep 30, 2026`. */
export function formatPeriod(run: Pick<ReconciliationRunView, "fileMeta">): string {
  return formatDayRange(run.fileMeta.startDate, run.fileMeta.endDate);
}

/** {@link formatPeriod} from the two dates alone — an assigned row carries no `fileMeta`. */
export function formatDayRange(
  startDate: string | null | undefined,
  endDate: string | null | undefined,
): string {
  if (!startDate || !endDate) return "Period unknown";
  const sameYear = startDate.slice(0, 4) === endDate.slice(0, 4);
  const from = Date.parse(`${startDate}T00:00:00Z`);
  const start = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  }).format(from);
  return `${start} – ${formatDay(endDate)}`;
}

/** Issues worth a pill in the table; the rest show in the drawer. */
const HEADLINE_ISSUES: readonly ReconciliationIssue[] = [
  "direct_recorded_as_sale",
  "not_staff_bind_id",
  "producer_mismatch",
  "premium_mismatch",
  "number_format",
  "missing_policy_number",
  "duplicate_in_app",
  "duplicate_in_dash",
  "outside_window",
  "direct_channel",
  "no_bind_id",
];

export function headlineIssues(row: ReconciliationRowView): ReconciliationIssue[] {
  return HEADLINE_ISSUES.filter((issue) => row.issues.includes(issue));
}

/** Short pill text; the full label is the pill's tooltip. */
export const ISSUE_SHORT_LABELS: Record<ReconciliationIssue, string> = {
  not_staff_bind_id: "Non-staff Bind ID",
  former_staff_bind_id: "Named, not on a user",
  no_bind_id: "No Bind ID",
  direct_channel: "1-800 / web",
  direct_recorded_as_sale: "1-800 on a sale",
  premium_mismatch: "Premium differs",
  item_count_mismatch: "Items differ",
  producer_mismatch: "Credit differs",
  unmapped_producer: "Code not on staff",
  no_app_producer: "No app producer",
  number_format: "Check number",
  missing_policy_number: "No number",
  outside_window: "Other month",
  duplicate_in_dash: "Repeated in Dash",
  duplicate_in_app: "Repeated in app",
};

export function issueLabel(issue: ReconciliationIssue): string {
  return RECONCILIATION_ISSUE_LABELS[issue];
}

export const REVIEW_BADGE: Record<
  ReconciliationReviewStatus,
  "outline" | "success" | "secondary"
> = {
  open: "outline",
  resolved: "success",
  dismissed: "secondary",
};

/** The policy number a row is known by — Dash's, else the app's. */
export function rowPolicyNumber(row: ReconciliationRowView): string {
  return row.dash?.policyNumber ?? row.app?.policyNumber ?? NOT_AVAILABLE;
}

/** The person on the row — Dash's customer, else the app's client. */
export function rowCustomer(row: ReconciliationRowView): string {
  return row.dash?.customerName ?? row.app?.clientName ?? NOT_AVAILABLE;
}

/** Who the row belongs to: who Dash credits, else the app's producer. */
export function rowProducer(row: ReconciliationRowView): string {
  return (
    row.credit.userName ??
    row.credit.name ??
    row.app?.producerName ??
    NOT_AVAILABLE
  );
}

/** A message for a failed request: the API's own words when it sent some. */
export function apiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    const body = error.body as { message?: unknown } | undefined;
    if (typeof body?.message === "string") return body.message;
  }
  return fallback;
}

/** The HTTP status a failed request came back with; `null` if it never got one. */
export function apiErrorStatus(error: unknown): number | null {
  return error instanceof ApiError ? error.status : null;
}

/** The structured refusal code an API error carries, if any. */
export function apiErrorCode(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  const code = (error.body as { code?: unknown } | undefined)?.code;
  return typeof code === "string" ? code : null;
}
