import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { FileCheck2 } from "lucide-react";
import { toast } from "sonner";
import {
  primaryReconciliationTab,
  RECONCILIATION_TAB_LABELS,
} from "@sfa/shared";
import { DataPanel } from "@/components/common/DataPanel";
import { TablePagination } from "@/components/common/TablePagination";
import { AppShell } from "@/components/layout/AppShell";
import { MobileNav } from "@/components/layout/MobileNav";
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
import { useUrlState } from "@/hooks/useUrlState";
import {
  getAssignedReconciliationRow,
  getAssignedReconciliationRows,
  reconciliationAssignedListKey,
  reconciliationAssignedRowKey,
  type ReconciliationAssignedRow,
} from "@/lib/carrier-reconciliation-api";
import { NOT_AVAILABLE } from "@/lib/not-available";
import { relativeTime } from "@/lib/relative-time";
import { RowDetailSheet } from "./components/RowDetailSheet";
import {
  apiErrorMessage,
  apiErrorStatus,
  formatDayRange,
  formatPremium,
  rowCustomer,
  rowPolicyNumber,
} from "./reconciliation-format";

const OBJECT_ID = /^[a-f0-9]{24}$/i;

const PAGE_SIZE = 25;

const URL_DEFAULTS = {
  row: "",
  page: "",
};

const URL_ALLOWED = {
  row: (value: string) => OBJECT_ID.test(value),
  page: (value: string) => /^[1-9]\d{0,4}$/.test(value),
} as const;

/** A 403 is the module being off, not a failure: asking again changes nothing. */
const retryUnlessForbidden = (failureCount: number, error: unknown) =>
  apiErrorStatus(error) !== 403 && failureCount < 1;

/**
 * "Assigned to me" (PAC-173): the Dash Reconciliation rows someone has handed
 * the signed-in Producer or CSR to work, oldest assignment first. The
 * `reconciliation.row_assigned` notification links here with `?row=<id>`,
 * which opens that row's drawer.
 *
 * Open to `leads:read` as well as `carrier_reconciliation:read`, because the
 * people it is for hold no reconciliation permission; for them the drawer is
 * read-only. A row leaves the list once a decision is recorded on it, on the
 * owner's page. **Recording an outcome from here — Sold, Other and the rest —
 * is the next PR**; until then this page tells the assignee what to look into
 * and where the row stands.
 *
 * A 403 means the agency does not use the module (or the viewer's role does
 * not include it): the page says so calmly rather than showing an error.
 */
