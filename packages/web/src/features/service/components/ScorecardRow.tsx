import { AlertTriangle, RefreshCw, CheckCircle2, Users } from "lucide-react";

interface ScorecardRowProps {
  stats: {
    openTickets: number;
    needsActionToday: number;
    upcomingRenewals: number;
    premiumIncreases: number;
    resolvedToday: number;
    dailyTarget: number;
    totalHouseholds: number;
    avgLobDensity: number;
  };
}

function ProgressRing({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = Math.min(value / max, 1);
  const r = 22;
  const circ = 2 * Math.PI * r;
  const dash = pct * circ;
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" className="rotate-[-90deg]">
      <circle cx="28" cy="28" r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="4" />
      <circle
        cx="28" cy="28" r={r} fill="none"
        stroke={color} strokeWidth="4"
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        style={{ transition: "stroke-dasharray 0.6s ease" }}
      />
      <text
        x="28" y="28"
        textAnchor="middle" dominantBaseline="central"
        fill="#E8EDF5"
        style={{ fontSize: "11px", fontWeight: 600, transform: "rotate(90deg)", transformOrigin: "28px 28px" }}
      >
        {Math.round(pct * 100)}%
      </text>
    </svg>
  );
}

export function ScorecardRow({ stats }: ScorecardRowProps) {
  return (
    <div className="grid grid-cols-4 gap-4">
      {/* Card A: My Active Load */}
      <div className="relative overflow-hidden rounded-xl border border-white/8 bg-card p-5 flex flex-col gap-3">
        <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-[#F59E0B] to-transparent" />
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground uppercase tracking-widest font-medium">Active Load</span>
          <div className="w-8 h-8 rounded-lg bg-[#F59E0B]/10 flex items-center justify-center">
            <AlertTriangle size={14} className="text-[#F59E0B]" />
          </div>
        </div>
        <div>
          <div className="text-4xl font-bold text-foreground tracking-tight">{stats.openTickets}</div>
          <div className="text-xs text-muted-foreground mt-0.5">Open Tickets Assigned to Me</div>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#F59E0B]/10 border border-[#F59E0B]/20">
          <div className="w-1.5 h-1.5 rounded-full bg-[#F59E0B] animate-pulse" />
          <span className="text-xs font-semibold text-[#F59E0B]">{stats.needsActionToday} Needs Action Today</span>
        </div>
      </div>

      {/* Card B: Retention Window */}
      <div className="relative overflow-hidden rounded-xl border border-white/8 bg-card p-5 flex flex-col gap-3">
        <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-[#0076A8] to-transparent" />
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground uppercase tracking-widest font-medium">Retention Window</span>
          <div className="w-8 h-8 rounded-lg bg-[#0076A8]/10 flex items-center justify-center">
            <RefreshCw size={14} className="text-[#0076A8]" />
          </div>
        </div>
        <div>
          <div className="text-4xl font-bold text-foreground tracking-tight">{stats.upcomingRenewals}</div>
          <div className="text-xs text-muted-foreground mt-0.5">Upcoming Renewals This Month</div>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#EF4444]/10 border border-[#EF4444]/20">
          <div className="w-1.5 h-1.5 rounded-full bg-[#EF4444] animate-pulse" />
          <span className="text-xs font-semibold text-[#EF4444]">{stats.premiumIncreases} Premium Increases &gt;10%</span>
        </div>
      </div>

      {/* Card C: Daily Velocity */}
      <div className="relative overflow-hidden rounded-xl border border-white/8 bg-card p-5 flex flex-col gap-3">
        <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-[#10B981] to-transparent" />
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground uppercase tracking-widest font-medium">Daily Velocity</span>
          <div className="w-8 h-8 rounded-lg bg-[#10B981]/10 flex items-center justify-center">
            <CheckCircle2 size={14} className="text-[#10B981]" />
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div>
            <div className="text-4xl font-bold text-foreground tracking-tight">{stats.resolvedToday}</div>
            <div className="text-xs text-muted-foreground mt-0.5">Resolved Today</div>
          </div>
          <div className="ml-auto">
            <ProgressRing value={stats.resolvedToday} max={stats.dailyTarget} color="#10B981" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-1.5 flex-1 rounded-full bg-white/5 overflow-hidden">
            <div
              className="h-full rounded-full bg-[#10B981] transition-all duration-700"
              style={{ width: `${Math.min((stats.resolvedToday / stats.dailyTarget) * 100, 100)}%` }}
            />
          </div>
          <span className="text-xs text-muted-foreground whitespace-nowrap">of {stats.dailyTarget} target</span>
        </div>
      </div>

      {/* Card D: Book Health */}
      <div className="relative overflow-hidden rounded-xl border border-white/8 bg-card p-5 flex flex-col gap-3">
        <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-[#8B5CF6] to-transparent" />
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground uppercase tracking-widest font-medium">Book Health</span>
          <div className="w-8 h-8 rounded-lg bg-[#8B5CF6]/10 flex items-center justify-center">
            <Users size={14} className="text-[#8B5CF6]" />
          </div>
        </div>
        <div>
          <div className="text-4xl font-bold text-foreground tracking-tight">{stats.totalHouseholds.toLocaleString()}</div>
          <div className="text-xs text-muted-foreground mt-0.5">Total Households Serviced YTD</div>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#8B5CF6]/10 border border-[#8B5CF6]/20">
          <span className="text-xs text-muted-foreground">Avg. LOB Density</span>
          <span className="ml-auto text-xs font-bold text-[#8B5CF6]">{stats.avgLobDensity}</span>
        </div>
      </div>
    </div>
  );
}
