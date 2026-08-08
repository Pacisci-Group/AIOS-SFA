import { useQuery } from "@tanstack/react-query";
import { getPerformance } from "@/lib/performance-api";
import type { PerformanceMetric } from "@/lib/performance-api";
import { MotivationHub } from "./MotivationHub";
import {
  QUOTED_ACCENT,
  SOLD_ACCENT,
  ScorecardShell,
} from "./ScorecardShell";
import type { ScorecardAccent, ScorecardStat } from "./ScorecardShell";
import {
  formatCurrency,
  formatCurrencyOrDash,
  formatDecimalOrDash,
  formatItems,
} from "./scorecard-format";
import type { DashboardRange } from "../useDashboardRange";

interface ScoreCardsProps {
  range: DashboardRange;
}

/** Both cards come from one request, so the row can never half-refresh. */
export function usePerformance(range: DashboardRange) {
  return useQuery({
    queryKey: ["performance", range.key, range.from ?? null, range.to ?? null],
    queryFn: () =>
      getPerformance({ range: range.key, from: range.from, to: range.to }),
  });
}

/**
 * The scorecard row: Sold, Quoted, and the Motivation Hub.
 *
 * Sold and Quoted share one `performance` query — they always show the same
 * window, and splitting them would let the two halves of a single visual row
 * disagree mid-refresh. The Motivation Hub owns its own query (see its
 * docblock): it is month-scoped rather than range-scoped, and a leaderboard
 * failure must not blank the two cards beside it.
 */
export function ScoreCards({ range }: ScoreCardsProps) {
  const { data, isPending, isError, refetch } = usePerformance(range);

  return (
    <div className="grid gap-4 px-6 py-4 grid-cols-1 lg:grid-cols-3">
      <ScorecardShell
        label="Sold"
        accent={SOLD_ACCENT}
        badge={formatItems(data?.sold.itemCount ?? 0)}
        value={formatCurrency(data?.sold.premium ?? 0)}
        caption="Total Sold Premium"
        stats={metricStats(data?.sold, "Avg Premium / HH")}
        isPending={isPending}
        isError={isError}
        onRetry={() => void refetch()}
      />

      <ScorecardShell
        label="Quoted"
        accent={QUOTED_ACCENT}
        badge={formatItems(data?.quoted.itemCount ?? 0)}
        value={formatCurrency(data?.quoted.premium ?? 0)}
        caption="Total Quoted Premium"
        stats={metricStats(data?.quoted, "Avg Quoted / HH")}
        isPending={isPending}
        isError={isError}
        onRetry={() => void refetch()}
      />

      <MotivationHub />
    </div>
  );
}

/**
 * The two footer stats. Both render `—` rather than `$0` when there are no
 * households: the API sends `null` precisely so the UI does not have to guess
 * whether a zero means "nothing sold" or "nothing to divide by".
 */
function metricStats(
  metric: PerformanceMetric | undefined,
  premiumLabel: string,
): [ScorecardStat, ScorecardStat] {
  return [
    {
      label: premiumLabel,
      value: formatCurrencyOrDash(metric?.avgPremiumPerHousehold ?? null),
    },
    {
      label: "Avg Items / HH",
      value: formatDecimalOrDash(metric?.avgItemsPerHousehold ?? null),
    },
  ];
}

// Re-exported so `ScorecardShell`'s accent type stays importable from the row
// that composes it, rather than callers reaching into the shell directly.
export type { ScorecardAccent };
