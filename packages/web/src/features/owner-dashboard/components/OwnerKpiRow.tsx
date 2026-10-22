import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getOwnerSummary,
  ownerDashboardKey,
} from "@/lib/owner-dashboard-api";
import type {
  OwnerBlendedClosingRatio,
  OwnerDashboardParams,
  OwnerDashboardSummary,
  OwnerUnsoldQuotesClosed,
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
import { KpiCard as OwnerKpiCard } from "@/components/common/KpiCard";
import { TrendBadge } from "@/components/common/TrendBadge";

/** "11 of 23 quotes sold". */
function quotesSold(ratio: OwnerBlendedClosingRatio): string {
  const { sold, written } = ratio.quote;
  return `${formatCount(sold)} of ${formatCount(written)} quotes sold`;
}

/**
 * Which two figures the headline averages, or — when it is one of them, or
 * neither — why, in words an owner can act on.
 */
function closingCaption(ratio: OwnerBlendedClosingRatio): string {
  switch (ratio.basis) {
    case "both":
      return `Premium ${formatPct(ratio.premium.current)} · Quote ${formatPct(ratio.quote.current)} (${quotesSold(ratio)})`;
    case "quote":
      return ratio.premium.reason === "too_few_quotes"
        ? `Quote only · ${quotesSold(ratio)} · too few quotes for a premium ratio`
        : `Quote only · ${quotesSold(ratio)}`;
    case "premium":
      return `Premium only · ${formatMoneyCompact(ratio.premium.soldPremium)} sold / ${formatMoneyCompact(ratio.premium.quotedPremium)} quoted`;
    case "none":
      return ratio.reason === "too_few_quotes"
        ? "Too few quotes recorded in this period to compare"
        : "No quotes recorded in this period";
  }
}

/** "$12.4K premium · 18% of 56 open at the start", or why there is no rate. */
function unsoldCaption(card: OwnerUnsoldQuotesClosed): string {
  if (card.backlogAtStart === 0) return "No open quotes at the start of this period";
  return `${formatMoneyCompact(card.recoveredPremium)} premium · ${formatPct(card.ratePct)} of ${formatCount(card.backlogAtStart)} open at the start`;
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
 * The five KPI cards (PAC-135; the closing ratio's average and Unsold Quotes
 * Closed, Oct 2026), from **one** request.
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
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
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

      {/*
       * Quotes from before the period that sold in it — the figure behind
       * "we closed 30% more unsold quotes this month". Spans two columns where
       * it would otherwise sit alone on its row.
       */}
      <OwnerKpiCard
        label="Unsold quotes closed"
        value={formatCount(data?.unsoldQuotesClosed.recovered.current ?? null)}
        caption={data ? unsoldCaption(data.unsoldQuotesClosed) : ""}
        badge={
          data ? (
            <TrendBadge
              trend={data.unsoldQuotesClosed.recovered}
              comparedWith={comparedWith}
            />
          ) : null
        }
        isPending={loading}
        className="sm:col-span-2 lg:col-span-1 2xl:col-span-1"
      />
    </div>
  );
}
