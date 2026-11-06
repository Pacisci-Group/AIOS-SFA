import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowLeft,
  CircleCheck,
  FileSpreadsheet,
  Loader2,
  MoreHorizontal,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import {
  IMPORT_ROW_NOTE_LABELS,
  type ChargebackImportRowView,
  type ChargebackImportView,
  type ImportRowAction,
} from "@sfa/shared";
import { DataPanel } from "@/components/common/DataPanel";
import { KpiCard } from "@/components/common/KpiCard";
import { TablePagination } from "@/components/common/TablePagination";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useUrlState } from "@/hooks/useUrlState";
import { formatMoney } from "@/lib/money";
import { formatMonth } from "@/lib/months";
import { NOT_AVAILABLE } from "@/lib/not-available";
import {
  commitChargebackImport,
  discardChargebackImport,
  getChargebackImport,
  payoutImportKey,
  payoutImportsKey,
  payoutsKey,
  updateImportRow,
} from "@/lib/payouts-api";
import { cn } from "@/lib/utils";
import { payoutErrorMessage } from "../payout-errors";
import { chargebackSourceLabel, formatDay } from "../payout-format";
import { AssignRowDialog } from "./AssignRowDialog";
import {
  IMPORT_STATUS_CLASSES,
  IMPORT_STATUS_LABELS,
  recalculationSentence,
  RESOLUTION_CLASSES,
  RESOLUTION_LABELS,
  ROW_FILTERS,
  rowMatchesFilter,
  SIGNAL_LABELS,
  type RowFilter,
} from "./import-format";

const PAGE_SIZE = 25;
/** Radix Select cannot hold `""`, so "every line" needs a value of its own. */
const ALL = "__all__";

const URL_DEFAULTS = { show: "", page: "" };
const URL_ALLOWED = {
  show: ROW_FILTERS.map((filter) => filter.value).filter(Boolean),
  page: (value: string) => /^[1-9]\d{0,4}$/.test(value),
};

/**
 * One chargeback report import (PAC-180): what each line matched, the lines
 * that need a person, and Commit / Discard while it is a preview. The owner's
 * (`agency:payouts:admin`), like the import itself.
 */
