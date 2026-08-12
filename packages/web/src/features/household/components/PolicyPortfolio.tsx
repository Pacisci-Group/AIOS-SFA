import { useState } from "react";
import {
  Shield,
  Heart,
  Plus,
  ExternalLink,
  AlertTriangle,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import type { PolicySummary } from "@sfa/shared";
import {
  statusColors,
  toDisplayPolicy,
  type DisplayPolicy as Policy,
} from "./policy-display";

interface CrossSell {
  line: string;
  opportunity: string;
  icon: LucideIcon;
  priority: "High" | "Medium";
  reason: string;
}

/**
 * Demo only. Nothing derives these: the reasons reference household facts we
 * never checked, and the original premium estimates ("~$45/mo") had no rating
 * source behind them at all, so they are gone. Deriving real opportunities
 * from the lines a household does *not* hold is tracked separately.
 */
const demoCrossSells: CrossSell[] = [
  {
    line: "Life Insurance",
    opportunity: "Term Life — 20yr",
    icon: Heart,
    priority: "High",
    reason: "Spouse + minor driver in household. No current life coverage on file.",
  },
  {
    line: "Motorcycle / Rec",
    opportunity: "Recreational Vehicle",
    icon: Shield,
    priority: "Medium",
    reason: "Teen driver flagged. Common add-on for households with 3+ vehicles.",
  },
];

export function PolicyCard({ policy, onClick, isSelected }: { policy: Policy; onClick: () => void; isSelected: boolean }) {
  const sc = statusColors[policy.status];
  const Icon = policy.icon;
  return (
    <div
      onClick={onClick}
      className="rounded-xl p-4 cursor-pointer transition-all"
      style={{
        background: isSelected ? "var(--secondary)" : "var(--card)",
        border: isSelected ? "1px solid #3b82f6" : "1px solid var(--border)",
        boxShadow: isSelected ? "0 0 0 1px #3b82f640" : "none",
      }}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: policy.iconBg }}>
            <Icon size={18} style={{ color: policy.iconColor }} />
          </div>
          <div>
            <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>{policy.line}</p>
            <p className="text-xs font-mono" style={{ color: "var(--muted-foreground)", fontFamily: "'JetBrains Mono', monospace" }}>
              {policy.policyNumber}
            </p>
          </div>
        </div>
        <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: sc.bg, color: sc.text, border: `1px solid ${sc.border}` }}>
          {policy.status}
        </span>
      </div>

      <div className="flex items-end justify-between">
        <div>
          <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>Annual Premium</p>
          <p className="text-lg font-semibold mt-0.5" style={{ color: "var(--foreground)", fontFamily: "'JetBrains Mono', monospace" }}>
            {policy.premium}<span className="text-xs font-normal" style={{ color: "var(--muted-foreground)" }}>{policy.premiumFreq}</span>
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>Expires</p>
          <p className="text-xs font-medium mt-0.5" style={{ color: "var(--foreground)" }}>{policy.expiration}</p>
        </div>
      </div>

      {isSelected && (
        <div className="mt-3 pt-3 flex flex-col gap-1.5 border-t" style={{ borderColor: "var(--border)" }}>
          <div className="flex justify-between">
            <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>Carrier</span>
            <span className="text-xs" style={{ color: "var(--foreground)" }}>{policy.carrier}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>Effective</span>
            <span className="text-xs" style={{ color: "var(--foreground)" }}>{policy.effective}</span>
          </div>
          {policy.deductible && (
            <div className="flex justify-between">
              <span className="text-xs" style={{ color: "var(--muted-foreground)" }}>Deductible</span>
              <span className="text-xs" style={{ color: "var(--foreground)" }}>{policy.deductible}</span>
            </div>
          )}
          <button className="mt-2 flex items-center justify-center gap-1.5 w-full py-1.5 rounded text-xs transition-colors hover:bg-blue-600" style={{ background: "#1d4ed8", color: "#fff" }}>
            <ExternalLink size={11} /> Open Policy
          </button>
        </div>
      )}
    </div>
  );
}

