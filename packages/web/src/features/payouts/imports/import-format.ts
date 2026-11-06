import type {
  ChargebackImportStatus,
  ImportMatchSignal,
  ImportRecalculationOutcome,
  ImportRowResolution,
} from "@sfa/shared";

/**
 * Words and colours for the chargeback report import (PAC-180). Colours follow
 * `payout-format.ts`: a token where one fits, else an `X-600 dark:X-400` pair
 * over a light tint, so light and dark both read.
 */

export const IMPORT_STATUS_LABELS: Record<ChargebackImportStatus, string> = {
  preview: "In preview",
  committed: "Committed",
  discarded: "Discarded",
};

export const IMPORT_STATUS_CLASSES: Record<ChargebackImportStatus, string> = {
  preview: "bg-primary/12 text-primary",
  committed: "bg-success/12 text-success",
  discarded: "bg-muted text-muted-foreground",
};

export const RESOLUTION_LABELS: Record<ImportRowResolution, string> = {
  matched: "Matched",
  assigned: "Assigned",
  unmatched: "Needs a person",
  skipped: "Skipped",
  duplicate: "Duplicate",
};

export const RESOLUTION_CLASSES: Record<ImportRowResolution, string> = {
  matched: "bg-success/12 text-success",
  assigned: "bg-primary/12 text-primary",
  unmatched: "bg-amber-500/15 text-amber-700 dark:text-amber-500",
  skipped: "bg-muted text-muted-foreground",
  duplicate: "bg-muted text-muted-foreground",
};

export const SIGNAL_LABELS: Record<ImportMatchSignal, string> = {
  sok: "SOK number",
  name: "Named in the file",
  policy: "Sold the policy",
};

/** The `?show=` filter of the preview page. */
export const ROW_FILTERS = [
  { value: "", label: "Every line" },
  { value: "attention", label: "Needs a person" },
  { value: "duplicate", label: "Duplicates" },
  { value: "skipped", label: "Skipped" },
  { value: "charged", label: "To charge" },
] as const;
export type RowFilter = (typeof ROW_FILTERS)[number]["value"];

export function rowMatchesFilter(
  resolution: ImportRowResolution,
  filter: RowFilter,
): boolean {
  switch (filter) {
    case "":
      return true;
    case "attention":
      return resolution === "unmatched";
    case "duplicate":
      return resolution === "duplicate";
    case "skipped":
      return resolution === "skipped";
    case "charged":
      return resolution === "matched" || resolution === "assigned";
  }
}

/** What a commit's recalculation came to, as a sentence. */
export function recalculationSentence(
  outcome: ImportRecalculationOutcome,
  month: string,
  recalculated: number,
): string {
  switch (outcome) {
    case "recalculated":
      return `${month} was recalculated (${recalculated} draft or disputed statement${recalculated === 1 ? "" : "s"}): the draft statements of the people charged now show these chargebacks.`;
    case "no_run":
      return `${month} has not been calculated yet. The chargebacks will be on its statements when it is.`;
    case "busy":
      return `${month} was being calculated at the same moment. Recalculate it from Payouts once that finishes, to be sure these chargebacks are included.`;
    case "failed":
      return `The chargebacks are saved, but recalculating ${month} failed. Recalculate it from Payouts.`;
  }
}
