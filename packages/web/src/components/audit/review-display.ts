import {
  DEAL_AUDIT_QUEUE_STATUSES,
  DEAL_AUDIT_QUEUE_STATUS_LABELS,
} from "@sfa/shared";
import type { DealAuditQueueStatus, DealAuditStatus } from "@sfa/shared";

/**
 * How a deal audit's state looks, wherever it is shown (PAC-106).
 *
 * Lifted out of `AuditWorkflowPanel`, which hand-wrote raw palette values
 * (`text-sky-400`, `text-amber-500`) that only read on the navy theme. These
 * follow the `lead-display.ts` rules: a token where one carries the meaning,
 * otherwise an `X-600 dark:X-400` pair over an alpha tint.
 *
 * **Sent back is red, not amber.** Amber is this app's "needs attention" hue
 * (open items, the soft deadline); a sent-back audit is a different fact — a
 * manager looked and said no — and B10 asks for it to stand out on the
 * producer's board. Red is the pair `policy-display.ts` already uses for a
 * policy that is off the books.
 */
export const AUDIT_STATUS_STYLES: Record<DealAuditStatus, string> = {
  "Not Submitted": "bg-muted text-muted-foreground",
  Pending: "bg-sky-400/12 text-sky-600 dark:text-sky-400",
  Pass: "bg-success/12 text-success",
  Fail: "bg-red-500/12 text-red-600 dark:text-red-400",
};

/** The manager's words for each state; the stored values are SmartSuite's. */
export const AUDIT_STATUS_LABELS: Record<DealAuditStatus, string> = {
  "Not Submitted": "Not submitted",
  Pending: "Ready for review",
  Pass: "Approved",
  Fail: "Sent back",
};

/** The red pair for a failed item or a sent-back marker. */
export const SENT_BACK_TEXT = "text-red-600 dark:text-red-400";
export const SENT_BACK_SURFACE = "border-red-500/30 bg-red-500/8";

/** The queue's status chips, in the order the shared vocabulary lists them. */
export const QUEUE_STATUS_OPTIONS: readonly {
  value: DealAuditQueueStatus;
  label: string;
}[] = DEAL_AUDIT_QUEUE_STATUSES.map((value) => ({
  value,
  label: DEAL_AUDIT_QUEUE_STATUS_LABELS[value],
}));

/** What waits on whom, for an audit the manager cannot act on yet. */
export function waitingHint(status: DealAuditStatus): string | null {
  switch (status) {
    case "Not Submitted":
      return "Waiting for the producer to submit";
    case "Fail":
      return "Sent back — waiting for the producer";
    default:
      return null;
  }
}

/** "3 business days" / "1 business day". */
export function businessDaysLabel(days: number): string {
  return `${days} business day${days === 1 ? "" : "s"}`;
}
