import type {
  MailerCampaignAssignment,
  MailerCampaignStatus,
} from "@sfa/shared";

/**
 * Display helpers shared by the campaigns list, the run wizard and the detail
 * page (PAC-71).
 *
 * They live together because all three render the same numbers, and a second
 * copy of "how a floor is written" is how a stat on the detail page starts
 * disagreeing with the one on the list.
 */

/** The badge copy for each lifecycle state. Sentence case, never the raw enum. */
export const CAMPAIGN_STATUS_LABELS: Record<MailerCampaignStatus, string> = {
  uploaded: "Reading file",
  previewed: "Ready to commit",
  processing: "Importing",
  imported: "Imported",
  failed: "Failed",
  superseded: "Superseded",
};

/** The order the status filter offers them in — lifecycle, not alphabetical. */
export const CAMPAIGN_STATUSES: MailerCampaignStatus[] = [
  "uploaded",
  "previewed",
  "processing",
  "imported",
  "failed",
  "superseded",
];

export const ASSIGNMENT_MODE_LABELS: Record<
  MailerCampaignAssignment["mode"],
  string
> = {
  carrier_agency_id: "By carrier agency ID",
  agencies: "Specific agencies",
  all: "All agencies",
};

/**
 * ~23 MB is a normal vendor file, but a trimmed test slice is a few KB — and
 * fixed MB renders those as "0.0 MB", which reads as a failed upload rather than
 * a small file.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatCount(value: number | null | undefined): string {
  return value == null ? "—" : value.toLocaleString();
}

/** Money as the offer is written: two decimals, thousands separated. */
export function formatMoney(value: number | null | undefined): string {
  if (value == null) return "—";
  return value.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * A 0–1 rate as a percentage.
 *
 * One decimal, because the floor hit rate sits around 95% and the interesting
 * movement between two runs is a fraction of a point.
 */
export function formatRate(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

/** An ISO date (or datetime) as a plain local date. Never a time. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

/**
 * Who a campaign reaches, in one line.
 *
 * `null` is **"All agencies"**, not "none" — the distinction the whole
 * visibility model turns on, so it is spelled rather than left to an empty list
 * rendering as a blank cell.
 */
export function describeAudience(names: string[] | null): string {
  if (names === null) return "All agencies";
  if (names.length === 0) return "Unassigned";
  return names.join(", ");
}

/** `Week_Number-36` → `Week 36`; anything else is passed through as-is. */
export function formatCampaignNumber(
  campaignNumber: string | null | undefined,
): string {
  if (!campaignNumber) return "—";
  const match = /^Week_Number-(\d+)$/i.exec(campaignNumber);
  return match ? `Week ${Number(match[1])}` : campaignNumber;
}
