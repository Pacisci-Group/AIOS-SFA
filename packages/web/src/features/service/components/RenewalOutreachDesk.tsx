import { AlertTriangle, Lightbulb, PhoneCall, ChevronRight, TrendingUp } from "lucide-react";

interface RenewalClient {
  id: string;
  name: string;
  renewalDate: string;
  daysUntil: number;
  policyNumber: string;
  premiumChange: number;
  premiumChangeAbs: number;
  reason: string;
  crossSell?: string;
  linesCount: number;
  priority: "high" | "medium" | "low";
}

const clients: RenewalClient[] = [
  {
    id: "r1", name: "Jessica D. Cobb", renewalDate: "July 1", daysUntil: 22,
    policyNumber: "AL-3847201", premiumChange: 18.4, premiumChangeAbs: 42,
    reason: "rate adjustment + territory factor", crossSell: "Umbrella Policy",
    linesCount: 2, priority: "high",
  },
  {
    id: "r2", name: "Thomas & Rhonda Kipchoge", renewalDate: "July 6", daysUntil: 27,
    policyNumber: "HO-9912043", premiumChange: 22.1, premiumChangeAbs: 89,
    reason: "roof age surcharge + wind zone increase", crossSell: "Life Insurance",
    linesCount: 1, priority: "high",
  },
  {
    id: "r3", name: "Olivia Marchetti", renewalDate: "July 12", daysUntil: 33,
    policyNumber: "AL-7720148", premiumChange: 11.3, premiumChangeAbs: 27,
    reason: "statewide rate change", crossSell: "Renters Insurance",
    linesCount: 1, priority: "medium",
  },
  {
    id: "r4", name: "Benjamin Nakamura", renewalDate: "July 18", daysUntil: 39,
    policyNumber: "AL-5538871", premiumChange: 6.2, premiumChangeAbs: 14,
    reason: "claims-free discount expiration",
    linesCount: 3, priority: "low",
  },
  {
    id: "r5", name: "Carmen & Luis Delgado", renewalDate: "July 22", daysUntil: 43,
    policyNumber: "HO-1122934", premiumChange: 15.8, premiumChangeAbs: 58,
    reason: "re-inspection results + roof age", crossSell: "Auto Bundle",
    linesCount: 1, priority: "high",
  },
];

const priorityConfig = {
  high: { ring: "border-[#F59E0B]/30", badge: "bg-[#F59E0B]/10 text-[#F59E0B]", label: "High Priority" },
  medium: { ring: "border-[#0076A8]/30", badge: "bg-[#0076A8]/10 text-[#0076A8]", label: "Review Soon" },
  low: { ring: "border-white/8", badge: "bg-white/5 text-muted-foreground", label: "Monitor" },
};

export function RenewalOutreachDesk() {
  return (
    <div className="flex flex-col rounded-xl border border-white/8 bg-card overflow-hidden h-full">
      {/* Header */}
      <div className="px-5 pt-5 pb-4 border-b border-white/8">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground tracking-tight">Proactive Renewal Outreach</h2>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#0076A8]/10 border border-[#0076A8]/20">
            <div className="w-1.5 h-1.5 rounded-full bg-[#0076A8] animate-pulse" />
            <span className="text-[10px] font-semibold text-[#0076A8]">{clients.length} Active</span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-1">Policies renewing soon — act before they call you</p>
      </div>

      {/* Client stack */}
      <div className="flex-1 overflow-y-auto divide-y divide-white/5 px-4 py-2">
        {clients.map((client) => {
          const cfg = priorityConfig[client.priority];
          return (
            <div key={client.id} className={`py-4 group`}>
              {/* Top: name + renewal date */}
              <div className="flex items-start justify-between mb-2.5">
                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-semibold text-foreground">{client.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground font-mono">{client.policyNumber}</span>
                    <span className="text-white/20">·</span>
                    <span className="text-xs text-muted-foreground">{client.linesCount} line{client.linesCount !== 1 ? "s" : ""}</span>
                  </div>
                </div>
                <div className="text-right flex-shrink-0 ml-3">
                  <div className="text-xs font-semibold text-[#0076A8]">Renews {client.renewalDate}</div>
                  <div className="text-[10px] text-muted-foreground">{client.daysUntil} days away</div>
                </div>
              </div>

              {/* Premium warning */}
              {client.premiumChange > 0 && (
                <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-[#F59E0B]/8 border border-[#F59E0B]/15 mb-2.5">
                  <AlertTriangle size={13} className="text-[#F59E0B] flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="text-xs font-semibold text-[#F59E0B]">
                      +${client.premiumChangeAbs}/mo
                    </span>
                    <span className="text-xs text-[#F59E0B]/80"> ({client.premiumChange.toFixed(1)}% increase)</span>
                    <div className="text-[10px] text-[#F59E0B]/60 mt-0.5">due to {client.reason}</div>
                  </div>
                  <div className="ml-auto flex-shrink-0">
                    <TrendingUp size={13} className="text-[#F59E0B]/60" />
                  </div>
                </div>
              )}

              {/* Cross-sell opportunity */}
              {client.crossSell && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#0076A8]/8 border border-[#0076A8]/15 mb-3">
                  <Lightbulb size={12} className="text-[#0076A8] flex-shrink-0" />
                  <span className="text-[10px] text-[#0076A8]/90">Cross-Sell Opportunity:</span>
                  <span className="text-[10px] font-semibold text-[#0076A8]">Missing {client.crossSell}</span>
                </div>
              )}

              {/* CTA */}
              <button className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-[#0076A8]/15 border border-[#0076A8]/25 text-xs font-semibold text-[#0076A8] hover:bg-[#0076A8]/25 hover:border-[#0076A8]/40 transition-all duration-150 group-hover:shadow-sm">
                <PhoneCall size={12} />
                Start Renewal Review
                <ChevronRight size={12} className="ml-auto opacity-50" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
