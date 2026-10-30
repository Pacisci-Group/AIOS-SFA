import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ModuleKey,
  primaryReconciliationTab,
  RECONCILIATION_TAB_LABELS,
} from "@sfa/shared";
import { DataPanel } from "@/components/common/DataPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  apiErrorStatus,
  outcomeBadgeVariant,
  outcomeNextStep,
  rowCustomer,
  rowPolicyNumber,
} from "@/features/reconciliation/reconciliation-format";
import { usePermissions } from "@/hooks/usePermissions";
import {
  getAssignedReconciliationRows,
  reconciliationAssignedListKey,
} from "@/lib/carrier-reconciliation-api";
import { NOT_AVAILABLE } from "@/lib/not-available";
import { cn } from "@/lib/utils";

/** A screenful; `total` carries the rest, and "View all" opens the page. */
const PANEL_PARAMS = { page: 1, pageSize: 5 };

/**
 * Shared by the column header and the rows. Below `sm` the header is hidden
 * and the customer moves under the policy number, so a phone keeps two
 * readable columns instead of three cramped ones.
 */
const GRID =
  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_11rem]";

/**
 * Dash follow-ups (PAC-173): the Dash Reconciliation rows assigned to the
 * signed-in Producer or CSR, oldest first, each opening on
 * `/reconciliation/assigned`.
 *
 * **Renders nothing** until there is something to say: while loading, when
 * nothing is assigned, and on a 403 — the agency does not use the module, or
 * the viewer holds neither `carrier_reconciliation:read` nor `leads:read` (in
 * which case it does not ask at all). A dashboard panel that only ever reads
 * "nothing here" is noise. It lays out its own padding for the same reason:
 * the page keeps no empty wrapper when it is gone.
 *
 * Its own block between the scorecards and the 60/40 workspace grid rather
 * than a third child of that grid, whose two panels size each other.
 *
 * A row whose outcome is under way (PAC-173 PR 4) carries a second badge under
 * its reason — "Sold — in progress", "Write the replacement" — so a half-done
 * one reads as the next thing to pick up.
 */
export function DashFollowUpsPanel() {
  const { canAny } = usePermissions();
  const canAsk = canAny([
    `${ModuleKey.CarrierReconciliation}:read`,
    `${ModuleKey.Leads}:read`,
  ]);

  const assigned = useQuery({
    queryKey: reconciliationAssignedListKey(PANEL_PARAMS),
    queryFn: () => getAssignedReconciliationRows(PANEL_PARAMS),
    enabled: canAsk,
    retry: false,
  });

  if (assigned.isPending) return null;
  if (assigned.isError && apiErrorStatus(assigned.error) === 403) return null;
  if (assigned.data?.total === 0) return null;

  const items = assigned.data?.items ?? [];
  const total = assigned.data?.total ?? 0;

  return (
    <div className="px-4 pb-4 md:px-6">
      <DataPanel
        title="Dash follow-ups"
        subheading={
          <div className="flex items-center justify-between gap-2 pt-1">
            {total > 0 ? (
              <Badge size="sm">{total} assigned to you</Badge>
            ) : (
              <span />
            )}
            <Button asChild variant="link" size="sm" className="h-auto px-0">
              <Link to="/reconciliation/assigned">View all</Link>
            </Button>
          </div>
        }
        isPending={false}
        isError={assigned.isError}
        isEmpty={false}
        emptyMessage=""
        errorMessage="Couldn't load your Dash follow-ups."
        onRetry={() => void assigned.refetch()}
        skeletonRows={PANEL_PARAMS.pageSize}
      >
        <div>
          <div
            className={cn(
              GRID,
              "hidden border-b border-border bg-sunken px-4 py-2.5 text-xs uppercase tracking-wide text-muted-foreground sm:grid md:px-5",
            )}
          >
            <span>Policy</span>
            <span>Customer</span>
            <span>Why</span>
          </div>

          {items.map((row, index) => {
            const tab = primaryReconciliationTab(row.tabs);
            return (
              <div
                key={row.id}
                className={cn(
                  GRID,
                  "px-4 py-3 transition-colors hover:bg-muted/50 md:px-5",
                  index < items.length - 1 && "border-b border-border",
                )}
              >
                <div className="min-w-0">
                  <Button
                    asChild
                    variant="link"
                    className="h-auto max-w-full justify-start p-0 font-medium tabular-nums"
                  >
                    <Link to={`/reconciliation/assigned?row=${row.id}`}>
                      <span className="truncate">{rowPolicyNumber(row)}</span>
                    </Link>
                  </Button>
                  <p className="truncate text-sm text-muted-foreground sm:hidden">
                    {rowCustomer(row)}
                  </p>
                </div>
                <span className="hidden truncate text-sm sm:block">
                  {rowCustomer(row)}
                </span>
                <span className="flex flex-col items-end gap-1 justify-self-end sm:items-start sm:justify-self-start">
                  {tab ? (
                    <Badge variant="secondary" size="sm">
                      {RECONCILIATION_TAB_LABELS[tab]}
                    </Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {NOT_AVAILABLE}
                    </span>
                  )}
                  {row.outcome && (
                    <Badge
                      variant={outcomeBadgeVariant(row.outcome)}
                      size="sm"
                    >
                      {outcomeNextStep(row.outcome)}
                    </Badge>
                  )}
                </span>
              </div>
            );
          })}

          {total > items.length && (
            <p className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground md:px-5">
              Showing {items.length} of {total}, oldest first.
            </p>
          )}
        </div>
      </DataPanel>
    </div>
  );
}