export default function AssignedRowsPage() {
  const [values, setValues] = useUrlState({
    defaults: URL_DEFAULTS,
    allowed: URL_ALLOWED,
  });
  const page = Number(values.page || 1);
  const params = { page, pageSize: PAGE_SIZE };

  const rows = useQuery({
    queryKey: reconciliationAssignedListKey(params),
    queryFn: () => getAssignedReconciliationRows(params),
    placeholderData: keepPreviousData,
    retry: retryUnlessForbidden,
  });
  const unavailable = apiErrorStatus(rows.error) === 403;
  const data = rows.data;

  // A page emptied while it was open (its last rows decided) falls back to
  // the first, rather than reading "nothing assigned" with rows on page one.
  useEffect(() => {
    if (data && data.items.length === 0 && data.page > 1) setValues({ page: "" });
  }, [data, setValues]);

  const selected = useSelectedAssignedRow(
    values.row || null,
    data?.items ?? [],
    !unavailable,
    () => setValues({ row: "" }),
  );

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
              Assigned to me
            </h1>
            <p className="truncate text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Dash Reconciliation
            </p>
          </div>
        </div>
      </header>

      <main className="w-full px-4 py-6 md:px-6">
        {unavailable ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card px-5 py-16 text-center">
            <FileCheck2 aria-hidden className="size-5 text-muted-foreground" />
            <p className="max-w-md text-sm text-muted-foreground">
              Dash Reconciliation isn't turned on for your agency or your
              role, so there is nothing to follow up here.
            </p>
          </div>
        ) : (
          <DataPanel
            title="Dash follow-ups"
            subheading={
              <p className="pt-1 text-sm text-muted-foreground">
                Lines from Allstate's Dash report handed to you to look into,
                oldest first. Open one to see what Dash and the app each say.
                It leaves this list once a decision is recorded on it.
              </p>
            }
            isPending={rows.isPending}
            isError={rows.isError}
            isEmpty={(data?.items.length ?? 0) === 0}
            emptyMessage="Nothing is assigned to you right now."
            errorMessage="Could not load your assigned rows."
            onRetry={() => void rows.refetch()}
            skeletonRows={6}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Policy</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Why</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Dash premium</TableHead>
                  <TableHead>Report period</TableHead>
                  <TableHead>Assigned by</TableHead>
                  <TableHead className="pr-5">Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.items.map((row) => {
                  const tab = primaryReconciliationTab(row.tabs);
                  return (
                    <TableRow
                      key={row.id}
                      data-state={row.id === values.row ? "selected" : undefined}
                      className="cursor-pointer"
                      onClick={() => setValues({ row: row.id })}
                    >
                      <TableCell className="pl-5">
                        <Button
                          variant="link"
                          className="h-auto p-0 font-medium tabular-nums"
                        >
                          {rowPolicyNumber(row)}
                        </Button>
                      </TableCell>
                      <TableCell className="max-w-48 truncate">
                        {rowCustomer(row)}
                      </TableCell>
                      <TableCell>
                        {tab ? (
                          <Badge variant="secondary" size="sm">
                            {RECONCILIATION_TAB_LABELS[tab]}
                          </Badge>
                        ) : (
                          NOT_AVAILABLE
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {row.dash?.productDescription ??
                          row.dash?.product ??
                          row.app?.policyType ??
                          NOT_AVAILABLE}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatPremium(row.dash?.writtenPremium)}
                      </TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {formatDayRange(row.run.startDate, row.run.endDate)}
                      </TableCell>
                      <TableCell>
                        <div>{row.assignment.assignedBy?.name ?? NOT_AVAILABLE}</div>
                        <div className="text-xs tabular-nums text-muted-foreground">
                          {relativeTime(row.assignment.assignedAt)}
                        </div>
                      </TableCell>
                      <TableCell
                        className="max-w-72 truncate pr-5 text-muted-foreground"
                        title={row.assignment.note ?? undefined}
                      >
                        {row.assignment.note ?? NOT_AVAILABLE}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {data && (
              <TablePagination
                page={data.page}
                pageSize={data.pageSize}
                total={data.total}
                totalPages={data.totalPages}
                onPageChange={(next) =>
                  setValues({ page: next > 1 ? String(next) : "" })
                }
                busy={rows.isFetching}
                noun="rows"
                className="border-t border-border px-5 py-3"
              />
            )}
          </DataPanel>
        )}
      </main>

      <RowDetailSheet
        runId={selected?.runId ?? ""}
        row={selected}
        onClose={() => setValues({ row: "" })}
        // Nothing to keep here: the drawer reads the row from the queries a
        // save invalidates, so it follows on its own.
        onRowChanged={() => {}}
      />
    </AppShell>
  );
}

/**
 * The row the drawer shows — from the page in hand when it is on it,
 * otherwise fetched by id (the `features/tickets/useSelectedTicket.ts`
 * idiom). A notification can name a row on another page, or one decided since
 * it was sent, which the endpoint still returns to its assignee.
 *
 * A 404 means the row is someone else's now, or no one's: the viewer is told
 * and the link cleared. The last row shown is held while its own request is in
 * flight, so a row that leaves the list on a refetch (decided while open)
 * does not close and reopen the drawer.
 */
function useSelectedAssignedRow(
  id: string | null,
  rows: ReconciliationAssignedRow[],
  enabled: boolean,
  onGone: () => void,
): ReconciliationAssignedRow | null {
  const onPage = id ? rows.find((row) => row.id === id) : undefined;

  const detail = useQuery({
    queryKey: reconciliationAssignedRowKey(id ?? ""),
    queryFn: () => getAssignedReconciliationRow(id as string),
    enabled: Boolean(id) && !onPage && enabled,
    retry: false,
  });

  const found = onPage ?? (id ? detail.data : undefined) ?? null;
  // Held across renders the way React's docs store a previous render's value.
  const [last, setLast] = useState<ReconciliationAssignedRow | null>(null);
  if (found && found !== last) setLast(found);

  const { error, isFetching } = detail;
  const shownFromPage = Boolean(onPage);
  useEffect(() => {
    // Waits out a refetch, so a cached failure is not reported twice; and a
    // row on the page in hand is shown from it, whatever the last fetch said.
    if (!id || shownFromPage || !error || isFetching) return;
    const status = apiErrorStatus(error);
    // The page already says the module is unavailable.
    if (status === 403) return;
    if (status === 404) toast.info("That row is no longer assigned to you.");
    else toast.error(apiErrorMessage(error, "That row could not be opened."));
    onGone();
    // `onGone` is a fresh closure every render; the failure is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, shownFromPage, error, isFetching]);

  if (found) return found;
  return id && last?.id === id && !error ? last : null;
}
