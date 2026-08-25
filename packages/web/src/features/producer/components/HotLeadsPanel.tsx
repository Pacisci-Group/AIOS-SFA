import { AlertCircle, Star } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { listHotLeads } from "@/lib/leads-api";
import { HotLeadRow } from "./HotLeadRow";

/** Matches the API default; named so the skeleton count cannot drift from it. */
const PANEL_SIZE = 5;

/**
 * Priority Contact List (PAC-15).
 *
 * Ordered **stalest first** — the inverse of the Leads page. The lead you last
 * spoke to is the one who least needs a call, so the row at the top is the one
 * that has gone longest without contact. Hot leads always outrank Warm ones;
 * the panel tops up with Warm only when a producer has fewer than five Hot.
 *
 * Not paginated by design: it is a fixed-size card, and the API returns a bare
 * `{ items }` rather than a page envelope for that reason.
 */
export function HotLeadsPanel() {
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["hot-leads", PANEL_SIZE],
    queryFn: () => listHotLeads({ limit: PANEL_SIZE }),
  });

  const items = data?.items ?? [];

  return (
    // `xl:h-0 xl:min-h-full`: beside the hand-off board this card must fill the
    // grid row without *driving* it. The board is structurally taller (column
    // headers + pagination around the same body height), so a stretched card
    // with a fixed-height body left dead space below the list. Zero height
    // contributes nothing to the row; `min-h-full` then fills whatever the
    // board sized it to.
    <Card className="flex flex-col rounded-xl overflow-hidden p-0 gap-0 bg-card border-border xl:h-0 xl:min-h-full">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-4 md:px-5">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-5 rounded-full bg-red-400" />
          <h2 className="text-sm text-foreground font-semibold">
            Priority Contact List
          </h2>
        </div>
        <Badge className="bg-red-400/12 text-red-400 border-transparent rounded-full text-xs font-bold gap-1">
          <Star size={10} fill="currentColor" />
          Hot Leads
        </Badge>
      </div>

      {/* Stacked (below `xl`) the card is content-sized, so the list keeps its
          own cap; side-by-side it flexes to the bottom of the card instead. */}
      <div className="flex flex-col gap-0 overflow-y-auto max-h-[360px] xl:max-h-none xl:flex-1 xl:min-h-0">
        {isPending ? (
          Array.from({ length: PANEL_SIZE }).map((_, i) => (
            <div
              key={i}
              className="flex items-start gap-3 border-b border-border px-4 py-4 md:px-5"
            >
              <Skeleton className="h-9 w-9 rounded-full shrink-0" />
              <div className="flex-1">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-56 mt-2" />
                <Skeleton className="h-7 w-48 mt-3 rounded-lg" />
              </div>
            </div>
          ))
        ) : isError ? (
          <div className="flex flex-col items-center justify-center gap-3 py-14 text-center">
            <AlertCircle size={22} className="text-amber-500" />
            <p className="text-sm text-muted-foreground">
              Couldn&rsquo;t load your hot leads.
            </p>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              Retry
            </Button>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 text-center">
            <p className="text-sm text-muted-foreground">
              No hot leads right now.
            </p>
          </div>
        ) : (
          items.map((lead, i) => (
            <HotLeadRow
              key={lead.id}
              lead={lead}
              isLast={i === items.length - 1}
            />
          ))
        )}
      </div>
    </Card>
  );
}
