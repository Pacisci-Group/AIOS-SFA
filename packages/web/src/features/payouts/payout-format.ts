import type {
  ChargebackReason,
  ChargebackSource,
  ComplianceStatus,
  PayoutPool,
  PayStatementStatus,
  PremiumLineView,
  SomStatus,
  StatementRateSource,
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

/** "Allstate · JYA leads" for a lead-source line, else the carrier. */
export function premiumLineLabel(line: PremiumLineView): string {
  return line.leadSourceName
    ? `${line.carrier} · ${line.leadSourceName} leads`
    : line.carrier;
}

/** Where a chargeback came from, in the words the epic uses. */
export function chargebackSourceLabel(row: {
  reason: ChargebackReason;
  source: ChargebackSource;
}): string {
  const source: string = row.source;
  const reason: string = row.reason;
  if (source === "carrier_statement") return "Carrier report";
  if (reason === "manual") return "Manual";
  if (reason === "cancel_rewrite") return "Cancel Rewrite";
  if (reason === "cancellation") return "Cancellation";
  return reason;
}

export const SOM_LABELS: Record<SomStatus, string> = {
  winner: "Winner",
  none: "Not this month",
  off: NOT_AVAILABLE,
};

export function complianceLabel(
  status: ComplianceStatus,
  failedAudits: number,
): string {
  if (status === "compliant") return "Compliant";
  return `${failedAudits} failed audit${failedAudits === 1 ? "" : "s"}`;
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

/** A statement's short reference: the id's last six characters. */
export function statementReference(id: string, version: number): string {
  return `${id.slice(-6).toUpperCase()} · v${version}`;
}

/** A deduction shown as a negative amount; never "-$0". */
export function deduction(amount: number): number {
  return amount === 0 ? 0 : -amount;
}
