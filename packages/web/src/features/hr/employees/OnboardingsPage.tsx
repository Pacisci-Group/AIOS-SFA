import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CalendarDays, UserRoundPlus } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { TablePagination } from "@/components/common/TablePagination";
import {
  SEARCH_DEBOUNCE_MS,
  TableSearchInput,
} from "@/components/common/TableSearchInput";
import { Button } from "@/components/ui/button";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { hrKeys, listEmployees } from "@/lib/hr-api";
import { hrErrorMessage } from "../settings/hr-error";
import { EmployeesTable } from "./components/EmployeesTable";
import { StatusCounts } from "./components/StatusCounts";

const PAGE_SIZE = 25;

/**
 * HR → Onboardings (PAC-162): everyone invited without a leave policy, or
 * caught up by the migration, waiting for an HR admin to pick their policy,
 * schedule and start date. The `hr.onboarding_pending` notification lands
 * here with `?user=` to light up the row.
 *
 * Two empty states, deliberately different: "everyone is onboarded" and
 * "there is no leave policy to onboard anyone onto" — the second is the
 * agency-without-leave state, said plainly with a link to fix it.
 */
export default function OnboardingsPage() {
  const [params] = useSearchParams();
  const highlight = params.get("user");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);

  const listParams = useMemo(
    () => ({
      page,
      pageSize: PAGE_SIZE,
      q: debouncedQuery.trim() || undefined,
      status: ["pending" as const],
    }),
    [page, debouncedQuery],
  );
  const list = useQuery({
    queryKey: hrKeys.employees(listParams),
    queryFn: () => listEmployees(listParams),
    placeholderData: keepPreviousData,
  });

  const data = list.data;
  const noPolicy = data !== undefined && data.activePolicyCount === 0;

  return (
    <SettingsPage
      title="Onboardings"
      caption="HR"
      icon={UserRoundPlus}
      backTo="/"
      width="wide"
      action={
        <Button asChild variant="outline" size="sm">
          <Link to="/hr/employees">All employees</Link>
        </Button>
      }
    >
      <div className="space-y-4">
        {data && <StatusCounts counts={data.counts} active="pending" />}

        <TableSearchInput
          value={query}
          onValueChange={(value) => {
            setQuery(value);
            setPage(1);
          }}
          placeholder="Search by name or email"
          label="Search pending onboardings"
          busy={list.isFetching}
          className="max-w-sm"
        />

        {list.isError ? (
          <p className="text-sm text-destructive">{hrErrorMessage(list.error)}</p>
        ) : noPolicy ? (
          <div className="rounded-xl border border-dashed border-border bg-card p-6">
            <p className="text-sm font-semibold text-card-foreground">
              Create a leave policy before onboarding anyone
            </p>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              {data.counts.pending} {data.counts.pending === 1 ? "person is" : "people are"} waiting,
              but an onboarding puts a person on a policy and the agency has none yet.
              Until it does, HR is a calendar and nothing more.
            </p>
            <Button asChild variant="brand" size="sm" className="mt-4">
              <Link to="/settings/hr?tab=policies">
                <CalendarDays className="size-4" />
                Add a leave policy
              </Link>
            </Button>
          </div>
        ) : data && data.items.length === 0 && !list.isPending ? (
          <div className="rounded-xl border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">
            {debouncedQuery.trim()
              ? "Nobody pending matches that search."
              : "Everyone is onboarded. A new invite without a leave policy lands here."}
          </div>
        ) : (
          <>
            <EmployeesTable
              items={data?.items ?? []}
              isPending={list.isPending}
              variant="onboardings"
              highlightUserId={highlight}
            />
            {data && (
              <TablePagination
                page={data.page}
                pageSize={data.pageSize}
                total={data.total}
                totalPages={data.totalPages}
                onPageChange={setPage}
                busy={list.isFetching}
                noun="people"
              />
            )}
          </>
        )}
      </div>
    </SettingsPage>
  );
}
