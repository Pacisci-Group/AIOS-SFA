import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { SectionLabel } from "@/components/common/DetailCard";
import { Skeleton } from "@/components/ui/skeleton";

interface OwnerKpiCardProps {
  label: string;
  /** Headline figure, pre-formatted. */
  value: string;
  /** The line under the figure. */
  caption: ReactNode;
  /** Top-right slot — the trend badge. */
  badge?: ReactNode;
  /** Optional extra block under the caption (the LOB mix bar). */
  children?: ReactNode;
  isPending: boolean;
}

/**
 * One card of the Owner dashboard's KPI row (PAC-135).
 *
 * Deliberately plainer than the Producer scorecards: those are two cards with a
 * colour each because Sold and Quoted are different *things*; these are four
 * figures about one agency, and four accents would be decoration.
 *
 * No empty state. `$0` and `0` are real information about a window — only a
 * failed request is an error, and the row handles that once for all four.
 */
export function OwnerKpiCard({
  label,
  value,
  caption,
  badge,
  children,
  isPending,
}: OwnerKpiCardProps) {
  return (
    <Card className="gap-3 rounded-xl bg-card p-5">
      <div className="flex items-start justify-between gap-2">
        <SectionLabel>{label}</SectionLabel>
        {!isPending && badge}
      </div>

      {isPending ? (
        <div>
          <Skeleton className="h-8 w-32" />
          <Skeleton className="mt-2 h-3 w-40" />
        </div>
      ) : (
        <>
          <div>
            <p className="text-[2rem] leading-none font-bold -tracking-[0.03em] text-foreground tabular-nums">
              {value}
            </p>
            <p className="mt-1.5 text-xs text-muted-foreground">{caption}</p>
          </div>
          {children}
        </>
      )}
    </Card>
  );
}
