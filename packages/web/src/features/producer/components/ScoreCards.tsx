import { TrendingUp, TrendingDown, Minus, Trophy, Award } from "lucide-react";

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
    <div className="grid grid-cols-3 gap-4 px-6 py-4">
      {/* Card A: Sold Engine */}
      <div
        className="rounded-xl p-5 flex flex-col gap-4 relative overflow-hidden"
        style={{ background: "#0D2B22", border: "1px solid rgba(16,185,129,0.2)" }}
      >
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(ellipse at top left, rgba(16,185,129,0.08) 0%, transparent 60%)" }}
        />
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-5 rounded-full" style={{ background: "#10B981" }} />
            <span className="text-xs uppercase tracking-widest" style={{ color: "#10B981", fontWeight: 600 }}>
              Sold
            </span>
          </div>
          <span
            className="text-xs px-2 py-0.5 rounded-full"
            style={{ background: "rgba(16,185,129,0.12)", color: "#10B981", fontWeight: 600 }}
          >
            {d.soldItems} Items
          </span>
        </div>

        <div>
          <p
            className="text-[#E2E8F0]"
            style={{ fontSize: "2rem", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1 }}
          >
            {d.soldPremium}
          </p>
          <p className="text-xs mt-1" style={{ color: "#10B981" }}>
            Total Sold Premium
          </p>
        </div>

        <div
          className="flex gap-4 pt-3"
          style={{ borderTop: "1px solid rgba(16,185,129,0.12)" }}
        >
          <div>
            <p className="text-[10px] text-[#64748B] uppercase tracking-wider">Avg Premium / HH</p>
            <p className="text-sm text-[#E2E8F0] mt-0.5" style={{ fontWeight: 600 }}>
              {d.avgPremiumHH}
            </p>
          </div>
          <div className="w-px" style={{ background: "rgba(16,185,129,0.15)" }} />
          <div>
            <p className="text-[10px] text-[#64748B] uppercase tracking-wider">Avg Items / HH</p>
            <p className="text-sm text-[#E2E8F0] mt-0.5" style={{ fontWeight: 600 }}>
              {d.avgItemsHH}
            </p>
          </div>
        </div>
      </div>

      {/* Card B: Quoted Pipeline */}
      <div
        className="rounded-xl p-5 flex flex-col gap-4 relative overflow-hidden"
        style={{ background: "#0B1E2F", border: "1px solid rgba(56,189,248,0.2)" }}
      >
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(ellipse at top left, rgba(56,189,248,0.07) 0%, transparent 60%)" }}
        />
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-5 rounded-full" style={{ background: "#38BDF8" }} />
            <span className="text-xs uppercase tracking-widest" style={{ color: "#38BDF8", fontWeight: 600 }}>
              Quoted
            </span>
          </div>
          <span
            className="text-xs px-2 py-0.5 rounded-full"
            style={{ background: "rgba(56,189,248,0.12)", color: "#38BDF8", fontWeight: 600 }}
          >
            {d.quotedItems} Items
          </span>
        </div>

        <div>
          <p
            className="text-[#E2E8F0]"
            style={{ fontSize: "2rem", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1 }}
          >
            {d.quotedPremium}
          </p>
          <p className="text-xs mt-1" style={{ color: "#38BDF8" }}>
            Total Quoted Premium
          </p>
        </div>

        <div
          className="flex gap-4 pt-3"
          style={{ borderTop: "1px solid rgba(56,189,248,0.12)" }}
        >
          <div>
            <p className="text-[10px] text-[#64748B] uppercase tracking-wider">Avg Quoted / HH</p>
            <p className="text-sm text-[#E2E8F0] mt-0.5" style={{ fontWeight: 600 }}>
              {d.avgQuotedHH}
            </p>
          </div>
          <div className="w-px" style={{ background: "rgba(56,189,248,0.15)" }} />
          <div>
            <p className="text-[10px] text-[#64748B] uppercase tracking-wider">Avg Items / HH</p>
            <p className="text-sm text-[#E2E8F0] mt-0.5" style={{ fontWeight: 600 }}>
              {d.avgQuotedItemsHH}
            </p>
          </div>
        </div>
      </div>

      {/* Card C: Motivation Hub */}
      <div
        className="rounded-xl p-5 flex flex-col gap-4"
        style={{ background: "#161F30", border: "1px solid rgba(255,255,255,0.07)" }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Trophy size={14} style={{ color: "#F59E0B" }} />
            <span className="text-xs uppercase tracking-widest text-[#94A3B8]" style={{ fontWeight: 600 }}>
              Leaderboard
            </span>
          </div>
          <span className="text-[10px] text-[#64748B]">Monthly Goal</span>
        </div>

        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] text-[#64748B] uppercase tracking-wider mb-1">Office Total</p>
            <p
              className="text-[#E2E8F0]"
              style={{ fontSize: "1.4rem", fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1 }}
            >
              {d.officePremium}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2 pt-2" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          {leaderboard.map((p, i) => (
            <div key={p.name} className="flex items-center gap-2">
              <span
                className="text-[10px] w-4 text-center shrink-0"
                style={{ color: rankColors[i], fontWeight: 700 }}
              >
                {i + 1}
              </span>
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] shrink-0"
                style={{
                  background: p.isMe ? "rgba(56,189,248,0.2)" : "#1E2B44",
                  color: p.isMe ? "#38BDF8" : "#94A3B8",
                  fontWeight: 700,
                  border: p.isMe ? "1px solid rgba(56,189,248,0.35)" : "none",
                }}
              >
                {p.initials}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-center mb-0.5">
                  <span
                    className="text-xs truncate"
                    style={{ color: p.isMe ? "#38BDF8" : "#CBD5E1", fontWeight: p.isMe ? 600 : 400 }}
                  >
                    {p.name}
                  </span>
                  <span className="text-[10px] ml-2 shrink-0" style={{ color: "#64748B" }}>
                    {p.progress}%
                  </span>
                </div>
                <div className="h-1 rounded-full w-full" style={{ background: "#1E2B44" }}>
                  <div
                    className="h-1 rounded-full transition-all duration-700"
                    style={{
                      width: `${p.progress}%`,
                      background: i === 0
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
      </div>
    </div>
  );
}
