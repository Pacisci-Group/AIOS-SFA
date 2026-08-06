import type { ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * The accent a scorecard wears. Tailwind class strings rather than a colour
 * value, so the card can never end up with an inline `style` — the palette
 * matches the mockup exactly (`emerald-500`, `sky-400`) while still theming.
 */
export interface ScorecardAccent {
  /** The rule beside the label and the divider between footer stats. */
  bar: string;
  /** Label + caption text. */
  text: string;
  /** Card border. */
  border: string;
  /** Items badge background. */
  badge: string;
}

export const SOLD_ACCENT: ScorecardAccent = {
  bar: "bg-emerald-500",
  text: "text-emerald-500",
  border: "border-emerald-500/20",
  badge: "bg-emerald-500/12 text-emerald-500",
};

export const QUOTED_ACCENT: ScorecardAccent = {
  bar: "bg-sky-400",
  text: "text-sky-400",
  border: "border-sky-400/20",
  badge: "bg-sky-400/12 text-sky-400",
};

export interface ScorecardStat {
  label: string;
  value: string;
}

interface ScorecardShellProps {
  label: string;
  accent: ScorecardAccent;
  /** Headline figure, pre-formatted. */
  value: string;
  caption: string;
  badge: string;
  stats: [ScorecardStat, ScorecardStat];
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
}

/**
 * Shared chrome for the Sold and Quoted cards.
 *
 * They are the same card with a different accent and different copy, so they
 * are one component rather than two near-identical ones — the previous version
 * of this file duplicated the whole structure twice, which is how the two
 * halves drifted apart on spacing.
 *
 * A successful response with no records is **not** an empty state: `$0` and
 * `0 Items` are real information about the window. Only a failed request gets
 * the error treatment.
 */
export function ScorecardShell({
  label,
  accent,
  value,
  caption,
  badge,
  stats,
  isPending,
  isError,
  onRetry,
}: ScorecardShellProps) {
  return (
    <Card
      className={cn(
        "rounded-xl p-5 gap-4 relative overflow-hidden bg-card",
        accent.border,
      )}
    >
      <div className="relative flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={cn("w-1.5 h-5 rounded-full", accent.bar)} />
          <span
            className={cn(
              "text-xs uppercase tracking-widest font-semibold",
              accent.text,
            )}
          >
            {label}
          </span>
        </div>
        {!isPending && !isError && (
          <Badge
            className={cn(
              "border-transparent rounded-full text-xs font-semibold",
              accent.badge,
            )}
          >
            {badge}
          </Badge>
        )}
      </div>

      {isError ? (
        <ErrorBody onRetry={onRetry} />
      ) : isPending ? (
        <PendingBody accent={accent} />
      ) : (
        <>
          <div className="relative">
            <p className="text-foreground text-[2rem] font-bold -tracking-[0.03em] leading-none">
              {value}
            </p>
            <p className={cn("text-xs mt-1", accent.text)}>{caption}</p>
          </div>

          <div
            className={cn(
              "relative flex gap-4 pt-3 border-t",
              accent.border,
            )}
          >
            {stats.map((stat, index) => (
              <Stat key={stat.label} stat={stat} accent={accent} first={index === 0} />
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

function Stat({
  stat,
  accent,
  first,
}: {
  stat: ScorecardStat;
  accent: ScorecardAccent;
  first: boolean;
}): ReactNode {
  return (
    <>
      {!first && <div className={cn("w-px", accent.bar, "opacity-15")} />}
      <div>
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
          {stat.label}
        </p>
        <p className="text-sm text-foreground mt-0.5 font-semibold">
          {stat.value}
        </p>
      </div>
    </>
  );
}

function PendingBody({ accent }: { accent: ScorecardAccent }) {
  return (
    <>
      <div className="relative">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-3 w-24 mt-2" />
      </div>
      <div className={cn("relative flex gap-4 pt-3 border-t", accent.border)}>
        <div>
          <Skeleton className="h-2.5 w-20" />
          <Skeleton className="h-4 w-12 mt-1.5" />
        </div>
        <div className={cn("w-px", accent.bar, "opacity-15")} />
        <div>
          <Skeleton className="h-2.5 w-20" />
          <Skeleton className="h-4 w-12 mt-1.5" />
        </div>
      </div>
    </>
  );
}

function ErrorBody({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-6 text-center">
      <AlertCircle size={20} className="text-amber-500" />
      <p className="text-sm text-muted-foreground">
        Couldn&rsquo;t load your scorecards.
      </p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
