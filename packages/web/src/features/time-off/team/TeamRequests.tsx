import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertCircle, X } from "lucide-react";
import {
  TEAM_TIME_OFF_REQUEST_GROUPS,
  type TeamTimeOffRequestGroup,
} from "@sfa/shared";
import { FacetChips } from "@/components/common/FacetChips";
import { TablePagination } from "@/components/common/TablePagination";
import { SEARCH_DEBOUNCE_MS, TableSearchInput } from "@/components/common/TableSearchInput";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { listTeamTimeOffRequests, timeOffKeys } from "@/lib/time-off-api";
import { RequestRow } from "../RequestRow";
import { TEAM_GROUP_LABEL } from "../time-off-request-display";

const PAGE_SIZE = 25;
const GROUP_OPTIONS = TEAM_TIME_OFF_REQUEST_GROUPS.map((group) => ({
  value: group,
  label: TEAM_GROUP_LABEL[group],
}));
/** The list a reviewer opens is the work waiting for them. */
const DEFAULT_GROUPS: TeamTimeOffRequestGroup[] = ["pending"];

/**
 * The team's requests (PAC-165, `hr:write`): everyone in the reviewer's
 * data scope — a Branch Manager's branch, an owner's agency — opening on
 * **To review**. The status chips and the name search apply as they
 * change. Never a draft and never the reviewer's own requests: those are
 * theirs to make, not to decide.
 *
 * `employeeId` narrows the list to one person — how the People profile's
 * "Requests" link arrives — and then every status is shown.
 */
export function TeamRequests({
  employeeId,
  onClearEmployee,
  requestPath,
}: {
  employeeId?: string;
  onClearEmployee: () => void;
  requestPath: (requestId: string) => string;
}) {
  const [groups, setGroups] = useState<TeamTimeOffRequestGroup[]>(
    employeeId ? [...TEAM_TIME_OFF_REQUEST_GROUPS] : DEFAULT_GROUPS,
  );
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const q = useDebouncedValue(search, SEARCH_DEBOUNCE_MS).trim();

  const params = {
    // No chip selected reads as "everything", which the API spells out.
    group: groups.length ? groups : [...TEAM_TIME_OFF_REQUEST_GROUPS],
    q: q || undefined,
    employeeId,
    page,
    pageSize: PAGE_SIZE,
  };
  const query = useQuery({
    queryKey: timeOffKeys.team(params),
    queryFn: () => listTeamTimeOffRequests(params),
    placeholderData: keepPreviousData,
  });
  const total = query.data?.total ?? 0;
  const items = query.data?.items ?? [];
  const person = employeeId ? items[0]?.employee?.name : undefined;

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="w-full max-w-sm">
          <TableSearchInput
            value={search}
            onValueChange={(next) => {
              setSearch(next);
              setPage(1);
            }}
            placeholder="Search by name…"
            label="Search the team's requests"
            busy={query.isFetching}
          />
        </div>
        <FacetChips
          label="Filter by status"
          options={GROUP_OPTIONS}
          value={groups}
          onChange={(next) => {
            setGroups(next);
            setPage(1);
          }}
        />
      </div>

      {employeeId && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>{person ? `Showing ${person}'s requests.` : "Showing one person's requests."}</span>
          <Button variant="ghost" size="sm" onClick={onClearEmployee}>
            <X className="size-4" />
            Show everyone
          </Button>
        </div>
      )}

      {query.isError && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>Could not load the team's requests. Try again.</AlertDescription>
        </Alert>
      )}

      {query.isPending ? (
        <div className="grid gap-2">
          <Skeleton className="h-14 w-full rounded-xl" />
          <Skeleton className="h-14 w-full rounded-xl" />
          <Skeleton className="h-14 w-full rounded-xl" />
        </div>
      ) : total === 0 ? (
        <div className="rounded-xl border border-border bg-card px-5 py-12 text-center">
          <p className="text-sm text-muted-foreground">
            {q
              ? "No requests match that name."
              : groups.length === 1 && groups[0] === "pending"
                ? "Nothing to review."
                : "No requests match these filters."}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {items.map((row) => (
            <RequestRow
              key={row.id}
              row={row}
              to={requestPath(row.id)}
              showEmployee
              badgeLabel={TEAM_GROUP_LABEL[row.group]}
            />
          ))}
        </ul>
      )}

      <TablePagination
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        totalPages={Math.max(1, Math.ceil(total / PAGE_SIZE))}
        onPageChange={setPage}
        busy={query.isFetching}
        noun="requests"
      />
    </div>
  );
}
