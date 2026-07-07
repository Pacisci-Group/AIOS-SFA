import { useState } from "react";
import { ChevronDown, ChevronUp, Shield, TrendingDown, CheckCircle2, AlertCircle } from "lucide-react";

const currentCoverage = {
  carrier: "State Farm",
  premium: "$2,340/yr",
  monthlyPremium: "$195/mo",
  deductible: "$1,000",
  liability: "100/300/100",
  collision: "$500 deductible",
  comprehensive: "$500 deductible",
  um: "100/300",
  medPay: "$5,000",
};

const proposedCoverage = {
  carrier: "Progressive",
  premium: "$1,872/yr",
  monthlyPremium: "$156/mo",
  deductible: "$500",
  liability: "250/500/250",
  collision: "$500 deductible",
  comprehensive: "$250 deductible",
  um: "250/500",
  medPay: "$10,000",
};

const savings = "$468/yr";

type RowItem = { label: string; current: string; proposed: string; better?: boolean };

const rows: RowItem[] = [
  { label: "Annual Premium", current: currentCoverage.premium, proposed: proposedCoverage.premium, better: true },
  { label: "Monthly Premium", current: currentCoverage.monthlyPremium, proposed: proposedCoverage.monthlyPremium, better: true },
  { label: "Liability Limits", current: currentCoverage.liability, proposed: proposedCoverage.liability, better: true },
  { label: "Collision Ded.", current: currentCoverage.collision, proposed: proposedCoverage.collision },
  { label: "Comp. Ded.", current: currentCoverage.comprehensive, proposed: proposedCoverage.comprehensive, better: true },
  { label: "UM/UIM", current: currentCoverage.um, proposed: proposedCoverage.um, better: true },
  { label: "Med Pay", current: currentCoverage.medPay, proposed: proposedCoverage.medPay, better: true },
];

export function QuoteWorkspace() {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-card rounded-lg border border-border overflow-hidden">
      {/* Header — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="size-8 rounded-md flex items-center justify-center" style={{ background: "var(--sky)", opacity: 0.9 }}>
            <Shield size={16} color="#fff" />
          </div>
          <div className="text-left">
            <p className="text-sm text-card-foreground" style={{ fontWeight: 600 }}>Active Quote Workspace</p>
            <p className="text-xs text-muted-foreground">Quote Recap — Side-by-side coverage comparison</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full" style={{ background: "rgba(16,185,129,0.1)" }}>
            <TrendingDown size={13} style={{ color: "var(--emerald)" }} />
            <span className="text-xs" style={{ color: "var(--emerald)", fontWeight: 600 }}>Save {savings}</span>
          </div>
          {expanded ? <ChevronUp size={16} className="text-muted-foreground" /> : <ChevronDown size={16} className="text-muted-foreground" />}
        </div>
      </button>

      {/* Expanded comparison */}
      {expanded && (
        <div className="border-t border-border">
          {/* Carrier header row */}
          <div className="grid grid-cols-3 bg-muted/40 px-5 py-3 text-xs" style={{ fontWeight: 600 }}>
            <span className="text-muted-foreground uppercase tracking-wider">Coverage</span>
            <span className="text-muted-foreground uppercase tracking-wider">Current · {currentCoverage.carrier}</span>
            <span className="uppercase tracking-wider" style={{ color: "var(--sky)" }}>Proposed · {proposedCoverage.carrier}</span>
          </div>

          {/* Data rows */}
          <div className="divide-y divide-border">
            {rows.map((row) => (
              <div key={row.label} className="grid grid-cols-3 px-5 py-3 text-sm hover:bg-muted/20 transition-colors">
                <span className="text-muted-foreground">{row.label}</span>
                <span className="text-card-foreground">{row.current}</span>
                <div className="flex items-center gap-2">
                  <span style={{ color: row.better ? "var(--emerald)" : undefined, fontWeight: row.better ? 500 : undefined }}>
                    {row.proposed}
                  </span>
                  {row.better && <CheckCircle2 size={12} style={{ color: "var(--emerald)" }} />}
                </div>
              </div>
            ))}
          </div>

          {/* Footer CTA */}
          <div className="flex items-center justify-between px-5 py-4 bg-muted/30 border-t border-border">
            <div className="flex items-center gap-2">
              <AlertCircle size={14} style={{ color: "var(--amber)" }} />
              <span className="text-xs text-muted-foreground">Awaiting client approval — expires Jun 30, 2026</span>
            </div>
            <button
              className="px-4 py-1.5 rounded-md text-xs text-white transition-opacity hover:opacity-90"
              style={{ background: "var(--sky)", fontWeight: 600 }}
            >
              Finalize Quote Recap
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