export default function ImportPreviewPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [values, setValues] = useUrlState({
    defaults: URL_DEFAULTS,
    allowed: URL_ALLOWED,
  });
  const show = values.show as RowFilter;
  const page = Number(values.page) || 1;

  const query = useQuery({
    queryKey: payoutImportKey(id),
    queryFn: () => getChargebackImport(id),
  });
  const data = query.data;
  const preview = data?.status === "preview";

  const [assigning, setAssigning] = useState<ChargebackImportRowView | null>(
    null,
  );
  const [confirm, setConfirm] = useState<"commit" | "discard" | null>(null);

  const rowAction = useMutation({
    mutationFn: (input: { rowNumber: number; action: ImportRowAction }) =>
      updateImportRow(id, input.rowNumber, input.action),
    onSuccess: ({ row, counts }) => {
      queryClient.setQueryData<ChargebackImportView>(
        payoutImportKey(id),
        (current) =>
          current && {
            ...current,
            counts,
            rows: current.rows.map((line) =>
              line.rowNumber === row.rowNumber ? row : line,
            ),
          },
      );
      void queryClient.invalidateQueries({
        queryKey: [...payoutImportsKey, "list"],
      });
      setAssigning(null);
    },
    onError: (error) => toast.error(payoutErrorMessage(error)),
  });

  const commit = useMutation({
    mutationFn: () => commitChargebackImport(id),
    onSuccess: async (response) => {
      queryClient.setQueryData(payoutImportKey(id), response.import);
      setConfirm(null);
      await queryClient.invalidateQueries({ queryKey: payoutsKey });
      toast.success(
        `${response.result.written} chargeback${response.result.written === 1 ? "" : "s"} charged to ${formatMonth(response.import.month)}.`,
      );
    },
    onError: (error) => {
      setConfirm(null);
      toast.error(payoutErrorMessage(error));
      void query.refetch();
    },
  });

  const discard = useMutation({
    mutationFn: () => discardChargebackImport(id),
    onSuccess: async (summary) => {
      setConfirm(null);
      await queryClient.invalidateQueries({ queryKey: payoutImportsKey });
      toast.success("Import discarded. Nothing was charged.");
      navigate(`/payouts?month=${summary.month}`);
    },
    onError: (error) => {
      setConfirm(null);
      toast.error(payoutErrorMessage(error));
    },
  });

  const rows = useMemo(
    () =>
      (data?.rows ?? []).filter((row) =>
        rowMatchesFilter(row.resolution, show),
      ),
    [data?.rows, show],
  );
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const shownPage = Math.min(page, totalPages);
  const pageRows = rows.slice(
    (shownPage - 1) * PAGE_SIZE,
    shownPage * PAGE_SIZE,
  );

  const backTo = data ? `/payouts?month=${data.month}` : "/payouts";
  const counts = data?.counts;
  const unresolved = counts?.unmatched ?? 0;
  const busy = rowAction.isPending || commit.isPending || discard.isPending;

  return (
    <AppShell>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4 md:px-6">
        <div className="flex min-w-0 items-center gap-2 md:gap-3">
          <MobileNav className="-ml-1" />
          <Button variant="ghost" size="icon-sm" asChild>
            <Link to={backTo} aria-label="Back to Payouts">
              <ArrowLeft aria-hidden />
            </Link>
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-tight">
              Chargeback report
            </h1>
            <p className="truncate text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {data
                ? `${formatMonth(data.month)} · ${data.carrier} · ${data.filename}`
                : "Loading"}
            </p>
          </div>
          {data && (
            <Badge
              size="sm"
              variant="ghost"
              className={cn("shrink-0", IMPORT_STATUS_CLASSES[data.status])}
            >
              {IMPORT_STATUS_LABELS[data.status]}
            </Badge>
          )}
        </div>
        {preview && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => setConfirm("discard")}
            >
              <Trash2 aria-hidden />
              Discard
            </Button>
            <Button
              size="sm"
              disabled={busy || unresolved > 0}
              title={
                unresolved > 0
                  ? "Choose who to charge for every line that needs a person, or skip it."
                  : undefined
              }
              onClick={() => setConfirm("commit")}
            >
              {commit.isPending ? (
                <Loader2 aria-hidden className="animate-spin" />
              ) : (
                <CircleCheck aria-hidden />
              )}
              Commit
            </Button>
          </div>
        )}
      </header>

      <main className="w-full px-4 py-6 md:px-6">
        {query.isError ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card px-5 py-16 text-center">
            <AlertCircle aria-hidden className="size-5 text-destructive" />
            <p className="text-sm text-muted-foreground">
              {payoutErrorMessage(query.error)}
            </p>
            <Button variant="outline" size="sm" asChild>
              <Link to="/payouts">Back to Payouts</Link>
            </Button>
          </div>
        ) : !data || !counts ? (
          <div className="space-y-6">
            <Skeleton className="h-28 w-full rounded-xl" />
            <Skeleton className="h-96 w-full rounded-xl" />
          </div>
        ) : (
          <div className="space-y-6">
            <ImportNotices data={data} unresolved={unresolved} />

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <KpiCard
                label="Lines"
                value={String(counts.rows)}
                caption={
                  data.sheetName
                    ? `Sheet "${data.sheetName}", header on row ${data.headerRowNumber}`
                    : `CSV, header on row ${data.headerRowNumber}`
                }
                isPending={false}
              />
              <KpiCard
                label={data.status === "committed" ? "Charged" : "To charge"}
                value={formatMoney(
                  data.status === "committed" && data.result
                    ? data.result.amount
                    : counts.amountToCharge,
                )}
                caption={`${counts.toCharge} line${counts.toCharge === 1 ? "" : "s"} · ${counts.assigned} assigned by you`}
                isPending={false}
              />
              <KpiCard
                label="Needs a person"
                value={String(counts.unmatched)}
                caption={
                  counts.unmatched
                    ? "Commit is blocked until each is assigned or skipped"
                    : "Every line has someone to charge"
                }
                isPending={false}
              />
              <KpiCard
                label="Duplicates"
                value={String(counts.duplicate)}
                caption="Already charged back, so never charged again"
                isPending={false}
              />
              <KpiCard
                label="Skipped"
                value={String(counts.skipped)}
                caption="Left out — by you, or as a reversal"
                isPending={false}
              />
            </div>

            <DataPanel
              title="Lines"
              titleHint="Each line of the report, what the app matched it to, and who it charges."
              subheading={
                <div className="flex flex-wrap items-center gap-2 pt-2">
                  <Select
                    value={show || ALL}
                    onValueChange={(next) =>
                      setValues({ show: next === ALL ? "" : next, page: "" })
                    }
                  >
                    <SelectTrigger
                      className="w-full bg-card sm:w-48"
                      aria-label="Show"
                    >
                      <SelectValue>
                        {ROW_FILTERS.find((filter) => filter.value === show)
                          ?.label ?? "Every line"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {ROW_FILTERS.map((filter) => (
                        <SelectItem
                          key={filter.value || ALL}
                          value={filter.value || ALL}
                        >
                          {filter.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              }
              isPending={false}
              isError={false}
              isEmpty={rows.length === 0}
              emptyMessage="No lines match this filter."
              errorMessage=""
              onRetry={() => undefined}
              skeletonRows={6}
            >
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-5">Row</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Policy</TableHead>
                    <TableHead>In the file</TableHead>
                    <TableHead>Charged to</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    {preview && (
                      <TableHead className="pr-5">
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageRows.map((row) => (
                    <ImportRow
                      key={row.rowNumber}
                      row={row}
                      editable={preview}
                      busy={busy}
                      onAssign={() => setAssigning(row)}
                      onAction={(action) =>
                        rowAction.mutate({ rowNumber: row.rowNumber, action })
                      }
                    />
                  ))}
                </TableBody>
              </Table>
              <TablePagination
                page={shownPage}
                pageSize={PAGE_SIZE}
                total={rows.length}
                totalPages={totalPages}
                onPageChange={(next) =>
                  setValues({ page: next > 1 ? String(next) : "" })
                }
                noun="lines"
                className="border-t border-border px-5 py-3"
              />
            </DataPanel>
          </div>
        )}
      </main>

      <AssignRowDialog
        row={assigning}
        pending={rowAction.isPending}
        onCancel={() => setAssigning(null)}
        onAssign={(userId) =>
          assigning &&
          rowAction.mutate({
            rowNumber: assigning.rowNumber,
            action: { action: "assign", userId },
          })
        }
      />

      <AlertDialog
        open={confirm !== null}
        onOpenChange={(next) => !next && !busy && setConfirm(null)}
      >
        <AlertDialogContent>
          {confirm === "commit" && data && counts ? (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Charge {counts.toCharge} line
                  {counts.toCharge === 1 ? "" : "s"} totalling{" "}
                  {formatMoney(counts.amountToCharge)} to{" "}
                  {formatMonth(data.month)}?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  Each becomes a chargeback on its person's{" "}
                  {formatMonth(data.month)} statement. Draft and disputed
                  statements are recalculated; sent and accepted ones are left
                  as they are and listed here afterwards. A committed report
                  cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={commit.isPending}>
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  disabled={commit.isPending}
                  onClick={(event) => {
                    event.preventDefault();
                    commit.mutate();
                  }}
                >
                  {commit.isPending && (
                    <Loader2 aria-hidden className="size-4 animate-spin" />
                  )}
                  Commit
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          ) : (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>Discard this report?</AlertDialogTitle>
                <AlertDialogDescription>
                  Nothing has been charged from it. The same file can be
                  uploaded again afterwards.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={discard.isPending}>
                  Keep it
                </AlertDialogCancel>
                <AlertDialogAction
                  disabled={discard.isPending}
                  onClick={(event) => {
                    event.preventDefault();
                    discard.mutate();
                  }}
                >
                  {discard.isPending && (
                    <Loader2 aria-hidden className="size-4 animate-spin" />
                  )}
                  Discard
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}

/** What the import has done, or still needs, above the figures. */
function ImportNotices({
  data,
  unresolved,
}: {
  data: ChargebackImportView;
  unresolved: number;
}) {
  const month = formatMonth(data.month);
  return (
    <div className="space-y-4">
      {data.status === "committed" && data.result && (
        <Alert>
          <CircleCheck aria-hidden className="text-success!" />
          <AlertTitle>
            {data.result.written} chargeback
            {data.result.written === 1 ? "" : "s"} charged to {month} (
            {formatMoney(data.result.amount)})
          </AlertTitle>
          <AlertDescription>
            <p>
              {recalculationSentence(
                data.result.recalculation,
                month,
                data.result.recalculated,
              )}
            </p>
            {data.result.untouched.length > 0 && (
              <div className="mt-2">
                <p>
                  Already sent, so left as they are — reopen any that must
                  change:
                </p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {data.result.untouched.map((statement) => (
                    <li key={statement.statementId}>
                      <Link
                        className="font-medium text-primary underline-offset-4 hover:underline"
                        to={`/payouts/statements/${statement.statementId}`}
                      >
                        {statement.userName}
                      </Link>{" "}
                      ({statement.status === "accepted" ? "accepted" : "sent"})
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </AlertDescription>
        </Alert>
      )}
      {data.status === "discarded" && (
        <Alert>
          <FileSpreadsheet aria-hidden />
          <AlertTitle>Discarded</AlertTitle>
          <AlertDescription>
            Nothing from this report was charged.
          </AlertDescription>
        </Alert>
      )}
      {data.status === "preview" && unresolved > 0 && (
        <Alert>
          <TriangleAlert
            aria-hidden
            className="text-amber-600! dark:text-amber-500!"
          />
          <AlertTitle>
            {unresolved === 1
              ? "1 line needs a person"
              : `${unresolved} lines need a person`}
          </AlertTitle>
          <AlertDescription>
            Choose who to charge for each, or skip it. Nothing is charged until
            you commit.
          </AlertDescription>
        </Alert>
      )}
      {data.status === "preview" && data.counts.duplicate > 0 && (
        <Alert>
          <FileSpreadsheet aria-hidden />
          <AlertTitle>
            {data.counts.duplicate === 1
              ? "1 line is already charged back"
              : `${data.counts.duplicate} lines are already charged back`}
          </AlertTitle>
          <AlertDescription>
            A policy is charged back once. The original chargeback is kept, and
            these lines are not charged — each says which charge it repeats.
          </AlertDescription>
        </Alert>
      )}
      {data.warnings.length > 0 && (
        <Alert>
          <TriangleAlert
            aria-hidden
            className="text-amber-600! dark:text-amber-500!"
          />
          <AlertTitle>While reading the file</AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-0.5 pl-4">
              {data.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

function ImportRow({
  row,
  editable,
  busy,
  onAssign,
  onAction,
}: {
  row: ChargebackImportRowView;
  editable: boolean;
  busy: boolean;
  onAssign: () => void;
  onAction: (action: ImportRowAction) => void;
}) {
  const duplicate = row.resolution === "duplicate";
  const muted = row.resolution === "skipped" || duplicate;
  const inFile = [row.producerName, row.bindId && `SOK ${row.bindId}`]
    .filter(Boolean)
    .join(" · ");
  // An assignment always reads `assigned`, which matching never gives, so
  // any change the owner made shows as a different resolution.
  const changed = row.resolution !== row.autoResolution;

  return (
    <TableRow className={cn(muted && "text-muted-foreground")}>
      <TableCell className="pl-5 tabular-nums">{row.rowNumber}</TableCell>
      <TableCell className="min-w-40 whitespace-normal">
        <div className="font-medium">{row.customerName ?? NOT_AVAILABLE}</div>
        <div className="text-xs text-muted-foreground">
          {[row.policyType, row.terminationReason]
            .filter(Boolean)
            .join(" · ") || NOT_AVAILABLE}
        </div>
      </TableCell>
      <TableCell className="min-w-40 whitespace-normal">
        <div className="tabular-nums">{row.policyNumber ?? NOT_AVAILABLE}</div>
        <div className="text-xs text-muted-foreground">
          {row.policy ? row.carrier : `${row.carrier} · not in the app`}
          {row.soldDay ? ` · sold ${formatDay(row.soldDay)}` : ""}
        </div>
      </TableCell>
      <TableCell className="min-w-32 whitespace-normal text-muted-foreground">
        {inFile || NOT_AVAILABLE}
      </TableCell>
      <TableCell className="min-w-32 whitespace-normal">
        {duplicate ? (
          <span className="text-muted-foreground">Not charged</span>
        ) : row.chargedTo ? (
          <span className="font-medium">
            {row.chargedTo.name}
            {row.chargedTo.status === "deactivated" && (
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                (left)
              </span>
            )}
          </span>
        ) : (
          <span className="text-muted-foreground">{NOT_AVAILABLE}</span>
        )}
        {row.resolution === "unmatched" && row.candidates.length > 0 && (
          <div className="text-xs text-muted-foreground">
            {row.candidates
              .map(
                (candidate) =>
                  `${candidate.name} (${SIGNAL_LABELS[candidate.via].toLowerCase()})`,
              )
              .join(" or ")}
          </div>
        )}
      </TableCell>
      <TableCell
        className={cn(
          "text-right tabular-nums",
          muted && "line-through decoration-muted-foreground/60",
        )}
      >
        {formatMoney(row.amount)}
      </TableCell>
      <TableCell className="min-w-52 whitespace-normal">
        <Badge
          size="sm"
          variant="ghost"
          className={cn("shrink-0", RESOLUTION_CLASSES[row.resolution])}
        >
          {RESOLUTION_LABELS[row.resolution]}
        </Badge>
        {row.notes.length > 0 && (
          <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
            {row.notes.map((note) => (
              <li key={note}>{IMPORT_ROW_NOTE_LABELS[note]}</li>
            ))}
            {row.existingChargeback && (
              <li className="text-foreground">
                Kept: {originalChargebackLabel(row.existingChargeback)}
              </li>
            )}
            {row.repeatOfRow !== null && (
              <li className="text-foreground">
                Charged on row {row.repeatOfRow}.
              </li>
            )}
          </ul>
        )}
      </TableCell>
      {editable && duplicate && <TableCell className="pr-5" />}
      {editable && !duplicate && (
        <TableCell className="pr-5 text-right">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={busy}
                aria-label={`Actions for row ${row.rowNumber}`}
              >
                <MoreHorizontal aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onSelect={onAssign}>
                {row.chargedTo
                  ? "Charge someone else…"
                  : "Choose who to charge…"}
              </DropdownMenuItem>
              {row.resolution !== "skipped" && (
                <DropdownMenuItem onSelect={() => onAction({ action: "skip" })}>
                  Skip this line
                </DropdownMenuItem>
              )}
              {changed && (
                <DropdownMenuItem
                  onSelect={() => onAction({ action: "reset" })}
                >
                  Undo my change
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </TableCell>
      )}
    </TableRow>
  );
}

/**
 * The chargeback a duplicate leaves standing: "Cancelled policy · $400.00 ·
 * Feb 20, 2026 · Test Producer", or the pay month for a report or manual line.
 */
function originalChargebackLabel(
  existing: NonNullable<ChargebackImportRowView["existingChargeback"]>,
): string {
  const when = existing.statementMonth
    ? formatMonth(existing.statementMonth)
    : formatDay(existing.occurredAt.slice(0, 10));
  return [
    chargebackSourceLabel(existing),
    formatMoney(existing.amount),
    when,
    existing.producerName || null,
  ]
    .filter(Boolean)
    .join(" · ");
}
