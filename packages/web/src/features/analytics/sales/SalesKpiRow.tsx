import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { KpiCard } from "@/components/common/KpiCard";
import { TrendBadge } from "@/components/common/TrendBadge";
import {
  analyticsKey,
  getSalesSummary,
  type AnalyticsSalesSummary,
  type GoalPacingGap,
  type SalesFilterParams,
} from "@/lib/analytics-api";
import { NOT_AVAILABLE } from "@/lib/not-available";
import {
  comparisonDates,
  formatCount,
  formatMoney,
  formatMoneyCompact,
  formatPct,
} from "../analytics-format";
import { KpiRowError } from "../components/KpiRowError";
import { GoalPacingMeter, PacingBadge } from "./GoalPacingMeter";

const PACING_GAP: Record<GoalPacingGap, string> = {
  not_one_month:
    "Pick This Month, Last Month or a custom range inside one month to pace against a goal",
  filtered:
    "A goal is the whole month's premium — clear the line, source and carrier filters to pace against it",
  no_goals_for_month: "No goals are set for this month",
};

function closingCaption(summary: AnalyticsSalesSummary): string {
  const ratio = summary.closingRatio;
  if (!ratio) return "Quotes record no carrier, so there is no ratio under a carrier filter";
  if (ratio.reason === "no_quotes") return "No quotes recorded in this period";
  if (ratio.reason === "too_few_quotes") return "Too few quotes recorded to compare";
  return `${formatMoneyCompact(ratio.soldPremium)} sold / ${formatMoneyCompact(ratio.quotedPremium)} quoted`;
}

/**
 * The Sales tab's KPI row (PAC-152, part 2), from one request — the figures
 * describe one window and must never half-refresh and disagree on screen.
 * Bound premium is the Owner dashboard's figure; net is beside it.
 */
export function SalesKpiRow({ params }: { params: SalesFilterParams }) {
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: [...analyticsKey, "sales", "summary", params],
    queryFn: () => getSalesSummary(params),
    placeholderData: keepPreviousData,
  });

  if (isError) {
    return (
      <KpiRowError
        message="Couldn’t load the sales figures."
        onRetry={() => void refetch()}
      />
    );
  }

  const loading = isPending || !data;
  const comparedWith = data ? comparisonDates(data.period) : "";
  const pacing = data?.pacing ?? null;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
      <KpiCard
        label="Bound premium"
        value={formatMoney(data?.premium.current ?? null)}
        caption={
          data?.netPremium.current === null || data?.netPremium.current === undefined
            ? "Net of chargebacks isn’t split by line or carrier"
            : `${formatMoney(data.netPremium.current)} net of chargebacks`
        }
        badge={data && <TrendBadge trend={data.premium} comparedWith={comparedWith} />}
        isPending={loading}
      />
      <KpiCard
        label="Items bound"
        value={formatCount(data?.items.current ?? null)}
        caption={`${formatCount(data?.policies.current ?? null)} policies`}
        badge={data && <TrendBadge trend={data.items} comparedWith={comparedWith} />}
        isPending={loading}
      />
      <KpiCard
        label="Households"
        value={formatCount(data?.households.current ?? null)}
        caption={
          data?.avgPremiumPerHousehold.current === null
            ? "No households with a sale"
            : `${formatMoney(data?.avgPremiumPerHousehold.current ?? null)} per household`
        }
        badge={data && <TrendBadge trend={data.households} comparedWith={comparedWith} />}
        isPending={loading}
      />
      <KpiCard
        label="Closing ratio"
        value={formatPct(data?.closingRatio?.current ?? null)}
        caption={data ? closingCaption(data) : ""}
        badge={
          data?.closingRatio && (
            <TrendBadge trend={data.closingRatio} comparedWith={comparedWith} />
          )
        }
        isPending={loading}
      />
      <KpiCard
        label={pacing ? `Goal pacing · ${monthLabel(pacing.month)}` : "Goal pacing"}
        value={
          pacing ? formatPct(pacing.attainmentPct) : NOT_AVAILABLE
        }
        caption={
          pacing
            ? `${formatMoneyCompact(pacing.boundPremium)} of ${formatMoneyCompact(pacing.goalPremium)} · ${pacing.elapsedPct}% of the month gone`
            : data?.pacingGap
              ? PACING_GAP[data.pacingGap]
              : ""
        }
        badge={pacing && <PacingBadge status={pacing.status} />}
        isPending={loading}
        // Fills the row's gap below `2xl`, where five cards do not divide.
        className="sm:col-span-2 2xl:col-span-1"
      >
        {pacing && <GoalPacingMeter pacing={pacing} />}
      </KpiCard>
    </div>
  );
}

function monthLabel(month: string): string {
  return new Date(`${month}-15T12:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    timeZone: "UTC",
  });
}
