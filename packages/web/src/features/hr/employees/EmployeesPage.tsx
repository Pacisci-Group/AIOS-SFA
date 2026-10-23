import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { IdCard, UserRoundPlus } from "lucide-react";
import { Link } from "react-router-dom";
import { EMPLOYEE_PROFILE_STATUSES, type EmployeeProfileStatus } from "@sfa/shared";
import { MultiSelect } from "@/components/common/MultiSelect";
import { TablePagination } from "@/components/common/TablePagination";
import {
  SEARCH_DEBOUNCE_MS,
  TableSearchInput,
} from "@/components/common/TableSearchInput";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SettingsPage } from "@/features/settings/SettingsPage";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { usePermissions } from "@/hooks/usePermissions";
import { useUrlState } from "@/hooks/useUrlState";
import { listBranches } from "@/lib/branches-api";
import { hrKeys, listEmployees, listLeavePolicies } from "@/lib/hr-api";
import { hrErrorMessage } from "../settings/hr-error";
import { EmployeesTable } from "./components/EmployeesTable";
import { StatusCounts } from "./components/StatusCounts";
import { STATUS_LABELS } from "./employee-display";

const PAGE_SIZE = 25;
const ALL_STATUSES = EMPLOYEE_PROFILE_STATUSES.map((s) => ({
  value: s,
  label: STATUS_LABELS[s],
}));
const ANY = "__any__";

/**
 * HR → Employees (PAC-162): every profile, with real-time facets on status,
 * branch and policy and a search over name and email — no Apply button, the
 * product rule. Facets ride in the URL so a filtered list can be shared.
 */
export default function EmployeesPage() {
  const { can } = usePermissions();
  const [filters, setFilters] = useUrlState({
    defaults: { status: [] as string[], branch: "", policy: "" },
  });
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);

  const listParams = useMemo(
    () => ({
      page,
      pageSize: PAGE_SIZE,
      q: debouncedQuery.trim() || undefined,
      status: filters.status.filter((s): s is EmployeeProfileStatus =>
        (EMPLOYEE_PROFILE_STATUSES as readonly string[]).includes(s),
      ),
      branchId: filters.branch || undefined,
      leavePolicyId: filters.policy || undefined,
    }),
    [page, debouncedQuery, filters],
  );
  const list = useQuery({
    queryKey: hrKeys.employees(listParams),
    queryFn: () => listEmployees(listParams),
    placeholderData: keepPreviousData,
  });
  const branches = useQuery({
    queryKey: ["branches"],
    queryFn: listBranches,
    enabled: can("agency:branches:read"),
    retry: false,
  });
  const policies = useQuery({ queryKey: hrKeys.policies, queryFn: listLeavePolicies });

  const data = list.data;

  return (
    <SettingsPage
      title="Employees"
      caption="HR"
      icon={IdCard}
      backTo="/"
      width="wide"
      action={
        <Button asChild variant="outline" size="sm">
          <Link to="/hr/onboardings">
            <UserRoundPlus className="size-4" />
            Onboardings
          </Link>
        </Button>
      }
    >
      <div className="space-y-4">
        {data && <StatusCounts counts={data.counts} />}

        <div className="flex flex-wrap items-center gap-2">
          <TableSearchInput
            value={query}
            onValueChange={(value) => {
              setQuery(value);
              setPage(1);
            }}
            placeholder="Search by name or email"
            label="Search employees"
            busy={list.isFetching}
            className="w-full sm:max-w-xs"
          />
          <MultiSelect
            options={ALL_STATUSES}
            value={filters.status}
            onChange={(status) => {
              setFilters({ status });
              setPage(1);
            }}
            placeholder="All statuses"
            summarize={(n) => `${n} statuses`}
          />
          {(branches.data?.length ?? 0) > 0 && (
            <Select
              value={filters.branch || ANY}
              onValueChange={(value) => {
                setFilters({ branch: value === ANY ? "" : value });
                setPage(1);
              }}
            >
              <SelectTrigger aria-label="Filter by branch" className="w-44 bg-card border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>All branches</SelectItem>
                {branches.data!.map((branch) => (
                  <SelectItem key={branch._id} value={branch._id}>
                    {branch.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {(policies.data?.policies.length ?? 0) > 0 && (
            <Select
              value={filters.policy || ANY}
              onValueChange={(value) => {
                setFilters({ policy: value === ANY ? "" : value });
                setPage(1);
              }}
            >
              <SelectTrigger aria-label="Filter by leave policy" className="w-48 bg-card border-border">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>All policies</SelectItem>
                {policies.data!.policies.map((policy) => (
                  <SelectItem key={policy.id} value={policy.id}>
                    {policy.name}
                    {policy.status === "archived" ? " (archived)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {list.isError ? (
          <p className="text-sm text-destructive">{hrErrorMessage(list.error)}</p>
        ) : data && data.items.length === 0 && !list.isPending ? (
          <div className="rounded-xl border border-dashed border-border bg-card p-6 text-sm text-muted-foreground">
            {data.total === 0 && !debouncedQuery && filters.status.length === 0
              ? "No employee profiles yet. Inviting someone creates one."
              : "Nobody matches these filters."}
          </div>
        ) : (
          <>
            <EmployeesTable
              items={data?.items ?? []}
              isPending={list.isPending}
              variant="employees"
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
