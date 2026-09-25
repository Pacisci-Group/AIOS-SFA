import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getOwnerSummary,
  ownerDashboardKey,
} from "@/lib/owner-dashboard-api";
import type {
  OwnerClosingRatio,
  OwnerDashboardParams,
  OwnerDashboardSummary,
} from "@/lib/owner-dashboard-api";
import { formatRangeLabel } from "@/lib/date-range";
import {
  comparisonDates,
  comparisonLabel,
  formatCount,
  formatMoney,
  formatMoneyCompact,
  formatPct,
} from "../owner-format";
import { LobMixBar } from "./LobMixBar";
import { OwnerKpiCard } from "./OwnerKpiCard";
import { TrendBadge } from "./TrendBadge";

/** Why a closing ratio is "N/A", in words an owner can act on. */
function closingCaption(ratio: OwnerClosingRatio): string {
  if (ratio.reason === "no_quotes") return "No quotes recorded in this period";
  if (ratio.reason === "too_few_quotes") {
    return "Too few quotes recorded in this period to compare";
  }
  return `${formatMoneyCompact(ratio.soldPremium)} sold / ${formatMoneyCompact(ratio.quotedPremium)} quoted`;
}

/** "vs $1.02M · Aug 1 – Aug 21", or that there is nothing to compare with. */
function premiumCaption(summary: OwnerDashboardSummary): string {
  const { premium, period } = summary;
  if (premium.status === "no_prior_data") {
    return `No data for ${formatRangeLabel(period.previous.from, period.previous.to)}`;
  }
  return `vs ${formatMoneyCompact(premium.previous)} · ${comparisonLabel(period)}`;
}

/**
 * The four KPI cards (PAC-135), from **one** request.
 *
 * One request for the row rather than one per card, for the reason the Producer
 * scorecards give: four figures about the same window must never half-refresh
 * and disagree with each other on screen. The two tables below own their own
 * queries, so a failure there leaves this row standing.
 *
 * `keepPreviousData`: filtering is instant, so the old figures stay up while the
 * new ones load instead of four cards flashing to skeletons on every click.
 */
export function OwnerKpiRow({ params }: { params: OwnerDashboardParams }) {
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: [...ownerDashboardKey, "summary", params],
    queryFn: () => getOwnerSummary(params),
    placeholderData: keepPreviousData,
  });

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card py-10 text-center">
        <AlertCircle aria-hidden className="size-5 text-destructive" />
        <p className="text-sm text-muted-foreground">
          Couldn&rsquo;t load the agency figures.
        </p>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  const loading = isPending || !data;
  const comparedWith = data ? comparisonDates(data.period) : "";
  const badge = (key: "premium" | "items" | "avgPremiumPerHousehold" | "closingRatio") =>
    data ? <TrendBadge trend={data[key]} comparedWith={comparedWith} /> : null;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <OwnerKpiCard
        label="Total bound premium"
        value={formatMoney(data?.premium.current ?? null)}
        caption={data ? premiumCaption(data) : ""}
        badge={badge("premium")}
        isPending={loading}
      />

      <OwnerKpiCard
        label="Items bound / LOB mix"
        value={formatCount(data?.items.current ?? null)}
        caption="Items bound this period"
        badge={badge("items")}
        isPending={loading}
      >
        {data && <LobMixBar mix={data.lobMix} />}
      </OwnerKpiCard>

      <OwnerKpiCard
        label="Avg premium / household"
        value={formatMoney(data?.avgPremiumPerHousehold.current ?? null)}
        caption={
          data?.avgPremiumPerHousehold.current === null
            ? "No households with a sale in this period"
            : "Sold premium per household with a sale"
        }
        badge={badge("avgPremiumPerHousehold")}
        isPending={loading}
      />

      <OwnerKpiCard
        label="Agency closing ratio"
        value={formatPct(data?.closingRatio.current ?? null)}
        caption={data ? closingCaption(data.closingRatio) : ""}
        badge={badge("closingRatio")}
        isPending={loading}
      />
    </div>
  );
}
