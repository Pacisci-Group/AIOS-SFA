import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Download, X } from "lucide-react";
import { toast } from "sonner";
import {
  RECONCILIATION_REVIEW_STATUS_LABELS,
  RECONCILIATION_TAB_LABELS,
  RECONCILIATION_TABS,
  reconciliationPremiumDelta,
  type DataExportFormat,
} from "@sfa/shared";
import { DataPanel } from "@/components/common/DataPanel";
import { TablePagination } from "@/components/common/TablePagination";
import { TableSearchInput } from "@/components/common/TableSearchInput";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  downloadReconciliationExport,
  getReconciliationRows,
  reconciliationRowsKey,
  type ReconciliationRowView,
  type ReconciliationRunDetail,
  type ReconciliationTab,
} from "@/lib/carrier-reconciliation-api";
import {
  formatCount,
  formatDay,
  formatPremium,
  formatPremiumDelta,
  headlineIssues,
  issueLabel,
  ISSUE_SHORT_LABELS,
  REVIEW_BADGE,
  rowCustomer,
  rowPolicyNumber,
  rowProducer,
} from "../reconciliation-format";

const PAGE_SIZE = 25;

const DECISION_TABS: ReadonlySet<ReconciliationTab> = new Set([
  "missing_from_app",
  "not_in_dash",
  "review_1800",
  "premium_mismatch",
  "producer_mismatch",
]);

/** What each tab is for, under the tab strip. */
const TAB_HINTS: Record<ReconciliationTab, string> = {
  missing_from_app:
    "New policies Dash shows, bound by the agency, with no policy of that number in the app. Someone needs to enter the deal — or the number in the app is mistyped.",
  not_in_dash:
    "Policies sold in the app during this period that Dash does not list: usually a mistyped number, or a policy not issued yet.",
  review_1800:
    "Bound by an Allstate login that is on nobody on staff and that Dash prints no name for — Allstate's call centre or an automated system: business Allstate sold and assigned to the agency to service. A login Dash names is a former employee's and is never here. A 1-800 policy the app has on a sale is listed too: it should be serviced, not sold. If the Bind ID is one of the agency's people, set it on them on the Users page and Re-check the run.",
  premium_mismatch:
    "In both, but the app's premium is not Dash's written premium to the cent. Any difference is listed — often fees the app includes and Dash leaves out. The app is the source of truth: correct the sale if it is wrong, or record that Dash's figure is.",
  producer_mismatch:
    "In both, but Dash credits a different producer than the app's deal does.",
  matched: "In both, by policy number.",
  ignored:
    "Dash lines that are not new policies — items added to existing policies, Motor Club, repeated lines. Listed so the file's line count adds up.",
};

export interface RowsFilter {
  tab: ReconciliationTab;
  producer: string;
  q: string;
  page: number;
}

