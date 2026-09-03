import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertCircle } from "lucide-react";
import { useMemo } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { MobileNav } from "@/components/layout/MobileNav";
import { Button } from "@/components/ui/button";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { listHouseholds, type ListHouseholdsParams } from "@/lib/households-api";
import { HouseholdCard } from "./components/HouseholdCard";
import { HouseholdsSearch } from "./components/HouseholdsSearch";
import { HouseholdsTable } from "./components/HouseholdsTable";
import { useHouseholdsUrlState } from "./useHouseholdsUrlState";

const PAGE_SIZE = 50;

/**
 * Clients list (PAC-89) — every household in the caller's scope, and the search
 * that finds one from whichever identifier the caller happens to hold.
 *
 * Search, filters, sorting and pagination are all resolved server-side by
 * `GET /households`, so the count in the header is exact rather than "at least
 * this many". The whole query lives in the URL (`useHouseholdsUrlState`), which
 * matters more here than on Leads: the point of this page is to open a record,
 * so every user leaves it and comes back.
 */
export default function HouseholdsListPage() {
  const {
    search,
    filters,
    sort,
    page,
    setSearch,
    patchFilters,
    setSort,
    setPage,
    clearFilters,
  } = useHouseholdsUrlState();

  const debouncedSearch = useDebouncedValue(search, 300);

  const params = useMemo<ListHouseholdsParams>(
    () => ({
      page,
      pageSize: PAGE_SIZE,
      sort,
      q: debouncedSearch.trim() || undefined,
      firstName: filters.firstName.trim() || undefined,
      lastName: filters.lastName.trim() || undefined,
      dateOfBirth: filters.dateOfBirth || undefined,
      householdRef: filters.householdRef.trim() || undefined,
      policyNumber: filters.policyNumber.trim() || undefined,
      status: filters.status.length ? filters.status : undefined,
    }),
    [page, sort, debouncedSearch, filters],
  );

  const { data, isPending, isError, isFetching, refetch } = useQuery({
    queryKey: ["households", params],
    queryFn: () => listHouseholds(params),
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
            <h1 className="text-lg font-semibold tracking-tight">Clients</h1>
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {isPending || isError ? " " : `${total} households`}
            </p>
          </div>
        </div>
      </header>

      <main className="px-4 md:px-6 py-6">
        <HouseholdsSearch
          search={search}
          onSearchChange={setSearch}
          filters={filters}
          onChange={patchFilters}
          onClear={clearFilters}
          sort={sort}
          onSortChange={setSort}
        />

        {isError ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center rounded-xl bg-card border border-border">
            <AlertCircle size={22} className="text-destructive" />
            <p className="text-sm text-muted-foreground">
              Couldn't load households.
            </p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Retry
            </Button>
          </div>
        ) : !isPending && items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-1 py-16 text-center rounded-xl bg-card border border-border">
            <p className="text-sm text-muted-foreground">No households found.</p>
            <p className="text-xs text-muted-foreground">
              Search by a member's name or date of birth, an HH- number, or a
              policy number.
            </p>
          </div>
        ) : (
          <>
            {/* Desktop: the 7-column table — see `HouseholdsTable` for why `lg`. */}
            <div className="hidden lg:block">
              <HouseholdsTable
                households={items}
                isPending={isPending}
                pageSize={PAGE_SIZE}
              />
            </div>

            {/* Phone and tablet: one card per household. */}
            <div className="flex flex-col gap-2 lg:hidden">
              {items.map((household) => (
                <HouseholdCard key={household.id} household={household} />
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
    </AppShell>
  );
}
