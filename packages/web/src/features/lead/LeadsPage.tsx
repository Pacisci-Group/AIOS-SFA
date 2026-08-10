import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { AddLeadButton } from "@/components/leads/AddLeadButton";
import { ShareLinkButton } from "@/components/leads/ShareLinkButton";
import { AppShell } from "@/components/layout/AppShell";
import { MobileNav } from "@/components/layout/MobileNav";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/auth-context";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { listLeads, type ListLeadsParams } from "@/lib/leads-api";
import { LeadCard } from "./components/LeadCard";
import { LeadsFilters } from "./components/LeadsFilters";
import { LeadsFilterSheet } from "./components/LeadsFilterSheet";
import { LeadsTable } from "./components/LeadsTable";
import { useLeadsUrlState } from "./useLeadsUrlState";

/** Legacy Leads page size. */
const PAGE_SIZE = 50;

/**
 * Leads list (PAC-36). Search, filters, sorting and pagination are all resolved
 * server-side by `GET /leads`, so the counts shown here are exact.
 *
 * The whole query lives in the URL (`useLeadsUrlState`), so the view survives
 * opening a lead and coming back, a refresh, and being shared.
 */
export default function LeadsPage() {
  const { user } = useAuth();
  const {
    search,
    filters,
    scope,
    page,
    setSearch,
    patchFilters,
    setScope,
    setPage,
    clearFilters,
  } = useLeadsUrlState();
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const debouncedSearch = useDebouncedValue(search, 300);

  // `DataScope` already decides what a user may see; the toggle only lets a
  // manager or owner narrow to their own leads. A producer has nothing to pick.
  const showScopeToggle = user?.dataScope !== "own";

  const params = useMemo<ListLeadsParams>(
    () => ({
      page,
      pageSize: PAGE_SIZE,
      search: debouncedSearch.trim() || undefined,
      status: filters.status.length ? filters.status : undefined,
      temperature: filters.temperature.length ? filters.temperature : undefined,
      leadSource: filters.leadSource || undefined,
      producerId: filters.producerId || undefined,
      dateFrom: filters.dateFrom || undefined,
      dateTo: filters.dateTo || undefined,
      scope: showScopeToggle ? scope : undefined,
    }),
    [page, debouncedSearch, filters, scope, showScopeToggle],
  );

  const { data, isPending, isError, isFetching, refetch } = useQuery({
    queryKey: ["leads", params],
    queryFn: () => listLeads(params),
    // Keep the previous page visible while refetching so the table doesn't
    // flash empty on every keystroke.
    placeholderData: keepPreviousData,
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;
  const firstRow = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastRow = Math.min(page * PAGE_SIZE, total);

  return (
    <AppShell>
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-4 md:gap-4 md:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <MobileNav className="-ml-1" />
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-tight">Leads</h1>
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {isPending || isError ? " " : `${total} total`}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ShareLinkButton />
          <AddLeadButton />
        </div>
      </header>

      <main className="px-4 md:px-6 py-6">
        <LeadsFilters
          search={search}
          onSearchChange={setSearch}
          filters={filters}
          onChange={patchFilters}
          onOpenAdvanced={() => setAdvancedOpen(true)}
          showScopeToggle={showScopeToggle}
          scope={scope}
          onScopeChange={setScope}
        />

        {isError ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center rounded-xl bg-card border border-border">
            <AlertCircle size={22} className="text-amber-500" />
            <p className="text-sm text-muted-foreground">
              Couldn't load leads.
            </p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Retry
            </Button>
          </div>
        ) : !isPending && items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center rounded-xl bg-card border border-border">
            <p className="text-sm text-muted-foreground">No leads found.</p>
          </div>
        ) : (
          <>
            {/* Desktop: the 7-column table — see `LeadsTable` for why `lg`. */}
            <div className="hidden lg:block">
              <LeadsTable
                leads={items}
                isPending={isPending}
                pageSize={PAGE_SIZE}
              />
            </div>

            {/* Phone and tablet: one card per lead — the table's columns don't fit. */}
            <div className="flex flex-col gap-2 lg:hidden">
              {items.map((lead) => (
                <LeadCard key={lead.id} lead={lead} />
              ))}
            </div>

            {!isPending && (
              <div className="flex items-center justify-between gap-3 mt-4">
                <span className="text-sm text-muted-foreground">
                  Showing {firstRow} to {lastRow} of {total}
                </span>
                {totalPages > 1 && (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page <= 1 || isFetching}
                      onClick={() => setPage(Math.max(1, page - 1))}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= totalPages || isFetching}
                      onClick={() => setPage(Math.min(totalPages, page + 1))}
                    >
                      Next
                    </Button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>

      <LeadsFilterSheet
        open={advancedOpen}
        onOpenChange={setAdvancedOpen}
        filters={filters}
        onChange={patchFilters}
        onClear={clearFilters}
        showProducerFilter={showScopeToggle}
      />
    </AppShell>
  );
}
