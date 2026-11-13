import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  FileCheck2,
  Loader2,
  Lock,
  LockOpen,
  RefreshCw,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  RECONCILIATION_ASSIGNEE_FILTER_PATTERN,
  RECONCILIATION_PRODUCER_KEY_PATTERN,
  RECONCILIATION_TABS,
} from "@sfa/shared";
import { AppShell } from "@/components/layout/AppShell";
import { MobileNav } from "@/components/layout/MobileNav";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { usePermissions } from "@/hooks/usePermissions";
import { useUrlState } from "@/hooks/useUrlState";
import {
  closeReconciliationRun,
  getReconciliationRun,
  getReconciliationRuns,
  reclassifyRun,
  reopenReconciliationRun,
  reconciliationKey,
  reconciliationRunKey,
  reconciliationRunsKey,
  type ReconciliationRowView,
  type ReconciliationTab,
} from "@/lib/carrier-reconciliation-api";
import { RowDetailSheet } from "./components/RowDetailSheet";
import { RowsPanel, type RowsFilter } from "./components/RowsPanel";
import { ProducerTable, RunKpis } from "./components/RunSummary";
import { UploadReportDialog } from "./components/UploadReportDialog";
import {
  apiErrorMessage,
  formatInstant,
  formatPeriod,
} from "./reconciliation-format";

const OBJECT_ID = /^[a-f0-9]{24}$/i;

const URL_DEFAULTS = {
  run: "",
  tab: "",
  producer: "",
  assignee: "",
  q: "",
  page: "",
};

const URL_ALLOWED = {
  run: (value: string) => OBJECT_ID.test(value),
  tab: RECONCILIATION_TABS,
  producer: (value: string) => RECONCILIATION_PRODUCER_KEY_PATTERN.test(value),
  assignee: (value: string) => RECONCILIATION_ASSIGNEE_FILTER_PATTERN.test(value),
  page: (value: string) => /^[1-9]\d{0,4}$/.test(value),
} as const;

/**
 * The Dash Reconciliation page: upload Allstate's monthly "New Business
 * Details" report and see what the app is missing, what Dash does not show,
 * which policies Allstate sold itself (1-800) and whose credit differs.
 *
 * Agency-wide by design — a carrier report has no branch — and gated by
 * `carrier_reconciliation:read`; uploading, deciding rows and re-checking a
 * run need `:write`.
 *
 * Who is staff comes from the **users'** Allstate codes (PAC-173), set on the
 * Users page and the profile page — there is no code registry here. A Bind ID
 * on no user reads as 1-800; once that person's code is set, "Re-check"
 * re-applies the codes to the stored run without re-uploading the file.
 *
 * A row waiting on a decision can be handed to a Producer or CSR from its
 * drawer; they work it from `/reconciliation/assigned` (`AssignedRowsPage`).
 * Closing a month takes its rows off those lists until it is reopened.
 */
