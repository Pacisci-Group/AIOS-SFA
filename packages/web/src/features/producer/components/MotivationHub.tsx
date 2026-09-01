import { AlertCircle, Trophy } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { ModuleKey } from "@sfa/shared";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { usePermissions } from "@/hooks/usePermissions";
import { getLeaderboard } from "@/lib/leaderboard-api";
import { LeaderboardRow } from "./LeaderboardRow";
import { formatCurrency } from "./scorecard-format";

/**
 * Leaderboard / Motivation Hub (PAC-13).
 *
 * **Month-scoped, not range-scoped.** The dashboard's time chips deliberately
 * do not drive this card: goals are stored per producer per month, so a "% to
 * goal" for a week would mean prorating a monthly target, and a made-up number
 * on a motivation panel is worse than no number. The header says "Monthly Goal"
 * for that reason — please don't "fix" it by threading `range` through.
 *
 * Its own query rather than a branch of the `performance` one, so a leaderboard
 * failure leaves the two scorecards beside it intact.
 *
 * **Permission note.** PAC-8 established that dashboard access is
 * all-or-nothing per page, and this card is the one exception: `leaderboard` is
 * a distinct module key that predates that model and is not granted to every
 * `dashboard:read` holder. PAC-13 adds it to the Branch Manager template, but
 * an owner can build a custom role without it — so the card degrades to a quiet
 * message instead of firing a request that 403s.
 */
export function MotivationHub() {
  const { canRead } = usePermissions();
  const allowed = canRead(ModuleKey.Leaderboard);

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["leaderboard"],
    queryFn: () => getLeaderboard(),
    enabled: allowed,
  });

  return (
    <Card className="rounded-xl p-5 gap-4 bg-card border-border">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Trophy size={14} className="text-amber-500" />
          <span className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">
            Leaderboard
          </span>
        </div>
        {/* The header names what the rows are measured against, so it has to
            change when nothing has a goal — otherwise it promises a column of
            percentages the card cannot show (PAC-80). */}
        <span className="text-[10px] text-muted-foreground">
          {data && data.goalsConfigured === 0 ? "By Premium" : "Monthly Goal"}
        </span>
      </div>

      {!allowed ? (
        <div className="flex flex-1 items-center justify-center py-6 text-center">
          <p className="text-xs text-muted-foreground">
            The leaderboard isn&rsquo;t available for your role.
          </p>
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center justify-center gap-3 py-6 text-center">
          <AlertCircle size={20} className="text-amber-500" />
          <p className="text-sm text-muted-foreground">
            Couldn&rsquo;t load the leaderboard.
          </p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Retry
          </Button>
        </div>
      ) : isPending ? (
        <>
          <div>
            <Skeleton className="h-2.5 w-20" />
            <Skeleton className="h-6 w-28 mt-1.5" />
          </div>
          <div className="flex flex-col gap-2 pt-2 border-t border-border">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        </>
      ) : (
        <>
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
              Office Total
            </p>
            <p className="text-foreground text-[1.4rem] font-bold -tracking-[0.02em] leading-none">
              {formatCurrency(data.officeTotalPremium)}
            </p>
          </div>

          <div className="flex flex-col gap-2 pt-2 border-t border-border">
            {/*
              Say why the percentages are missing (PAC-80).

              With no goals stored, every `attainmentPct` is null and every row
              renders an em dash and an empty bar — which reads as "nobody is
              hitting their target" rather than "nobody has one". `rankRows`
              already falls through to premium order in this case, so the board
              is still correctly ranked; it just is not ranked by what the header
              would otherwise claim.
            */}
            {data.entries.length > 0 && data.goalsConfigured === 0 && (
              <p className="pb-1 text-[10px] text-muted-foreground">
                Monthly goals aren&rsquo;t set yet — ranked by premium.
              </p>
            )}
            {data.entries.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">
                No sales recorded this month yet.
              </p>
            ) : (
              data.entries.map((entry, index) => (
                <div key={entry.producerId}>
                  {/* A caller outside the top N is appended at their true rank.
                      The rule separates them from the run above so the jump in
                      rank numbers doesn't read as a rendering glitch. */}
                  {data.self?.isOutsideTop &&
                    entry.isSelf &&
                    index === data.entries.length - 1 && (
                      <div className="my-2 border-t border-dashed border-border" />
                    )}
                  <LeaderboardRow entry={entry} />
                </div>
              ))
            )}
          </div>
        </>
      )}
    </Card>
  );
}
