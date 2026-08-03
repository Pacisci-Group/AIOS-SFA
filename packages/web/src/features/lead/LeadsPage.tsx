import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { AddLeadButton } from "@/components/leads/AddLeadButton";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/auth-context";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { listLeads, type ListLeadsParams } from "@/lib/leads-api";
import { LeadCard } from "./components/LeadCard";
import { LeadsFilters } from "./components/LeadsFilters";
import { LeadsFilterSheet } from "./components/LeadsFilterSheet";
import { LeadsTable } from "./components/LeadsTable";
import {
  EMPTY_LEAD_FILTERS,
  type LeadFilters,
} from "./components/lead-filters";

/** Legacy Leads page size. */
const PAGE_SIZE = 50;

/**
 * Leads list (PAC-36). Search, filters, sorting and pagination are all resolved
 * server-side by `GET /leads`, so the counts shown here are exact.
 */
export default function LeadsPage() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<LeadFilters>(EMPTY_LEAD_FILTERS);
  const [scope, setScope] = useState<"own" | "agency">("agency");
  const [page, setPage] = useState(1);
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

  // Every change to *what* is being asked for restarts at page 1 — otherwise a
  // narrower result set leaves the user stranded on a page that no longer
  // exists. Done at the setter rather than in an effect so the old page number
  // never reaches the query.
  const patchFilters = (patch: Partial<LeadFilters>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
    setPage(1);
  };

  const changeSearch = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const changeScope = (value: "own" | "agency") => {
    setScope(value);
    setPage(1);
  };

  const clearFilters = () => {
    setFilters(EMPTY_LEAD_FILTERS);
    setPage(1);
  };

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* `AppSidebar` is a fixed 260px and the app shell is not responsive yet,
          so it would eat two-thirds of a phone viewport. Hide it below `md`
          until a mobile nav exists — a shell-wide concern, not this page's. */}
      <div className="hidden md:block">
        <AppSidebar />
      </div>

      <div className="flex-1 min-w-0">
        <header className="flex items-center justify-between gap-4 px-4 md:px-6 py-4 border-b border-border">
          <div>
            <h1 className="text-sm font-bold">Leads</h1>
            <p className="text-[10px] text-muted-foreground uppercase tracking-widest">
              {isPending || isError ? " " : `${total} total`}
            </p>
          </div>
          <AddLeadButton />
        </header>

        <main className="px-4 md:px-6 py-6">
          <LeadsFilters
            search={search}
            onSearchChange={changeSearch}
            filters={filters}
            onChange={patchFilters}
            onOpenAdvanced={() => setAdvancedOpen(true)}
            showScopeToggle={showScopeToggle}
            scope={scope}
            onScopeChange={changeScope}
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
              {/* Desktop: the 7-column table. */}
              <div className="hidden md:block">
                <LeadsTable
                  leads={items}
                  isPending={isPending}
                  pageSize={PAGE_SIZE}
                />
              </div>

              {/* Mobile: one card per lead — the table's columns don't fit. */}
              <div className="flex flex-col gap-2 md:hidden">
                {items.map((lead) => (
                  <LeadCard key={lead.id} lead={lead} />
                ))}
              </div>

              {!isPending && (
                <div className="flex items-center justify-between gap-3 mt-4">
                  <span className="text-xs text-muted-foreground">
                    Showing {firstRow} to {lastRow} of {total}
                  </span>
                  {totalPages > 1 && (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={page <= 1 || isFetching}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                      >
                        Previous
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={page >= totalPages || isFetching}
                        onClick={() =>
                          setPage((p) => Math.min(totalPages, p + 1))
                        }
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
      </div>

      <LeadsFilterSheet
        open={advancedOpen}
        onOpenChange={setAdvancedOpen}
        filters={filters}
        onChange={patchFilters}
        onClear={clearFilters}
        showProducerFilter={showScopeToggle}
      />
    </div>
  );
}
