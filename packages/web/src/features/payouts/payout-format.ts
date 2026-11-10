import {
  CHARGEBACK_REASON_LABELS,
  SOM_STATUSES,
  somStatusLabel,
  type ChargebackReason,
  type ChargebackSource,
  type PayoutPool,
  type PayStatementStatus,
  type SomStatus,
  type StatementRateSource,
} from "@sfa/shared";
import { NOT_AVAILABLE } from "@/lib/not-available";

/**
 * Words and colours for the statement pages (PAC-178). Status colours follow
 * the `policy-display.ts` idiom: a token where one fits, else an
 * `X-600 dark:X-400` pair over a light tint, so light and dark both read.
 */

export const STATEMENT_STATUS_LABELS: Record<PayStatementStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  rejected: "Disputed",
};

export const STATEMENT_STATUS_CLASSES: Record<PayStatementStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  sent: "bg-primary/12 text-primary",
  accepted: "bg-success/12 text-success",
  rejected: "bg-amber-500/15 text-amber-700 dark:text-amber-500",
};

export const POOL_LABELS: Record<PayoutPool, string> = {
  csr: "CSR",
  producer: "Producer",
};

export const RATE_SOURCE_LABELS: Record<StatementRateSource, string> = {
  lead_source_carrier: "Lead-source rate",
  lead_source: "Lead-source rate, any carrier",
  carrier: "Carrier rate",
  any: "Any other carrier",
  none: "No rate",
};

// The words the page and the PDF share (PAC-181) live in `@sfa/shared`.
export {
  complianceLabel,
  premiumLineLabel,
  statementReference,
} from "@sfa/shared";

/**
 * Where a chargeback came from — the ledger's own labels, so the statement
 * and the rest of the app name a reason the same way. A row read off the
 * chargeback report is "Carrier report" whatever its reason.
 */
export function chargebackSourceLabel(row: {
  reason: ChargebackReason;
  source: ChargebackSource;
}): string {
  return row.source === "carrier_statement"
    ? CHARGEBACK_REASON_LABELS.carrier_statement
    : CHARGEBACK_REASON_LABELS[row.reason];
}

export const SOM_LABELS = Object.fromEntries(
  SOM_STATUSES.map((status) => [
    status,
    somStatusLabel(status) ?? NOT_AVAILABLE,
  ]),
) as Record<SomStatus, string>;

/** "Yes", "No" or "Not entered" — the manager's meeting-attendance tick. */
export function attendanceLabel(value: boolean | null): string {
  return value === null ? "Not entered" : value ? "Yes" : "No";
}

/** "Mar 31, 2026" for an agency day (`YYYY-MM-DD`). */
export function formatDay(ymd: string | null | undefined): string {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return NOT_AVAILABLE;
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "Nov 6, 2026", on the agency's calendar. */
export function formatInstantDay(
  iso: string | null | undefined,
  timeZone?: string,
): string {
  if (!iso) return NOT_AVAILABLE;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone,
  });
}

/** A deduction shown as a negative amount; never "-$0". */
export function deduction(amount: number): number {
  return amount === 0 ? 0 : -amount;
}
