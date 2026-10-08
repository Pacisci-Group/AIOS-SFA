import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import type { OwnerTrend } from "@/lib/owner-dashboard-api";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Tones for a movement. Up is the `success` token; there is no red token in
 * `theme.css` (`destructive` is amber), so down uses the `X-600 dark:X-400`
 * pair the ticket workspace uses for the same hue — see `ticket-data.ts`.
 */
const TONE = {
  up: "bg-success/12 text-success",
  down: "bg-red-500/12 text-red-600 dark:text-red-400",
  flat: "bg-muted text-muted-foreground",
} as const;

interface TrendBadgeProps {
  trend: OwnerTrend;
  /** The exact comparison window, shown on hover. */
  comparedWith: string;
}

/**
 * The movement in a card's top-right corner: green and up, red and down.
 *
 * Three things it refuses to do. It never shows a number when the comparison
 * window held nothing — the business may not have existed, and "+∞%" is not
 * information. It never calls a ratio's movement a percent: 50% → 55% is
 * **+5 pts**, and "+10%" would be a different claim. And it does not colour a
 * change of zero.
 */
export function TrendBadge({ trend, comparedWith }: TrendBadgeProps) {
  if (trend.status === "no_prior_data" || trend.change === null) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge size="sm" className={cn("border-transparent", TONE.flat)}>
            No prior data
          </Badge>
        </TooltipTrigger>
        <TooltipContent>Nothing to compare with in {comparedWith}.</TooltipContent>
      </Tooltip>
    );
  }

  const { change } = trend;
  const direction = change > 0 ? "up" : change < 0 ? "down" : "flat";
  const Icon =
    direction === "up" ? TrendingUp : direction === "down" ? TrendingDown : Minus;
  const magnitude = Math.abs(change).toLocaleString("en-US");
  const unit = trend.unit === "points" ? " pts" : "%";
  const sign = change > 0 ? "+" : change < 0 ? "−" : "";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          size="sm"
          className={cn("border-transparent tabular-nums", TONE[direction])}
        >
          <Icon aria-hidden />
          {sign}
          {magnitude}
          {unit}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>Compared with {comparedWith}.</TooltipContent>
    </Tooltip>
  );
}
