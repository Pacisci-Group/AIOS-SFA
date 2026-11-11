import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ClipboardCheck } from "lucide-react";
import { useEffect, useMemo } from "react";
import { DataPanel } from "@/components/common/DataPanel";
import { FilterToggles } from "@/components/common/FilterToggles";
import { TablePagination } from "@/components/common/TablePagination";
import { SEARCH_DEBOUNCE_MS } from "@/components/common/TableSearchInput";
import { AppShell } from "@/components/layout/AppShell";
import { MobileNav } from "@/components/layout/MobileNav";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  dealAuditQueueKey,
  dealAuditQueueOptionsKey,
  getDealAuditQueueOptions,
  listDealAuditQueue,
  type DealAuditQueueStatus,
  type ListDealAuditQueueParams,
} from "@/lib/deal-audits-api";
import { DealAuditQueueFilters } from "./components/DealAuditQueueFilters";
import { DealAuditQueueTable } from "./components/DealAuditQueueTable";
import { QUEUE_STATUS_OPTIONS } from "@/components/audit/review-display";
import { useDealAuditsUrlState } from "./useDealAuditsUrlState";

const PAGE_SIZE = 25;

/** Said when a chip has nothing in it — a sentence, not an empty table. */
const EMPTY_MESSAGES: Record<DealAuditQueueStatus, string> = {
  open: "Every audit in your reach has been approved.",
  not_submitted: "No audits are waiting on a producer to submit.",
  pending: "Nothing is waiting for review.",
  fail: "No audits are sent back right now.",
  pass: "No audits have been approved yet.",
  all: "No sold deals have an audit yet.",
};

/**
 * `/deal-audits` — the manager's queue (PAC-106).
 *
 * One row per sold deal, longest-waiting first, with how many **business
 * days** it has sat since the sale (PAC-139's clock — past five it is aging).
 * Defaults to everything not yet approved: an audit the producer has not
 * submitted is still ageing, and the manager needs to see it, even though
 * only a `Pending` one can be worked (**Perform audit**).
 *
 * Search, filters and sort (20 Oct 2026) sit under the chips: a client,
 * producer or policy number; producers, line of business, aging only and the
 * sold-date period; four orders. All in the URL, all instant.
 *
 * Gated in `App.tsx` on `management:read` **and** `deal_audits:*`, the same
 * pair the API requires — "management roles only" is the capability, never
 * a role name.
 */
export default function DealAuditsQueuePage() {
  const state = useDealAuditsUrlState();
  const { status, page, setStatus, setPage } = state;
  // The box writes the URL on every keystroke; the request waits for a pause.
  const debouncedSearch = useDebouncedValue(state.search, SEARCH_DEBOUNCE_MS);

  const params = useMemo<ListDealAuditQueueParams>(
    () => ({
      status,
      q: debouncedSearch.trim() || undefined,
      producerIds: state.producerIds,
      policyTypes: state.policyTypes,
      aging: state.aging,
      range: state.range.key,
      from: state.range.from,
      to: state.range.to,
      sort: state.sort,
      page,
      pageSize: PAGE_SIZE,
    }),
    [
      status,
      debouncedSearch,
      state.producerIds,
      state.policyTypes,
      state.aging,
      state.range,
      state.sort,
      page,
    ],
  );

  const { data, isPending, isFetching, isError, refetch } = useQuery({
    queryKey: dealAuditQueueKey(params),
    queryFn: () => listDealAuditQueue(params),
    // Keeps the current rows on screen while a filter change is in flight,
    // instead of flashing the empty state between keystrokes.
    placeholderData: keepPreviousData,
  });

  const options = useQuery({
    queryKey: dealAuditQueueOptionsKey,
    queryFn: getDealAuditQueueOptions,
    staleTime: 5 * 60_000,
  });

  // `debouncedSearch`, not the raw box: keyed off the input, the copy would
  // flip before the request that justifies it has fired.
  const filtered = state.activeCount > 0 || debouncedSearch.trim().length > 0;

  // A page past the end — after an approval emptied the last one, or from a
  // stale URL — falls back to the last page that exists.
  useEffect(() => {
    if (data && page > data.totalPages) setPage(data.totalPages);
  }, [data, page, setPage]);

  const rows = data?.items ?? [];

  return (
    <AppShell>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4 md:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <MobileNav className="-ml-1" />
          <ClipboardCheck aria-hidden className="size-5 shrink-0 text-primary" />
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-tight">Deal audits</h1>
            <p className="truncate text-sm text-muted-foreground">
              Every sale's audit, and how long it has been waiting
            </p>
          </div>
        </div>
      </header>

      <main className="px-4 py-6 md:px-6">
        <div className="mx-auto w-full max-w-6xl space-y-4">
          {/* Six chips do not fit a phone; the row scrolls rather than wraps,
              so the segmented look holds. */}
          <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
            <FilterToggles
              label="Filter audits by status"
              options={QUEUE_STATUS_OPTIONS}
              value={status}
              onChange={setStatus}
              className="w-max min-w-full md:w-full"
            />
          </div>

          <DealAuditQueueFilters
            state={state}
            producers={options.data?.producers ?? []}
            busy={isFetching && !isPending}
          />

          <DataPanel
            title="Deal audits"
            subheading={
              data ? (
                <span className="text-sm text-muted-foreground tabular-nums">
                  {data.total.toLocaleString()}{" "}
                  {data.total === 1 ? "deal" : "deals"}
                </span>
              ) : undefined
            }
            isPending={isPending}
            isError={isError}
            isEmpty={rows.length === 0}
            emptyMessage={
              filtered ? "No deals match these filters." : EMPTY_MESSAGES[status]
            }
            errorMessage="Couldn't load the deal audits."
            onRetry={() => void refetch()}
            skeletonRows={6}
          >
            <DealAuditQueueTable rows={rows} />
            <TablePagination
              page={page}
              pageSize={PAGE_SIZE}
              total={data?.total ?? 0}
              totalPages={data?.totalPages ?? 1}
              onPageChange={setPage}
              busy={isFetching}
              noun="deals"
              className="border-t border-border px-5 py-3"
            />
          </DataPanel>
        </div>
      </main>
    </AppShell>
  );
}
