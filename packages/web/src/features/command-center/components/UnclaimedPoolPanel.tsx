import { useQuery } from "@tanstack/react-query";
import { AgencyPermission } from "@sfa/shared";
import { Badge } from "@/components/ui/badge";
import { DataPanel } from "@/components/common/DataPanel";
import { usePermissions } from "@/hooks/usePermissions";
import { listUnclaimedLeads, unclaimedLeadsKey } from "@/lib/leads-api";
import { relativeTime } from "@/lib/relative-time";
import { poolGridColumns, UnclaimedPoolRow } from "./UnclaimedPoolRow";

/**
 * How many rows the pool draws. The endpoint caps at 50; the panel asks for a
 * screenful and lets `total` carry the rest, so a 200-lead backlog does not
 * become a 200-row scroll on a dashboard.
 */
const PANEL_SIZE = 10;

/** Refetch cadence for the pool — see the docblock on the polling below. */
const POLL_MS = 30_000;

/**
 * The Unclaimed Agency Leads Pool (PAC-138).
 *
 * ## This shows work the viewer does not own
 *
 * Every other lead list in the app is scoped to the signed-in user. This one is
 * agency-wide by design: a pool nobody can look into distributes nothing. The
 * API pays for that by withholding contact details from anyone who could not
 * open the lead anyway — see `GET /leads/unclaimed`.
 *
 * ## Who can act on a row
 *
 * Assignment needs `leads:write` **and** `agency:users:read` — Agency Owner and
 * Branch Manager. Checked once here rather than inside each row: a per-row check
 * would run the same two lookups for every lead and, worse, invite a future row
 * to answer the question differently from its own header.
 *
 * A producer sees the pool and **no claim control at all**. That is not an
 * oversight and it is not a disabled button: self-service claiming is a request
 * an owner or manager approves, and the `leadAccessRequests` collection it needs
 * is PAC-59's, extended by PAC-105. Neither is built. A button that looked
 * actionable and filed nothing would be worse than its absence.
 */
export function UnclaimedPoolPanel() {
  const { can, canWrite } = usePermissions();
  const canAssign = canWrite("leads") && can(AgencyPermission.UsersRead);

  const pool = useQuery({
    queryKey: unclaimedLeadsKey(PANEL_SIZE),
    queryFn: () => listUnclaimedLeads({ limit: PANEL_SIZE }),
    /*
     * The prototype claimed a "Live Feed Active" websocket. This is polling,
     * and it is labelled as polling: the pool changes when somebody else's
     * intake lands or another manager assigns a row, neither of which this tab
     * can hear about.
     *
     * `refetchIntervalInBackground` stays off (the default) so a dashboard left
     * open on a second monitor is not a request every 30 seconds all night.
     */
    refetchInterval: POLL_MS,
  });

  const items = pool.data?.items ?? [];
  const total = pool.data?.total ?? 0;

  return (
    <DataPanel
      title="Unclaimed Agency Leads Pool"
      subheading={
        <div className="flex items-center gap-2">
          {total > 0 && (
            <Badge size="sm" className="bg-primary text-primary-foreground">
              {total} waiting
            </Badge>
          )}
          <span className="text-xs text-muted-foreground">
            {/* Honest about staleness: `dataUpdatedAt` is when this answer came
                back, not when the poll is next due. `…` rather than N/A while
                the first request is in flight — the label's width must not
                jump. */}
            {pool.isPending
              ? "Updating…"
              : `Updated ${relativeTime(new Date(pool.dataUpdatedAt).toISOString())}`}
          </span>
        </div>
      }
      isPending={pool.isPending}
      isError={pool.isError}
      isEmpty={items.length === 0}
      emptyMessage="Every lead in the agency has an owner."
      errorMessage="Couldn't load the unclaimed pool."
      onRetry={() => void pool.refetch()}
      skeletonRows={PANEL_SIZE}
    >
      <div>
        <div
          className="grid gap-4 border-b border-border bg-sunken px-4 py-2.5 text-xs uppercase tracking-wide text-muted-foreground md:px-5"
          style={{ gridTemplateColumns: poolGridColumns(canAssign) }}
        >
          <span>Lead</span>
          <span>Source</span>
          <span>Phone</span>
          <span>Waiting</span>
          {canAssign && <span className="text-right">Assign</span>}
        </div>

        {items.map((lead, index) => (
          <UnclaimedPoolRow
            key={lead.id}
            lead={lead}
            isLast={index === items.length - 1}
            canAssign={canAssign}
          />
        ))}

        {total > items.length && (
          <p className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground md:px-5">
            Showing the {items.length} longest-waiting of {total}.
          </p>
        )}
      </div>
    </DataPanel>
  );
}