function CrossSellCard({ item }: { item: CrossSell }) {
  const Icon = item.icon;
  return (
    <div
      className="rounded-xl p-4 cursor-pointer transition-all hover:border-blue-500/50 group"
      style={{
        background: "transparent",
        border: "1.5px dashed rgba(255,255,255,0.12)",
      }}
    >
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-all group-hover:bg-blue-900/40" style={{ background: "var(--muted)", border: "1px dashed rgba(255,255,255,0.15)" }}>
          <Icon size={16} style={{ color: "var(--muted-foreground)" }} className="group-hover:text-blue-400 transition-colors" />
        </div>
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium" style={{ color: "var(--muted-foreground)" }} >{item.line}</p>
            <span
              className="px-2 py-0.5 rounded-full text-xs"
              style={
                item.priority === "High"
                  ? { background: "#2d0a0a", color: "#f87171", border: "1px solid #7f1d1d" }
                  : { background: "#1c1002", color: "#fbbf24", border: "1px solid #78350f" }
              }
            >
              {item.priority} Priority
            </span>
          </div>
          <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>{item.opportunity}</p>
          <p className="text-xs mt-2" style={{ color: "var(--muted-foreground)", opacity: 0.7 }}>{item.reason}</p>
          <button className="mt-3 flex items-center gap-1.5 text-xs transition-colors hover:text-blue-300" style={{ color: "#3b82f6" }}>
            <TrendingUp size={11} /> Start Quote
          </button>
        </div>
      </div>
    </div>
  );
}

interface PolicyPortfolioProps {
  policies: PolicySummary[];
  /** Enables the cross-sell block, which nothing derives yet. */
  isDemo?: boolean;
}

export function PolicyPortfolio({ policies, isDemo = false }: PolicyPortfolioProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Every policy renders — a lapsed one is exactly what a CSR needs to see, and
  // the card already carries a Lapsed badge. Only the headline count and the
  // premium total narrow to active, because both claim to describe active
  // coverage and a cancelled policy was inflating them.
  const displayPolicies = policies.map(toDisplayPolicy);
  const activePolicies = displayPolicies.filter((p) => p.status === "Active");

  const totalPremium = activePolicies.reduce((sum, p) => sum + p.premiumValue, 0);
  const inactiveCount = displayPolicies.length - activePolicies.length;

  return (
    // A plain scrolling block, deliberately not a flex column: as flex items
    // these sections would shrink to min-content to fit the height, squashing
    // the policy grid instead of overflowing into a scroll.
    <div className="h-full min-h-0 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
      {/* Summary bar */}
      <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
        <div>
          <p className="text-xs uppercase tracking-widest" style={{ color: "var(--muted-foreground)", fontFamily: "'JetBrains Mono', monospace" }}>
            Policy Portfolio
          </p>
          <p className="mt-0.5 text-xs" style={{ color: "var(--muted-foreground)" }}>
            {activePolicies.length} active {activePolicies.length === 1 ? "line" : "lines"}
            {inactiveCount > 0 && ` · ${inactiveCount} inactive`}
            {isDemo && ` · ${demoCrossSells.length} cross-sell opportunities`}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
            Total Annual Premium
          </p>
          <p className="text-xl font-semibold" style={{ color: "#4ade80", fontFamily: "'JetBrains Mono', monospace" }}>
            ${totalPremium.toLocaleString()}<span className="text-xs font-normal" style={{ color: "var(--muted-foreground)" }}>/yr</span>
          </p>
        </div>
      </div>

      <div className="p-5 flex flex-col gap-4">
        {/* Policies */}
        <div>
          <p className="text-xs uppercase tracking-widest mb-3" style={{ color: "var(--muted-foreground)", fontFamily: "'JetBrains Mono', monospace" }}>
            Policies
          </p>
          {displayPolicies.length === 0 && (
            <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
              No policies on file.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            {displayPolicies.map((p) => (
              <PolicyCard
                key={p.id}
                policy={p}
                isSelected={selectedId === p.id}
                onClick={() => setSelectedId(selectedId === p.id ? null : p.id)}
              />
            ))}
          </div>
        </div>

        {/* Cross-sell section — demo only until real opportunities are derived. */}
        {isDemo && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle size={13} style={{ color: "#f59e0b" }} />
              <p className="text-xs uppercase tracking-widest" style={{ color: "#f59e0b", fontFamily: "'JetBrains Mono', monospace" }}>
                Cross-Sell Opportunities
              </p>
            </div>
            <div className="flex flex-col gap-3">
              {demoCrossSells.map((item) => (
                <CrossSellCard key={item.line} item={item} />
              ))}
            </div>
            <button className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-medium transition-colors hover:bg-white/5" style={{ border: "1px dashed rgba(255,255,255,0.12)", color: "var(--muted-foreground)" }}>
              <Plus size={12} /> Add Custom Opportunity
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
