import { toast } from "sonner";
import type { RangeChip } from "@/components/common/RangeChips";
import { ApiError } from "@/lib/api-client";
import type { UrlRange } from "@/lib/date-range";
import { formatRangeLabel } from "@/lib/date-range";
import {
  DATA_EXPORT_DUPLICATE,
  DATA_EXPORT_PENDING_STATUSES,
  DATA_EXPORT_TOO_LARGE,
} from "@sfa/shared";
import type {
  DataExportColumnDescriptor,
  DataExportDuplicateError,
  DataExportHistoryRow,
  DataExportTooLargeError,
} from "@/lib/data-export-api";

export type ExportRangeKey = "all" | "thisYear" | "last12Months";

export const EXPORT_RANGE_KEYS: readonly (ExportRangeKey | "custom")[] = [
  "all",
  "thisYear",
  "last12Months",
  "custom",
];

/**
 * Exports default to **all time** — the data team usually wants everything and
 * filters in Alteryx. The presets are resolved here, on the browser's calendar,
 * into plain `from`/`to` dates; the API only ever sees calendar dates and cuts
 * them on the agency's timezone.
 */
export const EXPORT_RANGE_CHIPS: readonly RangeChip<ExportRangeKey>[] = [
  { key: "all", label: "All time" },
  { key: "thisYear", label: "This year" },
  { key: "last12Months", label: "Last 12 months" },
  { key: "custom", label: "Custom Date" },
];

function isoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function resolveExportRange(
  range: UrlRange<ExportRangeKey>,
  today: Date = new Date(),
): { from?: string; to?: string } {
  switch (range.key) {
    case "thisYear":
      return { from: `${today.getFullYear()}-01-01`, to: isoDate(today) };
    case "last12Months": {
      const start = new Date(today);
      start.setFullYear(start.getFullYear() - 1);
      start.setDate(start.getDate() + 1);
      return { from: isoDate(start), to: isoDate(today) };
    }
    case "custom":
      return { from: range.from, to: range.to };
    default:
      return {};
  }
}

/** How a history row's window reads: "All time", "Since 2026-01-01", a range. */
export function describeWindow(row: Pick<DataExportHistoryRow, "filters">): string {
  const { from, to } = row.filters;
  if (from && to) return formatRangeLabel(from, to);
  if (from) return `From ${from}`;
  if (to) return `Through ${to}`;
  return "All time";
}

/**
 * Tell the user why a request or a re-run was refused. A duplicate is not a
 * failure (they already have the export), so it is a notice, not an error.
 */
export function toastExportRefusal(error: unknown): void {
  if (error instanceof ApiError) {
    const body = error.body as
      | Partial<DataExportTooLargeError>
      | Partial<DataExportDuplicateError>
      | undefined;
    if (body?.code === DATA_EXPORT_DUPLICATE) {
      toast.info(error.message);
      return;
    }
    if (body?.code === DATA_EXPORT_TOO_LARGE && "rowCount" in body) {
      toast.error(
        `This export has ${body.rowCount?.toLocaleString()} rows; the limit is ${body.maxRows?.toLocaleString()}. Narrow the date range or add a filter.`,
      );
      return;
    }
    toast.error(error.message);
    return;
  }
  toast.error("The export could not be requested. Try again.");
}

/** Still queued or being written — the history polls while any row is. */
export function isPendingExport(row: Pick<DataExportHistoryRow, "status">): boolean {
  return DATA_EXPORT_PENDING_STATUSES.includes(row.status);
}

/** "Kept until Oct 13" — the stored file's expiry, on the browser's calendar. */
export function formatExpiry(iso: string): string {
  return `Kept until ${new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const COLUMN_TYPE_LABELS: Record<DataExportColumnDescriptor["type"], string> = {
  string: "Text",
  number: "Number",
  boolean: "Yes / no",
  date: "Date",
  datetime: "Date & time",
  id: "ID",
  list: "List",
};