export function RowsPanel({
  run,
  filter,
  producerName,
  onFilterChange,
  onOpenRow,
}: {
  run: ReconciliationRunDetail;
  filter: RowsFilter;
  /** The summary's name for `filter.producer`, for the chip. */
  producerName: string | null;
  onFilterChange: (patch: Partial<RowsFilter>) => void;
  onOpenRow: (row: ReconciliationRowView) => void;
}) {
  const params = {
    tab: filter.tab,
    producer: filter.producer || undefined,
    q: filter.q || undefined,
    page: filter.page,
    pageSize: PAGE_SIZE,
  };
  const rows = useQuery({
    queryKey: reconciliationRowsKey(run.id, params),
    queryFn: () => getReconciliationRows(run.id, params),
    placeholderData: keepPreviousData,
  });
  const [downloading, setDownloading] = useState(false);

  // The box shows what is typed; the URL (and the query) follow a beat later.
  const [search, setSearch] = useState(filter.q);
  const debouncedSearch = useDebouncedValue(search);
  useEffect(() => {
    if (debouncedSearch !== filter.q) onFilterChange({ q: debouncedSearch, page: 1 });
    // Only the debounced value drives this; `filter.q` follows from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const download = async (format: DataExportFormat, tab?: ReconciliationTab) => {
    setDownloading(true);
    try {
      const scope = tab ?? "exceptions";
      await downloadReconciliationExport(
        run.id,
        format,
        tab,
        `dash-reconciliation_${run.fileMeta.startDate ?? "report"}_${run.fileMeta.endDate ?? ""}_${scope}.${format}`,
      );
    } catch {
      toast.error("The download failed. Try again.");
    } finally {
      setDownloading(false);
    }
  };

  const data = rows.data;
  // The Premium tab shows how far apart the two figures are.
  const showDelta = filter.tab === "premium_mismatch";

  return (
    <DataPanel
      title="Rows"
      subheading={
        <div className="space-y-3 pt-2">
          <Tabs
            value={filter.tab}
            onValueChange={(tab) =>
              onFilterChange({ tab: tab as ReconciliationTab, page: 1 })
            }
          >
            <TabsList className="h-auto flex-wrap justify-start">
              {RECONCILIATION_TABS.map((tab) => {
                const count = run.tabCounts[tab];
                // "open of total" only where the tab asks for decisions.
                const decides = DECISION_TABS.has(tab);
                return (
                  <TabsTrigger key={tab} value={tab} className="gap-1.5">
                    {RECONCILIATION_TAB_LABELS[tab]}
                    <span className="tabular-nums text-muted-foreground">
                      {decides && count.open !== count.total
                        ? `${count.open}/${count.total}`
                        : count.total}
                    </span>
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </Tabs>
          <p className="text-sm text-muted-foreground">
            {TAB_HINTS[filter.tab]}
            {filter.tab === "premium_mismatch" && run.totals?.premiumMismatch
              ? ` ${formatCount(run.totals.premiumMismatch)} ${
                  run.totals.premiumMismatch === 1 ? "policy is" : "policies are"
                } ${formatPremium(run.totals.premiumMismatchDelta)} apart in all.`
              : null}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <TableSearchInput
              value={search}
              onValueChange={setSearch}
              placeholder="Policy number, name or Bind ID"
              label="Search rows"
              busy={rows.isFetching}
              className="w-full sm:w-72"
            />
            {filter.producer && (
              <Badge variant="secondary" size="lg" className="gap-1">
                {producerName ?? "Producer"}
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-5"
                  aria-label="Show every producer"
                  onClick={() => onFilterChange({ producer: "", page: 1 })}
                >
                  <X />
                </Button>
              </Badge>
            )}
            <div className="ml-auto">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" disabled={downloading}>
                    <Download aria-hidden />
                    {downloading ? "Preparing…" : "Download"}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => void download("xlsx")}>
                    Every exception (Excel)
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void download("csv")}>
                    Every exception (CSV)
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => void download("xlsx", filter.tab)}
                  >
                    {RECONCILIATION_TAB_LABELS[filter.tab]} only (Excel)
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      }
      isPending={rows.isPending}
      isError={rows.isError}
      isEmpty={(data?.items.length ?? 0) === 0}
      emptyMessage={
        filter.q || filter.producer
          ? "No rows match these filters."
          : "Nothing here — this tab is clear."
      }
      errorMessage="Could not load the rows."
      onRetry={() => void rows.refetch()}
      skeletonRows={8}
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-5">Policy</TableHead>
            <TableHead>Customer</TableHead>
            <TableHead>Product</TableHead>
            <TableHead>Producer</TableHead>
            <TableHead>Bind ID</TableHead>
            <TableHead>Date</TableHead>
            <TableHead className="text-right">Premium</TableHead>
            {showDelta && (
              <TableHead className="text-right">App − Dash</TableHead>
            )}
            <TableHead>Flags</TableHead>
            <TableHead className="pr-5">Review</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data?.items.map((row) => (
            <TableRow
              key={row.id}
              className="cursor-pointer"
              onClick={() => onOpenRow(row)}
            >
              <TableCell className="pl-5 tabular-nums">
                <Button
                  variant="link"
                  className="h-auto p-0 font-medium tabular-nums"
                >
                  {rowPolicyNumber(row)}
                </Button>
              </TableCell>
              <TableCell className="max-w-48 truncate">{rowCustomer(row)}</TableCell>
              <TableCell className="text-muted-foreground">
                {row.dash?.productDescription ?? row.dash?.product ?? row.app?.policyType}
              </TableCell>
              <TableCell>{rowProducer(row)}</TableCell>
              <TableCell className="font-mono text-sm">
                {row.dash?.bindId ?? ""}
              </TableCell>
              <TableCell className="tabular-nums text-muted-foreground">
                {formatDay(row.dash?.dateWritten ?? row.app?.soldDay)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatPremium(row.dash?.writtenPremium ?? row.app?.premium)}
              </TableCell>
              {showDelta && (
                <TableCell className="text-right tabular-nums">
                  {formatPremiumDelta(
                    reconciliationPremiumDelta(row.dash?.writtenPremium, row.app?.premium),
                  )}
                </TableCell>
              )}
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {headlineIssues(row)
                    .slice(0, 2)
                    .map((issue) => (
                      <Tooltip key={issue}>
                        {/* A span takes the trigger's ref; `Badge` cannot. */}
                        <TooltipTrigger asChild>
                          <span tabIndex={0} className="rounded-full">
                            <Badge variant="outline" size="sm">
                              {ISSUE_SHORT_LABELS[issue]}
                            </Badge>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>{issueLabel(issue)}</TooltipContent>
                      </Tooltip>
                    ))}
                </div>
              </TableCell>
              <TableCell className="pr-5">
                {row.needsReview ? (
                  <Badge variant={REVIEW_BADGE[row.review.status]} size="sm">
                    {RECONCILIATION_REVIEW_STATUS_LABELS[row.review.status]}
                  </Badge>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {data && (
        <TablePagination
          page={data.page}
          pageSize={data.pageSize}
          total={data.total}
          totalPages={data.totalPages}
          onPageChange={(page) => onFilterChange({ page })}
          busy={rows.isFetching}
          noun="rows"
          className="border-t border-border px-5 py-3"
        />
      )}
    </DataPanel>
  );
}
