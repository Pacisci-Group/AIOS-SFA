import { useState } from "react";
import {
  Car,
  Home,
  Shield,
  Building2,
  Heart,
  Umbrella,
  Plus,
  ExternalLink,
  AlertTriangle,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

interface Policy {
  id: string;
  line: string;
  policyNumber: string;
  premium: string;
  premiumFreq: string;
  status: "Active" | "Pending" | "Lapsed";
  effective: string;
  expiration: string;
  icon: LucideIcon;
  iconColor: string;
  iconBg: string;
  carrier: string;
  deductible?: string;
}

interface CrossSell {
  line: string;
  opportunity: string;
  icon: LucideIcon;
  priority: "High" | "Medium";
  reason: string;
  estimatedPremium: string;
}

const activePolicies: Policy[] = [
  {
    id: "pol-1",
    line: "Auto",
    policyNumber: "AUT-847-663-21",
    premium: "$184",
    premiumFreq: "/mo",
    status: "Active",
    effective: "Mar 15, 2024",
    expiration: "Mar 15, 2025",
    icon: Car,
    iconColor: "#3b82f6",
    iconBg: "#1e3a5f",
    carrier: "Allstate",
    deductible: "$500 comp / $500 coll",
  },
  {
    id: "pol-2",
    line: "Home",
    policyNumber: "HOM-291-447-08",
    premium: "$312",
    premiumFreq: "/mo",
    status: "Active",
    effective: "Jun 1, 2024",
    expiration: "Jun 1, 2025",
    icon: Home,
    iconColor: "#10b981",
    iconBg: "#052e16",
    carrier: "Allstate",
    deductible: "$2,500 AOP / $5,000 wind",
  },
  {
    id: "pol-3",
    line: "Umbrella",
    policyNumber: "UMB-033-119-55",
    premium: "$28",
    premiumFreq: "/mo",
    status: "Active",
    effective: "Jun 1, 2024",
    expiration: "Jun 1, 2025",
    icon: Umbrella,
    iconColor: "#8b5cf6",
    iconBg: "#1e1b4b",
    carrier: "Allstate",
    deductible: "—",
  },
  {
    id: "pol-4",
    line: "Landlord",
    policyNumber: "LND-558-882-34",
    premium: "$96",
    premiumFreq: "/mo",
    status: "Active",
    effective: "Jan 10, 2024",
    expiration: "Jan 10, 2025",
    icon: Building2,
    iconColor: "#f59e0b",
    iconBg: "#1c1002",
    carrier: "Allstate",
    deductible: "$2,500 AOP",
  },
];

const crossSells: CrossSell[] = [
  {
    line: "Life Insurance",
    opportunity: "Term Life — 20yr",
    icon: Heart,
    priority: "High",
    reason: "Spouse + minor driver in household. No current life coverage on file.",
    estimatedPremium: "~$45/mo",
  },
  {
    line: "Motorcycle / Rec",
    opportunity: "Recreational Vehicle",
    icon: Shield,
    priority: "Medium",
    reason: "Teen driver flagged. Common add-on for households with 3+ vehicles.",
    estimatedPremium: "~$38/mo",
  },
];

const statusColors: Record<Policy["status"], { bg: string; text: string; border: string }> = {
  Active: { bg: "#052e16", text: "#4ade80", border: "#166534" },
  Pending: { bg: "#1c1002", text: "#fbbf24", border: "#78350f" },
  Lapsed: { bg: "#2d0a0a", text: "#f87171", border: "#7f1d1d" },
};

function PolicyCard({ policy, onClick, isSelected }: { policy: Policy; onClick: () => void; isSelected: boolean }) {
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
          <p className="text-xs mt-0.5" style={{ color: "var(--muted-foreground)" }}>{item.opportunity} · Est. {item.estimatedPremium}</p>
          <p className="text-xs mt-2" style={{ color: "var(--muted-foreground)", opacity: 0.7 }}>{item.reason}</p>
          <button className="mt-3 flex items-center gap-1.5 text-xs transition-colors hover:text-blue-300" style={{ color: "#3b82f6" }}>
            <TrendingUp size={11} /> Start Quote
          </button>
        </div>
      </div>
    </div>
  );
}

export function PolicyPortfolio() {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const totalPremium = activePolicies.reduce((sum, p) => {
    const val = parseInt(p.premium.replace("$", ""));
    return sum + val;
  }, 0);

  return (
    <div className="flex flex-col h-full overflow-y-auto" style={{ scrollbarWidth: "none" }}>
      {/* Summary bar */}
      <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
        <div>
          <p className="text-xs uppercase tracking-widest" style={{ color: "var(--muted-foreground)", fontFamily: "'JetBrains Mono', monospace" }}>
            Policy Portfolio
          </p>
          <p className="mt-0.5 text-xs" style={{ color: "var(--muted-foreground)" }}>
            {activePolicies.length} active lines · {crossSells.length} cross-sell opportunities
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>Total Monthly Premium</p>
          <p className="text-xl font-semibold" style={{ color: "#4ade80", fontFamily: "'JetBrains Mono', monospace" }}>
            ${totalPremium}<span className="text-xs font-normal" style={{ color: "var(--muted-foreground)" }}>/mo</span>
          </p>
        </div>
      </div>

      <div className="p-5 flex flex-col gap-4">
        {/* Active Policies */}
        <div>
          <p className="text-xs uppercase tracking-widest mb-3" style={{ color: "var(--muted-foreground)", fontFamily: "'JetBrains Mono', monospace" }}>
            Active Policies
          </p>
          <div className="grid grid-cols-2 gap-3">
            {activePolicies.map((p) => (
              <PolicyCard
                key={p.id}
                policy={p}
                isSelected={selectedId === p.id}
                onClick={() => setSelectedId(selectedId === p.id ? null : p.id)}
              />
            ))}
          </div>
        </div>

        {/* Cross-sell section */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={13} style={{ color: "#f59e0b" }} />
            <p className="text-xs uppercase tracking-widest" style={{ color: "#f59e0b", fontFamily: "'JetBrains Mono', monospace" }}>
              Cross-Sell Opportunities
            </p>
          </div>
          <div className="flex flex-col gap-3">
            {crossSells.map((item) => (
              <CrossSellCard key={item.line} item={item} />
            ))}
          </div>
          <button className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-xs font-medium transition-colors hover:bg-white/5" style={{ border: "1px dashed rgba(255,255,255,0.12)", color: "var(--muted-foreground)" }}>
            <Plus size={12} /> Add Custom Opportunity
          </button>
        </div>
      </div>
    </div>
  );
}
