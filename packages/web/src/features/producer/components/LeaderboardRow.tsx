import type { LeaderboardEntry } from "@/lib/leaderboard-api";
import { cn } from "@/lib/utils";

/**
 * Gold / silver / bronze, then neutral. Tailwind classes rather than the
 * mockup's `["#F59E0B", "#94A3B8", "#CD7C3A"]` applied through an inline
 * `style`, so the row themes with everything else.
 */
const RANK_TONES: Record<number, string> = {
  1: "text-amber-500",
  2: "text-slate-400",
  3: "text-orange-700",
};

const BAR_TONES: Record<number, string> = {
  1: "bg-amber-500",
  2: "bg-slate-400",
  3: "bg-orange-700",
};

interface LeaderboardRowProps {
  entry: LeaderboardEntry;
}

export function LeaderboardRow({ entry }: LeaderboardRowProps) {
  const rankTone = RANK_TONES[entry.rank] ?? "text-muted-foreground";
  // The caller's own bar is always brand blue, whatever their rank — the point
  // of the card is finding yourself on it.
  const barTone = entry.isSelf
    ? "bg-primary"
    : (BAR_TONES[entry.rank] ?? "bg-muted-foreground");

  const hasGoal = entry.attainmentPct !== null;

  return (
    <div className="flex items-center gap-2">
      <span className={cn("text-[10px] w-4 text-center shrink-0 font-bold", rankTone)}>
        {entry.rank}
      </span>

      <div
        className={cn(
          "w-6 h-6 rounded-full flex items-center justify-center text-[9px] shrink-0 font-bold",
          entry.isSelf
            ? "bg-primary/20 text-primary border border-primary/35"
            : "bg-muted text-muted-foreground",
        )}
      >
        {entry.initials}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-center mb-0.5 gap-2">
          <span
            className={cn(
              "text-xs truncate",
              entry.isSelf ? "text-primary font-semibold" : "text-foreground",
            )}
          >
            {entry.name}
          </span>
          <span className="text-[10px] shrink-0 text-muted-foreground">
            {/* An em dash, never `0%` — no goal means unknown attainment, and
                an empty bar next to real sales reads as failure. */}
            {hasGoal ? `${entry.attainmentPct}%` : "—"}
          </span>
        </div>

        <div className="h-1 rounded-full w-full bg-muted overflow-hidden">
          <div
            className={cn("h-1 rounded-full transition-all duration-700", barTone)}
            // `width` is the one legitimately dynamic value here; everything
            // else is a token class. Capped so a producer at 140% of goal does
            // not overflow the track.
            style={{ width: `${Math.min(entry.attainmentPct ?? 0, 100)}%` }}
          />
        </div>
      </div>
    </div>
  );
}
