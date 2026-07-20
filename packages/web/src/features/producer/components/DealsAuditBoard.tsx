import { Car, Home, Package, Clock, CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { usePermissions } from "@/hooks/usePermissions";
import { ResolvePanel } from "./ResolvePanel";

export interface Deal {
  id: number;
  client: string;
  type: "Auto" | "Home" | "Bundle";
  missing: string;
  days: number;
  resolved?: boolean;
}

const initialDeals: Deal[] = [
  { id: 1, client: "Nathan Rieck", type: "Bundle", missing: "Prior Insurance Proof", days: 68 },
  { id: 2, client: "Sandra Watkins", type: "Auto", missing: "Defensive Driver Certificate", days: 41 },
  { id: 3, client: "Omar Hassan", type: "Home", missing: "Home Inspection Report", days: 29 },
  { id: 4, client: "Priya Sharma", type: "Bundle", missing: "Prior Claims History", days: 14 },
  { id: 5, client: "Derek Collins", type: "Auto", missing: "Driver's License Copy", days: 7 },
  { id: 6, client: "Maria Santos", type: "Home", missing: "Property Deed Verification", days: 3 },
];

const TypeIcon = ({ type }: { type: Deal["type"] }) => {
  if (type === "Auto") return <Car size={12} />;
  if (type === "Home") return <Home size={12} />;
  return <Package size={12} />;
};

export function DealsAuditBoard() {
  const [deals, setDeals] = useState<Deal[]>(initialDeals);
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null);
  const { canWrite } = usePermissions();
  const canResolve = canWrite("deal_audits");

  const handleResolved = (id: number) => {
    setDeals((prev) =>
      prev.map((d) => (d.id === id ? { ...d, resolved: true } : d))
    );
  };

  const pending = deals.filter((d) => !d.resolved);
  const resolved = deals.filter((d) => d.resolved);

  return (
    <>
      <div
        className="flex flex-col rounded-xl overflow-hidden"
        style={{ background: "#161F30", border: "1px solid rgba(255,255,255,0.07)" }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
        >
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-5 rounded-full" style={{ background: "#F59E0B" }} />
            <h2 className="text-sm text-[#E2E8F0]" style={{ fontWeight: 600 }}>
              Deals Pending Service Hand-off
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {resolved.length > 0 && (
              <span
                className="text-xs px-2 py-0.5 rounded-full flex items-center gap-1"
                style={{ background: "rgba(16,185,129,0.12)", color: "#10B981" }}
              >
                <CheckCircle2 size={10} />
                {resolved.length} resolved
              </span>
            )}
            <span
              className="text-xs px-2 py-1 rounded-full"
              style={{ background: "rgba(245,158,11,0.15)", color: "#F59E0B", fontWeight: 700 }}
            >
              {pending.length} Outstanding
            </span>
          </div>
        </div>

        {/* Column Headers */}
        <div
          className="grid px-5 py-2.5 gap-3"
          style={{
            gridTemplateColumns: "1fr 1.3fr 90px 80px",
            borderBottom: "1px solid rgba(255,255,255,0.04)",
          }}
        >
          {["Client", "Missing Requirement", "Days Open", "Action"].map((h) => (
            <span key={h} className="text-[10px] uppercase tracking-widest" style={{ color: "#4B5563" }}>
              {h}
            </span>
          ))}
        </div>

        {/* Rows */}
        <div className="flex flex-col overflow-y-auto" style={{ maxHeight: "360px" }}>
          {pending.map((deal, i) => {
            const urgent = deal.days >= 30;
            const warning = deal.days >= 14 && deal.days < 30;

            return (
              <div
                key={deal.id}
                className="grid px-5 py-3.5 gap-3 items-center transition-all hover:bg-white/[0.02] group"
                style={{
                  gridTemplateColumns: "1fr 1.3fr 90px 80px",
                  borderBottom: i < pending.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                }}
              >
                {/* Client */}
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] shrink-0"
                    style={{
                      background:
                        deal.type === "Auto"
                          ? "rgba(56,189,248,0.1)"
                          : deal.type === "Home"
                          ? "rgba(16,185,129,0.1)"
                          : "rgba(99,102,241,0.1)",
                      color:
                        deal.type === "Auto"
                          ? "#38BDF8"
                          : deal.type === "Home"
                          ? "#10B981"
                          : "#818CF8",
                    }}
                  >
                    <TypeIcon type={deal.type} />
                  </span>
                  <span className="text-sm text-[#E2E8F0] truncate" style={{ fontWeight: 500 }}>
                    {deal.client}
                  </span>
                </div>

                {/* Missing */}
                <span className="text-xs text-[#94A3B8] truncate">{deal.missing}</span>

                {/* Days */}
                <div className="flex items-center gap-1.5">
                  <Clock
                    size={11}
                    style={{ color: urgent ? "#F59E0B" : warning ? "#FCD34D" : "#4B5563" }}
                    className="shrink-0"
                  />
                  <span
                    className="text-xs px-2 py-0.5 rounded-full"
                    style={{
                      background: urgent
                        ? "rgba(245,158,11,0.15)"
                        : warning
                        ? "rgba(252,211,77,0.1)"
                        : "rgba(71,85,105,0.3)",
                      color: urgent ? "#F59E0B" : warning ? "#FCD34D" : "#64748B",
                      fontWeight: urgent ? 700 : 500,
                    }}
                  >
                    {deal.days}d
                  </span>
                </div>

                {/* Resolve */}
                {canResolve ? (
                  <button
                    onClick={() => setSelectedDeal(deal)}
                    className="text-xs px-3 py-1.5 rounded-lg transition-all hover:brightness-110 active:scale-95"
                    style={{
                      background: urgent
                        ? "rgba(245,158,11,0.12)"
                        : "rgba(56,189,248,0.1)",
                      color: urgent ? "#F59E0B" : "#38BDF8",
                      border: `1px solid ${urgent ? "rgba(245,158,11,0.2)" : "rgba(56,189,248,0.2)"}`,
                      fontWeight: 600,
                    }}
                  >
                    Resolve
                  </button>
                ) : (
                  <span className="text-xs text-[#4B5563]">—</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <ResolvePanel
        deal={selectedDeal}
        onClose={() => setSelectedDeal(null)}
        onResolved={handleResolved}
      />
    </>
  );
}
