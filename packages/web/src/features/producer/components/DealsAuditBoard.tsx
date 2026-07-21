import { Car, Home, Package, Clock, CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { usePermissions } from "@/hooks/usePermissions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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

const typeStyles: Record<Deal["type"], string> = {
  Auto: "bg-sky-400/10 text-sky-400",
  Home: "bg-emerald-500/10 text-emerald-500",
  Bundle: "bg-indigo-400/10 text-indigo-400",
};

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
      prev.map((d) => (d.id === id ? { ...d, resolved: true } : d)),
    );
  };

  const pending = deals.filter((d) => !d.resolved);
  const resolved = deals.filter((d) => d.resolved);

  return (
    <>
      <Card className="flex flex-col rounded-xl overflow-hidden p-0 gap-0 bg-card border-border">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-5 rounded-full bg-amber-500" />
            <h2 className="text-sm text-foreground font-semibold">
              Deals Pending Service Hand-off
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {resolved.length > 0 && (
              <Badge className="bg-emerald-500/12 text-emerald-500 border-transparent rounded-full text-xs gap-1">
                <CheckCircle2 size={10} />
                {resolved.length} resolved
              </Badge>
            )}
            <Badge className="bg-amber-500/15 text-amber-500 border-transparent rounded-full text-xs font-bold">
              {pending.length} Outstanding
            </Badge>
          </div>
        </div>

        {/* Column Headers */}
        <div
          className="grid px-5 py-2.5 gap-3 border-b border-white/[0.04]"
          style={{ gridTemplateColumns: "1fr 1.3fr 90px 80px" }}
        >
          {["Client", "Missing Requirement", "Days Open", "Action"].map((h) => (
            <span key={h} className="text-[10px] uppercase tracking-widest text-slate-600">
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
                className={cn(
                  "grid px-5 py-3.5 gap-3 items-center transition-all hover:bg-white/[0.02] group",
                  i < pending.length - 1 && "border-b border-white/[0.04]",
                )}
                style={{ gridTemplateColumns: "1fr 1.3fr 90px 80px" }}
              >
                {/* Client */}
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={cn(
                      "flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] shrink-0",
                      typeStyles[deal.type],
                    )}
                  >
                    <TypeIcon type={deal.type} />
                  </span>
                  <span className="text-sm text-foreground truncate font-medium">
                    {deal.client}
                  </span>
                </div>

                {/* Missing */}
                <span className="text-xs text-slate-400 truncate">{deal.missing}</span>

                {/* Days */}
                <div className="flex items-center gap-1.5">
                  <Clock
                    size={11}
                    className={cn(
                      "shrink-0",
                      urgent ? "text-amber-500" : warning ? "text-amber-300" : "text-slate-600",
                    )}
                  />
                  <span
                    className={cn(
                      "text-xs px-2 py-0.5 rounded-full",
                      urgent
                        ? "bg-amber-500/15 text-amber-500 font-bold"
                        : warning
                        ? "bg-amber-300/10 text-amber-300 font-medium"
                        : "bg-slate-600/30 text-slate-500 font-medium",
                    )}
                  >
                    {deal.days}d
                  </span>
                </div>

                {/* Resolve */}
                {canResolve ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSelectedDeal(deal)}
                    className={cn(
                      "rounded-lg font-semibold hover:brightness-110 active:scale-95",
                      urgent
                        ? "bg-amber-500/12 text-amber-500 border-amber-500/20 hover:bg-amber-500/12"
                        : "bg-sky-400/10 text-sky-400 border-sky-400/20 hover:bg-sky-400/10",
                    )}
                  >
                    Resolve
                  </Button>
                ) : (
                  <span className="text-xs text-slate-600">—</span>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <ResolvePanel
        deal={selectedDeal}
        onClose={() => setSelectedDeal(null)}
        onResolved={handleResolved}
      />
    </>
  );
}
