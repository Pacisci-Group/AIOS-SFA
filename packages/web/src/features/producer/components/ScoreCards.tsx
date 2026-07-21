import { Trophy } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const leaderboard = [
  { name: "Jessica M.", initials: "JM", progress: 82, premium: "$38,200" },
  { name: "Justin L.", initials: "JL", progress: 71, premium: "$32,500", isMe: true },
  { name: "Marcus T.", initials: "MT", progress: 58, premium: "$26,100" },
];

const rankColors = ["#F59E0B", "#94A3B8", "#CD7C3A"];

interface ScoreCardsProps {
  filter: string;
}

const dataByFilter: Record<string, { soldPremium: string; soldItems: number; avgPremiumHH: string; avgItemsHH: string; quotedPremium: string; quotedItems: number; avgQuotedHH: string; avgQuotedItemsHH: string; officePremium: string }> = {
  Today: {
    soldPremium: "$2,840", soldItems: 4, avgPremiumHH: "$710", avgItemsHH: "1.8",
    quotedPremium: "$8,200", quotedItems: 11, avgQuotedHH: "$745", avgQuotedItemsHH: "2.1",
    officePremium: "$14,400",
  },
  "This Week": {
    soldPremium: "$12,500", soldItems: 14, avgPremiumHH: "$892", avgItemsHH: "2.0",
    quotedPremium: "$38,700", quotedItems: 42, avgQuotedHH: "$921", avgQuotedItemsHH: "2.3",
    officePremium: "$78,200",
  },
  "This Month": {
    soldPremium: "$42,500", soldItems: 32, avgPremiumHH: "$1,328", avgItemsHH: "2.1",
    quotedPremium: "$112,000", quotedItems: 84, avgQuotedHH: "$1,540", avgQuotedItemsHH: "2.4",
    officePremium: "$340,500",
  },
  "Last Month": {
    soldPremium: "$38,100", soldItems: 29, avgPremiumHH: "$1,314", avgItemsHH: "2.0",
    quotedPremium: "$98,400", quotedItems: 76, avgQuotedHH: "$1,426", avgQuotedItemsHH: "2.2",
    officePremium: "$312,800",
  },
  Custom: {
    soldPremium: "$42,500", soldItems: 32, avgPremiumHH: "$1,328", avgItemsHH: "2.1",
    quotedPremium: "$112,000", quotedItems: 84, avgQuotedHH: "$1,540", avgQuotedItemsHH: "2.4",
    officePremium: "$340,500",
  },
};

export function ScoreCards({ filter }: ScoreCardsProps) {
  const d = dataByFilter[filter] ?? dataByFilter["This Month"];

  return (
    <div
      className="grid gap-4 px-6 py-4"
      style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}
    >
      {/* Card A: Sold Engine */}
      <Card className="rounded-xl p-5 gap-4 relative overflow-hidden bg-[#0D2B22] border-emerald-500/20">
        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top_left,rgba(16,185,129,0.08)_0%,transparent_60%)]" />
        <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-5 rounded-full bg-emerald-500" />
            <span className="text-xs uppercase tracking-widest text-emerald-500 font-semibold">
              Sold
            </span>
          </div>
          <Badge className="bg-emerald-500/12 text-emerald-500 border-transparent rounded-full text-xs font-semibold">
            {d.soldItems} Items
          </Badge>
        </div>

        <div className="relative">
          <p className="text-foreground text-[2rem] font-bold -tracking-[0.03em] leading-none">
            {d.soldPremium}
          </p>
          <p className="text-xs mt-1 text-emerald-500">Total Sold Premium</p>
        </div>

        <div className="relative flex gap-4 pt-3 border-t border-emerald-500/12">
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Avg Premium / HH</p>
            <p className="text-sm text-foreground mt-0.5 font-semibold">{d.avgPremiumHH}</p>
          </div>
          <div className="w-px bg-emerald-500/15" />
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Avg Items / HH</p>
            <p className="text-sm text-foreground mt-0.5 font-semibold">{d.avgItemsHH}</p>
          </div>
        </div>
      </Card>

      {/* Card B: Quoted Pipeline */}
      <Card className="rounded-xl p-5 gap-4 relative overflow-hidden bg-[#0B1E2F] border-sky-400/20">
        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top_left,rgba(56,189,248,0.07)_0%,transparent_60%)]" />
        <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-5 rounded-full bg-sky-400" />
            <span className="text-xs uppercase tracking-widest text-sky-400 font-semibold">
              Quoted
            </span>
          </div>
          <Badge className="bg-sky-400/12 text-sky-400 border-transparent rounded-full text-xs font-semibold">
            {d.quotedItems} Items
          </Badge>
        </div>

        <div className="relative">
          <p className="text-foreground text-[2rem] font-bold -tracking-[0.03em] leading-none">
            {d.quotedPremium}
          </p>
          <p className="text-xs mt-1 text-sky-400">Total Quoted Premium</p>
        </div>

        <div className="relative flex gap-4 pt-3 border-t border-sky-400/12">
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Avg Quoted / HH</p>
            <p className="text-sm text-foreground mt-0.5 font-semibold">{d.avgQuotedHH}</p>
          </div>
          <div className="w-px bg-sky-400/15" />
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Avg Items / HH</p>
            <p className="text-sm text-foreground mt-0.5 font-semibold">{d.avgQuotedItemsHH}</p>
          </div>
        </div>
      </Card>

      {/* Card C: Motivation Hub */}
      <Card className="rounded-xl p-5 gap-4 bg-card border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Trophy size={14} className="text-amber-500" />
            <span className="text-xs uppercase tracking-widest text-slate-400 font-semibold">
              Leaderboard
            </span>
          </div>
          <span className="text-[10px] text-muted-foreground">Monthly Goal</span>
        </div>

        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Office Total</p>
            <p className="text-foreground text-[1.4rem] font-bold -tracking-[0.02em] leading-none">
              {d.officePremium}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2 pt-2 border-t border-border">
          {leaderboard.map((p, i) => (
            <div key={p.name} className="flex items-center gap-2">
              <span
                className="text-[10px] w-4 text-center shrink-0 font-bold"
                style={{ color: rankColors[i] }}
              >
                {i + 1}
              </span>
              <div
                className={cn(
                  "w-6 h-6 rounded-full flex items-center justify-center text-[9px] shrink-0 font-bold",
                  p.isMe
                    ? "bg-sky-400/20 text-sky-400 border border-sky-400/35"
                    : "bg-muted text-slate-400",
                )}
              >
                {p.initials}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-center mb-0.5">
                  <span
                    className={cn(
                      "text-xs truncate",
                      p.isMe ? "text-sky-400 font-semibold" : "text-slate-300",
                    )}
                  >
                    {p.name}
                  </span>
                  <span className="text-[10px] ml-2 shrink-0 text-muted-foreground">
                    {p.progress}%
                  </span>
                </div>
                <div className="h-1 rounded-full w-full bg-muted">
                  <div
                    className="h-1 rounded-full transition-all duration-700"
                    style={{
                      width: `${p.progress}%`,
                      background:
                        i === 0
                          ? "linear-gradient(90deg, #F59E0B, #FCD34D)"
                          : i === 1 && p.isMe
                          ? "linear-gradient(90deg, #38BDF8, #7DD3FC)"
                          : "#475569",
                    }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