export default function ReconciliationPage() {
  const { can } = usePermissions();
  const canWrite = can("carrier_reconciliation:write");
  const queryClient = useQueryClient();
  const [values, setValues] = useUrlState({
    defaults: URL_DEFAULTS,
    allowed: URL_ALLOWED,
  });
  const [uploadOpen, setUploadOpen] = useState(false);
  const [openRow, setOpenRow] = useState<ReconciliationRowView | null>(null);

  // Newest first, a page at a time: an agency uploads a report a month, so
  // the first page covers years, and older ones load on request.
  const runs = useInfiniteQuery({
    queryKey: reconciliationRunsKey,
    queryFn: ({ pageParam }) => getReconciliationRuns(pageParam),
    initialPageParam: 1,
    getNextPageParam: (last) =>
      last.page < last.totalPages ? last.page + 1 : undefined,
  });
  const loadedRuns = runs.data?.pages.flatMap((page) => page.items) ?? [];
  const runId = values.run || loadedRuns[0]?.id || "";
  const run = useQuery({
    queryKey: reconciliationRunKey(runId),
    queryFn: () => getReconciliationRun(runId),
    enabled: !!runId,
  });
  // A run opened by link that is not on a loaded page (older, or replaced by
  // a re-upload) still needs an entry, or the picker would show it blank.
  const runOptions =
    run.data && !loadedRuns.some((item) => item.id === run.data.id)
      ? [...loadedRuns, run.data]
      : loadedRuns;

  const recheck = useMutation({
    mutationFn: () => reclassifyRun(runId),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: reconciliationKey });
      toast.success(
        result.reclassified
          ? `${result.reclassified} row(s) changed with the users' current Allstate codes.`
          : "Nothing changed — the run already reflects the users' current codes.",
      );
    },
    onError: (error) =>
      toast.error(apiErrorMessage(error, "The run could not be re-checked.")),
  });

  // Close (true) or reopen (false) the month. Reopening needs no confirming:
  // it only puts rows back where they were.
  const [confirmClose, setConfirmClose] = useState(false);
  const monthState = useMutation({
    mutationFn: (close: boolean) =>
      close ? closeReconciliationRun(runId) : reopenReconciliationRun(runId),
    onSuccess: (detail, close) => {
      setConfirmClose(false);
      queryClient.setQueryData(reconciliationRunKey(detail.id), detail);
      void queryClient.invalidateQueries({ queryKey: reconciliationKey });
      toast.success(
        close
          ? "Month closed. Its rows are off everyone's lists."
          : "Month reopened. Its open rows are back on their assignees' lists.",
      );
    },
    onError: (error, close) =>
      toast.error(
        apiErrorMessage(
          error,
          close ? "The month could not be closed." : "The month could not be reopened.",
        ),
      ),
  });
  const canCloseMonth =
    canWrite && run.data?.status === "ready" && !run.data.supersededByRunId;

  const filter: RowsFilter = {
    tab: (values.tab || defaultTab(run.data?.tabCounts)) as ReconciliationTab,
    producer: values.producer,
    assignee: values.assignee,
    q: values.q,
    page: Number(values.page || 1),
  };
  const setFilter = (patch: Partial<RowsFilter>) =>
    setValues({
      ...(patch.tab !== undefined ? { tab: patch.tab } : {}),
      ...(patch.producer !== undefined ? { producer: patch.producer } : {}),
      ...(patch.assignee !== undefined ? { assignee: patch.assignee } : {}),
      ...(patch.q !== undefined ? { q: patch.q } : {}),
      ...(patch.page !== undefined ? { page: patch.page > 1 ? String(patch.page) : "" } : {}),
    });

  const producerName =
    run.data?.byProducer.find((p) => p.producerKey === values.producer)?.name ?? null;

  return (
    <AppShell>
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-4 md:px-6">
        <div className="flex min-w-0 items-center gap-2 md:gap-3">
          <MobileNav className="-ml-1" />
          <div className="hidden size-8 shrink-0 items-center justify-center rounded-lg bg-primary sm:flex">
            <FileCheck2 aria-hidden className="size-4 text-primary-foreground" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-tight">
              Dash Reconciliation
            </h1>
            <p className="truncate text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Allstate's new business against the app's sales
            </p>
          </div>
        </div>
        {canWrite && (
          <Button size="sm" onClick={() => setUploadOpen(true)}>
            <Upload aria-hidden />
            Upload report
          </Button>
        )}
      </header>

      <main className="w-full px-4 py-6 md:px-6">
        <div className="space-y-6">
          {runs.isError ? (
            <PageError message="Could not load the reports." onRetry={() => void runs.refetch()} />
          ) : runs.isPending ? (
            <Skeleton className="h-40 w-full rounded-xl" />
          ) : !loadedRuns.length ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card px-5 py-16 text-center">
              <FileCheck2 aria-hidden className="size-5 text-muted-foreground" />
              <p className="max-w-md text-sm text-muted-foreground">
                No reports yet. Each month, download “Sold — New Business
                Details (All)” from Dash as Excel and upload it here.
              </p>
              {canWrite && (
                <Button size="sm" onClick={() => setUploadOpen(true)}>
                  <Upload aria-hidden />
                  Upload report
                </Button>
              )}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <Select
                  value={runId}
                  onValueChange={(next) =>
                    setValues({ run: next, tab: "", producer: "", assignee: "", q: "", page: "" })
                  }
                >
                  <SelectTrigger className="w-full bg-card sm:w-96" aria-label="Report">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {runOptions.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {formatPeriod(item)} · uploaded {formatInstant(item.createdAt)}
                        {item.status === "failed" ? " · failed" : ""}
                        {item.supersededByRunId ? " · replaced" : ""}
                        {item.closedAt && !item.supersededByRunId ? " · closed" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {runs.hasNextPage && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={runs.isFetchingNextPage}
                    onClick={() => void runs.fetchNextPage()}
                  >
                    {runs.isFetchingNextPage ? "Loading…" : "Show older reports"}
                  </Button>
                )}
                {run.data && (
                  <p className="text-sm text-muted-foreground">
                    {run.data.filename}
                    {run.data.createdBy ? ` · by ${run.data.createdBy.name}` : ""}
                    {run.data.fileMeta.agentNumber
                      ? ` · agent ${run.data.fileMeta.agentNumber}`
                      : ""}
                  </p>
                )}
                {canWrite && run.data?.status === "ready" && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="ml-auto"
                    disabled={recheck.isPending}
                    onClick={() => recheck.mutate()}
                  >
                    <RefreshCw aria-hidden className={recheck.isPending ? "animate-spin" : undefined} />
                    Re-check with current codes
                  </Button>
                )}
                {canCloseMonth &&
                  (run.data?.closedAt ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={monthState.isPending}
                      onClick={() => monthState.mutate(false)}
                    >
                      {monthState.isPending ? (
                        <Loader2 aria-hidden className="animate-spin" />
                      ) : (
                        <LockOpen aria-hidden />
                      )}
                      Reopen month
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={monthState.isPending}
                      onClick={() => setConfirmClose(true)}
                    >
                      <Lock aria-hidden />
                      Close month
                    </Button>
                  ))}
              </div>

              {run.isError ? (
                <PageError message="Could not load this report." onRetry={() => void run.refetch()} />
              ) : run.isPending ? (
                <div className="space-y-4">
                  <Skeleton className="h-28 w-full rounded-xl" />
                  <Skeleton className="h-64 w-full rounded-xl" />
                </div>
              ) : run.data.status === "failed" ? (
                <Alert variant="destructive">
                  <AlertCircle aria-hidden />
                  <AlertTitle>This upload did not finish</AlertTitle>
                  <AlertDescription>{run.data.error ?? "Upload the report again."}</AlertDescription>
                </Alert>
              ) : (
                <>
                  {run.data.closedAt && !run.data.supersededByRunId && (
                    <Alert>
                      <Lock aria-hidden />
                      <AlertTitle>This month is closed</AlertTitle>
                      <AlertDescription>
                        Closed {formatInstant(run.data.closedAt)}
                        {run.data.closedBy ? ` by ${run.data.closedBy.name}` : ""}.
                        Its rows are on nobody's list and cannot be handed to
                        anyone. You can still decide them here; reopening the
                        month puts each open row back with whoever had it.
                      </AlertDescription>
                    </Alert>
                  )}
                  {run.data.warnings.length > 0 && (
                    <Alert>
                      <AlertCircle aria-hidden />
                      <AlertTitle>Read with care</AlertTitle>
                      <AlertDescription>
                        <ul className="list-disc pl-4">
                          {run.data.warnings.map((warning) => (
                            <li key={warning}>{warning}</li>
                          ))}
                        </ul>
                      </AlertDescription>
                    </Alert>
                  )}
                  <RunKpis run={run.data} />
                  <ProducerTable
                    run={run.data}
                    selected={values.producer}
                    onSelect={(producer) => setFilter({ producer, page: 1 })}
                  />
                  <RowsPanel
                    key={run.data.id}
                    run={run.data}
                    filter={filter}
                    producerName={producerName}
                    onFilterChange={setFilter}
                    onOpenRow={setOpenRow}
                  />
                </>
              )}
            </>
          )}
        </div>
      </main>

      <UploadReportDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onUploaded={(id) => {
          setUploadOpen(false);
          setValues({ run: id, tab: "", producer: "", assignee: "", q: "", page: "" });
        }}
      />
      {runId && (
        <RowDetailSheet
          runId={runId}
          runClosed={!!run.data?.closedAt}
          row={openRow}
          onClose={() => setOpenRow(null)}
          onRowChanged={setOpenRow}
        />
      )}
      <AlertDialog
        open={confirmClose}
        onOpenChange={(next) => !monthState.isPending && setConfirmClose(next)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Close {run.data ? formatPeriod(run.data) : "this month"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {run.data?.assigned
                ? `${run.data.assigned} open row${run.data.assigned === 1 ? "" : "s"} assigned to people will leave their lists. `
                : ""}
              While the month is closed, none of its rows can be handed to
              anyone. Nothing is decided or deleted: you can still decide its
              rows here, and reopening puts each open row back with whoever had
              it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={monthState.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={monthState.isPending}
              onClick={(event) => {
                // Stay open while the request runs, so a 409 is not hidden
                // behind a dialog that already closed.
                event.preventDefault();
                monthState.mutate(true);
              }}
            >
              {monthState.isPending && <Loader2 aria-hidden className="size-4 animate-spin" />}
              Close month
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}

/** The first tab with something waiting on a person; else Matched. */
function defaultTab(
  counts: Record<ReconciliationTab, { total: number; open: number }> | undefined,
): ReconciliationTab {
  if (!counts) return "missing_from_app";
  const waiting = (
    [
      "missing_from_app",
      "review_1800",
      "not_in_dash",
      "premium_mismatch",
      "producer_mismatch",
    ] as const
  ).find((tab) => counts[tab].open > 0);
  return waiting ?? "matched";
}

function PageError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card px-5 py-16 text-center">
      <AlertCircle aria-hidden className="size-5 text-destructive" />
      <p className="text-sm text-muted-foreground">{message}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
