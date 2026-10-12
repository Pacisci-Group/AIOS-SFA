import { Badge } from "@/components/ui/badge";
import type { GoalPacing } from "@/lib/analytics-api";
import { cn } from "@/lib/utils";
import { formatMoneyCompact } from "../analytics-format";

const STATUS = {
  achieved: { label: "Goal met", tone: "bg-success/12 text-success", fill: "bg-success" },
  ahead: { label: "On pace", tone: "bg-success/12 text-success", fill: "bg-success" },
  behind: { label: "Behind pace", tone: "bg-destructive/12 text-destructive", fill: "bg-destructive" },
} as const;

export function PacingBadge({ status }: { status: GoalPacing["status"] }) {
  return (
    <Badge size="sm" className={cn("border-transparent", STATUS[status].tone)}>
      {STATUS[status].label}
    </Badge>
  );
}

/**
 * Bound premium against the month's goal, with a tick where an even pace
 * would have it by now. The fill carries the state (on pace or behind), and
 * the badge beside it says it in words — never colour alone.
 */
export function GoalPacingMeter({ pacing }: { pacing: GoalPacing }) {
  const pct = Math.min(100, pacing.attainmentPct ?? 0);
  const expected = Math.min(100, pacing.elapsedPct);
  return (
    <div className="space-y-1.5">
      <div
        role="meter"
        aria-label="Bound premium against the month's goal"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={`${pacing.attainmentPct ?? 0}% of goal, ${pacing.elapsedPct}% of the month elapsed`}
        className="relative h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn("h-full rounded-full", STATUS[pacing.status].fill)}
          style={{ width: `${pct}%` }}
        />
        <div
          aria-hidden
          className="absolute top-0 h-full w-0.5 bg-foreground/60"
          style={{ left: `calc(${expected}% - 1px)` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Expected by now {formatMoneyCompact(pacing.expectedToDate)} ·{" "}
        {pacing.projectedPremium === null
          ? "month not started"
          : `on track for ${formatMoneyCompact(pacing.projectedPremium)}`}
      </p>
    </div>
  );
}
