import { useState } from "react";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { DataPanel } from "@/components/common/DataPanel";
import { TablePagination } from "@/components/common/TablePagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApiError } from "@/lib/api-client";
import {
  dataExportHistoryKey,
  getDataExportFileUrl,
  getDataExportHistory,
  startDownload,
  type DataExportHistoryRow,
} from "@/lib/data-export-api";
import { NOT_AVAILABLE } from "@/lib/not-available";
import { relativeTime } from "@/lib/relative-time";
import {
  describeWindow,
  formatBytes,
  formatExpiry,
  isPendingExport,
} from "../export-format";

const PAGE_SIZE = 10;

/** How often the table refreshes while a job is still running. */
const POLL_MS = 3_000;

/**
 * A row's lifecycle state. Mirrors `CampaignStatusBadge`: a spinner inside the
 * pill while a worker job is running, so "still working" reads without a
 * second element competing for the row.
 */
function StatusBadge({ row }: { row: DataExportHistoryRow }) {
  switch (row.status) {
    case "queued":
      return (
        <Badge variant="secondary">
          <Loader2 className="animate-spin" />
          Queued
        </Badge>
      );
    case "processing":
      return (
        <Badge variant="secondary">
          <Loader2 className="animate-spin" />
          Preparing
        </Badge>
      );
    case "ready":
      return row.canDownload ? (
        <Badge variant="success" title={row.truncated ? "Stopped at the row limit" : undefined}>
          {row.truncated ? "Ready · capped" : "Ready"}
        </Badge>
      ) : (
        <Badge variant="outline">Expired</Badge>
      );
    case "expired":
      return <Badge variant="outline">Expired</Badge>;
    default:
      return (
        <Badge variant="destructive" title={row.error ?? undefined}>
          {row.error === "EXPORT_TOO_LARGE" ? "Too large" : "Failed"}
        </Badge>
      );
  }
}

/** Rows and size: a placeholder while the job runs, the figure once it has. */
function Figure({
  row,
  value,
}: {
  row: DataExportHistoryRow;
  value: string;
}) {
  if (isPendingExport(row)) return <span aria-label="Being prepared">…</span>;
  return <>{value}</>;
}

/**
 * Every export, newest first — the job list and the audit trail for a page
 * that hands out contact details in bulk. Agency-scope users see the whole
 * agency's; anyone else sees their own.
 *
 * An export is requested, not downloaded: a row appears `Queued`, turns
 * `Ready` once the worker has stored the file (the requester is emailed then
 * too), and offers Download until retention deletes it. The table polls while
 * any row on the page is still being prepared, so a job finishes in front of
 * the user without a refresh.
 */
export function RecentExports() {
  const [page, setPage] = useState(1);
  const history = useQuery({
    queryKey: [...dataExportHistoryKey, page],
    queryFn: () => getDataExportHistory(page, PAGE_SIZE),
    placeholderData: keepPreviousData,
    refetchInterval: (query) =>
      query.state.data?.items.some(isPendingExport) ? POLL_MS : false,
    // A user who requests an export and switches tabs should come back to a
    // finished row, not one that only starts updating once they return.
    refetchIntervalInBackground: true,
  });
  const rows = history.data?.items ?? [];

  const download = useMutation({
    mutationFn: (id: string) => getDataExportFileUrl(id),
    onSuccess: ({ url }) => startDownload(url),
    onError: (error) =>
      toast.error(
        error instanceof ApiError ? error.message : "The download failed. Try again.",
      ),
    // A 410 means the file just expired; refresh so the row says so.
    onSettled: () => void history.refetch(),
  });

  return (
    <DataPanel
      title="Recent exports"
      isPending={history.isPending}
      isError={history.isError}
      isEmpty={rows.length === 0}
      emptyMessage="Nothing has been exported yet."
      errorMessage="Could not load the export history."
      onRetry={() => void history.refetch()}
      skeletonRows={4}
    >
      <Table>
        <TableHeader>
          <TableRow>
            {/* Hidden on a phone so the Download action fits without a sideways scroll. */}
            <TableHead className="hidden sm:table-cell">Requested</TableHead>
            <TableHead>Dataset</TableHead>
            <TableHead className="hidden sm:table-cell">Range</TableHead>
            <TableHead className="text-right">Rows</TableHead>
            <TableHead className="hidden text-right md:table-cell">Size</TableHead>
            <TableHead className="hidden md:table-cell">By</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">
              <span className="sr-only">Download</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const failed = row.status === "failed";
            return (
              <TableRow key={row.id}>
                <TableCell
                  className="hidden text-sm text-muted-foreground sm:table-cell"
                  title={new Date(row.createdAt).toLocaleString()}
                >
                  {relativeTime(row.createdAt)}
                </TableCell>
                <TableCell className="text-sm">
                  {row.datasetLabel}
                  <span className="ml-1.5 text-xs text-muted-foreground uppercase">
                    {row.format}
                  </span>
                </TableCell>
                <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                  {describeWindow(row)}
                </TableCell>
                <TableCell className="text-right text-sm tabular-nums">
                  <Figure row={row} value={row.rowCount.toLocaleString()} />
                </TableCell>
                <TableCell className="hidden text-right text-sm text-muted-foreground tabular-nums md:table-cell">
                  <Figure
                    row={row}
                    value={row.bytes && !failed ? formatBytes(row.bytes) : NOT_AVAILABLE}
                  />
                </TableCell>
                <TableCell className="hidden text-sm md:table-cell">
                  {row.createdByName ?? NOT_AVAILABLE}
                </TableCell>
                <TableCell>
                  <StatusBadge row={row} />
                </TableCell>
                <TableCell className="text-right">
                  {row.canDownload && row.expiresAt ? (
                    <div className="flex items-center justify-end gap-2">
                      <span className="hidden text-xs text-muted-foreground lg:inline">
                        {formatExpiry(row.expiresAt)}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => download.mutate(row.id)}
                        disabled={download.isPending && download.variables === row.id}
                        aria-label={`Download ${row.filename}`}
                        title={`${row.filename} · ${formatExpiry(row.expiresAt)}`}
                      >
                        {download.isPending && download.variables === row.id ? (
                          <Loader2 aria-hidden className="size-4 animate-spin" />
                        ) : (
                          <Download aria-hidden className="size-4" />
                        )}
                        <span className="hidden sm:inline">Download</span>
                      </Button>
                    </div>
                  ) : null}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {history.data && history.data.totalPages > 1 && (
        <TablePagination
          page={history.data.page}
          pageSize={history.data.pageSize}
          total={history.data.total}
          totalPages={history.data.totalPages}
          onPageChange={setPage}
          busy={history.isFetching}
          noun="exports"
        />
      )}
    </DataPanel>
  );
}
