import { ModuleKey } from "@sfa/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AvailabilityBadge } from "@/components/common/AvailabilityBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  DrawerError,
  DrawerSection,
  DrawerSkeleton,
  shortDate,
} from "@/features/clients/components/drawer-primitives";
import { statusBadgeClass } from "@/features/lead/components/lead-display";
import {
  formatCount,
  formatMoney,
  formatPct,
} from "@/features/owner-dashboard/owner-format";
import { usePermissions } from "@/hooks/usePermissions";
import type { DashboardFilterParams } from "@/lib/dashboard-filter-params";
import {
  getProducerDrawer,
  managementDashboardKey,
} from "@/lib/management-dashboard-api";
import type {
  ProducerOpenAuditItem,
  ProducerPipelineLead,
  TeamActivityStats,
} from "@/lib/management-dashboard-api";
import { NOT_AVAILABLE } from "@/lib/not-available";
import { cn } from "@/lib/utils";

/**
 * The producer drawer (PAC-139 §4): what a Team Activity row opens.
 *
 * Header, then the **same four figures with the same labels** as the row (so
 * the two can never disagree), then the **Active Pipeline** — the households
 * the producer is working on, with the lead's own Status field as the stage
 * ("go to your status field … those are your stat[us]", David 00:24:04) — and
 * the **open audit items** the column counts, one row each.
 *
 * The mockup's "Pending Action Items" ("Follow up: quote expiring", …) were
 * fixtures for a to-do list that never existed; the open items are the real
 * thing. Each opens the household until the Deal Audit page ships (PAC-106).
 */
export function ProducerDrawer({
  producerId,
  params,
  onClose,
}: {
  producerId: string | null;
  params: DashboardFilterParams;
  onClose: () => void;
}) {
  const query = useQuery({
    queryKey: [...managementDashboardKey, "producer", producerId, params],
    queryFn: () => getProducerDrawer(producerId!, params),
    enabled: producerId !== null,
  });
  const data = query.data;

  return (
    <Sheet open={producerId !== null} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 border-l border-border p-0 sm:w-[480px] sm:max-w-[480px]"
      >
        <SheetHeader className="shrink-0 border-b border-border px-5 py-4">
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/12 text-sm font-semibold text-primary"
            >
              {data?.producer.initials ?? "…"}
            </span>
            <div className="min-w-0">
              <SheetTitle className="truncate">
                {data?.producer.name ?? "Producer"}
              </SheetTitle>
              <SheetDescription className="mt-0.5 flex items-center gap-2">
                {data ? (
                  <AvailabilityBadge value={data.producer.availability} />
                ) : (
                  "Loading…"
                )}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {query.isPending && <DrawerSkeleton />}
          {query.isError && (
            <div className="space-y-3">
              <DrawerError message="Couldn't load this producer." />
              <Button
                variant="outline"
                size="sm"
                onClick={() => void query.refetch()}
              >
                Try again
              </Button>
            </div>
          )}
          {data && (
            <>
              <StatsStrip stats={data.stats} />

              <DrawerSection title={`Active pipeline (${data.activePipeline.length})`}>
                {data.activePipeline.length === 0 ? (
                  <p className="py-4 text-sm text-muted-foreground">
                    No open leads in this period.
                  </p>
                ) : (
                  <ul className="divide-y divide-border">
                    {data.activePipeline.map((lead) => (
                      <PipelineItem key={lead.leadId} lead={lead} />
                    ))}
                  </ul>
                )}
              </DrawerSection>

              <DrawerSection title={`Open audit items (${data.openAuditItems.length})`}>
                {data.openAuditItems.length === 0 ? (
                  <p className="py-4 text-sm text-muted-foreground">
                    Nothing outstanding on this producer&rsquo;s audits.
                  </p>
                ) : (
                  <ul className="divide-y divide-border">
                    {data.openAuditItems.map((item) => (
                      <OpenItem key={`${item.dealAuditId}:${item.itemTitle}`} item={item} />
                    ))}
                  </ul>
                )}
              </DrawerSection>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** The row's four figures, with the row's four labels. */
function StatsStrip({ stats }: { stats: TeamActivityStats }) {
  const tiles = [
    { label: "Households quoted", value: formatCount(stats.householdsQuoted) },
    { label: "Households sold", value: formatCount(stats.householdsSold) },
    { label: "Household close ratio", value: formatPct(stats.householdCloseRatio) },
    { label: "Open audit items", value: formatCount(stats.openAuditItems) },
  ];
  return (
    <dl className="grid grid-cols-2 gap-2">
      {tiles.map((tile) => (
        <div key={tile.label} className="rounded-md bg-sunken px-3 py-2">
          <dt className="text-xs text-muted-foreground">{tile.label}</dt>
          <dd className="text-lg font-semibold tabular-nums">{tile.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function PipelineItem({ lead }: { lead: ProducerPipelineLead }) {
  const { canRead } = usePermissions();
  const name = canRead(ModuleKey.Leads) ? (
    <Link
      to={`/leads/${lead.leadId}`}
      className="truncate font-medium text-foreground underline-offset-4 hover:underline"
    >
      {lead.name}
    </Link>
  ) : (
    <span className="truncate font-medium text-foreground">{lead.name}</span>
  );
  return (
    <li className="flex items-center justify-between gap-3 py-2.5">
      <div className="min-w-0">
        {name}
        <p className="truncate text-xs text-muted-foreground">
          {lead.lineOfBusiness ?? NOT_AVAILABLE} · {lead.ageDays}d old
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <Badge
          size="sm"
          className={cn("border-transparent", statusBadgeClass(lead.status))}
        >
          {lead.status}
        </Badge>
        <span className="text-xs text-muted-foreground tabular-nums">
          {formatMoney(lead.value)}
        </span>
      </div>
    </li>
  );
}

function OpenItem({ item }: { item: ProducerOpenAuditItem }) {
  const { canRead } = usePermissions();
  const name =
    item.householdId && canRead(ModuleKey.Clients) ? (
      <Link
        to={`/clients/${item.householdId}`}
        className="truncate font-medium text-foreground underline-offset-4 hover:underline"
      >
        {item.clientName}
      </Link>
    ) : (
      <span className="truncate font-medium text-foreground">{item.clientName}</span>
    );
  return (
    <li className="flex items-center justify-between gap-3 py-2.5">
      <div className="min-w-0">
        {name}
        <p className="truncate text-xs text-muted-foreground">
          {item.itemTitle} · sold {shortDate(item.soldDate)}
        </p>
      </div>
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
        {item.daysOpen}d open
      </span>
    </li>
  );
}
