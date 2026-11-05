import { useQuery } from "@tanstack/react-query";
import { AlertCircle } from "lucide-react";
import {
  MY_TIME_OFF_REQUEST_GROUPS,
  type TimeOffRequestGroup,
  type TimeOffRequestRow,
} from "@sfa/shared";
import { SectionLabel } from "@/components/common/DetailCard";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { listMyTimeOffRequests, timeOffKeys } from "@/lib/time-off-api";
import { RequestRow } from "../RequestRow";
import { MY_GROUP_HEADING } from "../time-off-request-display";

/** One page is the whole list for anyone but a long-serving heavy user. */
const PARAMS = { pageSize: 100 } as const;

/**
 * The employee's own requests (PAC-165), filed under what each needs:
 * **Changes requested** first — it is the one waiting on them — then
 * Drafts, Pending, Approved, Taken, Declined, Cancelled, and anything
 * imported from SmartSuite last. Empty groups are not drawn. *Taken* is
 * approved leave whose dates have passed; the server derives it.
 */
export function MyRequests({ requestPath }: { requestPath: (requestId: string) => string }) {
  const query = useQuery({
    queryKey: timeOffKeys.mine(PARAMS),
    queryFn: () => listMyTimeOffRequests(PARAMS),
  });

  if (query.isPending) {
    return (
      <div className="grid gap-2">
        <Skeleton className="h-14 w-full rounded-xl" />
        <Skeleton className="h-14 w-full rounded-xl" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <Alert variant="destructive">
        <AlertCircle />
        <AlertDescription>Could not load your requests. Try again.</AlertDescription>
      </Alert>
    );
  }

  const byGroup = new Map<TimeOffRequestGroup, TimeOffRequestRow[]>();
  for (const row of query.data.items) {
    byGroup.set(row.group, [...(byGroup.get(row.group) ?? []), row]);
  }
  if (byGroup.size === 0) {
    return (
      <div className="rounded-xl border border-border bg-card px-5 py-10 text-center">
        <p className="text-sm text-muted-foreground">
          No requests yet. Use Request time off on a policy above.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      {MY_TIME_OFF_REQUEST_GROUPS.filter((group) => byGroup.has(group)).map((group) => {
        const rows = byGroup.get(group) ?? [];
        return (
          <section key={group}>
            <SectionLabel className="mb-2">
              {MY_GROUP_HEADING[group]} · {rows.length}
            </SectionLabel>
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
              {rows.map((row) => (
                <RequestRow key={row.id} row={row} to={requestPath(row.id)} />
              ))}
            </ul>
          </section>
        );
      })}
      {query.data.total > query.data.items.length && (
        <p className="text-sm text-muted-foreground">
          Showing your {query.data.items.length} most recent requests.
        </p>
      )}
    </div>
  );
}
