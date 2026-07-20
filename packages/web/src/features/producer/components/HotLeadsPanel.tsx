import { Phone, MessageSquare, Mail, Star, Clock } from "lucide-react";
import { usePermissions } from "@/hooks/usePermissions";

interface Lead {
  id: number;
  name: string;
  source: string;
  sourceEmoji: string;
  status: string;
  statusColor: string;
  priority: "hot" | "warm";
  initials: string;
  time: string;
}

const leads: Lead[] = [
  {
    id: 1,
    name: "Anurodh Vaidya",
    source: "Mailers",
    sourceEmoji: "✉️",
    status: "Quoted Yesterday — Waiting on premium approval",
    statusColor: "#F59E0B",
    priority: "hot",
    initials: "AV",
    time: "2h ago",
  },
  {
    id: 2,
    name: "Cassie Holloway",
    source: "Internet Lead",
    sourceEmoji: "🌐",
    status: "Requested auto quote — hasn't responded to follow-up",
    statusColor: "#38BDF8",
    priority: "hot",
    initials: "CH",
    time: "4h ago",
  },
  {
    id: 3,
    name: "Darius Wentworth",
    source: "Referral",
    sourceEmoji: "👤",
    status: "Bundle quote sent — decision pending before end of week",
    statusColor: "#10B981",
    priority: "hot",
    initials: "DW",
    time: "1d ago",
  },
  {
    id: 4,
    name: "Elena Park",
    source: "Mailers",
    sourceEmoji: "✉️",
    status: "Interested in home policy — needs comparison with current carrier",
    statusColor: "#818CF8",
    priority: "warm",
    initials: "EP",
    time: "1d ago",
  },
  {
    id: 5,
    name: "Franklin Torres",
    source: "Walk-in",
    sourceEmoji: "🏢",
    status: "Auto + renters bundle — price sensitive, close to decision",
    statusColor: "#F59E0B",
    priority: "warm",
    initials: "FT",
    time: "2d ago",
  },
];

export function HotLeadsPanel() {
  const { canWrite } = usePermissions();
  const canContact = canWrite("leads");

  return (
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
          <div className="w-1.5 h-5 rounded-full" style={{ background: "#F87171" }} />
          <h2 className="text-sm text-[#E2E8F0]" style={{ fontWeight: 600 }}>
            Priority Contact List
          </h2>
        </div>
        <span
          className="text-xs px-2 py-1 rounded-full flex items-center gap-1"
          style={{ background: "rgba(248,113,113,0.12)", color: "#F87171", fontWeight: 700 }}
        >
          <Star size={10} fill="currentColor" />
          Hot Leads
        </span>
      </div>

      {/* Lead cards */}
      <div className="flex flex-col gap-0 overflow-y-auto" style={{ maxHeight: "360px" }}>
        {leads.map((lead, i) => (
          <div
            key={lead.id}
            className="px-5 py-4 transition-all hover:bg-white/[0.02] group"
            style={{
              borderBottom: i < leads.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
            }}
          >
            {/* Top row */}
            <div className="flex items-start gap-3">
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center text-xs shrink-0 mt-0.5"
                style={{
                  background:
                    lead.priority === "hot"
                      ? "rgba(248,113,113,0.12)"
                      : "rgba(71,85,105,0.4)",
                  color: lead.priority === "hot" ? "#FCA5A5" : "#94A3B8",
                  fontWeight: 700,
                  border:
                    lead.priority === "hot"
                      ? "1px solid rgba(248,113,113,0.25)"
                      : "1px solid rgba(255,255,255,0.06)",
                }}
              >
                {lead.initials}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className="text-sm text-[#E2E8F0] truncate"
                    style={{ fontWeight: 600 }}
                  >
                    {lead.name}
                  </span>
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1 shrink-0"
                    style={{ background: "rgba(255,255,255,0.06)", color: "#94A3B8" }}
                  >
                    {lead.sourceEmoji} {lead.source}
                  </span>
                  {lead.priority === "hot" && (
                    <Star size={10} fill="#F59E0B" style={{ color: "#F59E0B" }} className="shrink-0" />
                  )}
                </div>

                <p
                  className="text-xs mt-1 leading-relaxed"
                  style={{ color: "#64748B" }}
                >
                  {lead.status}
                </p>
              </div>

              <div className="flex items-center gap-1 text-[10px] text-[#4B5563] shrink-0 mt-0.5">
                <Clock size={9} />
                {lead.time}
              </div>
            </div>

            {/* Action bar */}
            {canContact && (
            <div className="flex items-center gap-2 mt-3 ml-12">
              <button
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all hover:brightness-110 active:scale-95"
                style={{
                  background: "rgba(16,185,129,0.1)",
                  color: "#10B981",
                  border: "1px solid rgba(16,185,129,0.2)",
                  fontWeight: 500,
                }}
              >
                <Phone size={11} />
                Call
              </button>
              <button
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all hover:brightness-110 active:scale-95"
                style={{
                  background: "rgba(56,189,248,0.1)",
                  color: "#38BDF8",
                  border: "1px solid rgba(56,189,248,0.2)",
                  fontWeight: 500,
                }}
              >
                <MessageSquare size={11} />
                Text
              </button>
              <button
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all hover:brightness-110 active:scale-95"
                style={{
                  background: "rgba(99,102,241,0.1)",
                  color: "#818CF8",
                  border: "1px solid rgba(99,102,241,0.2)",
                  fontWeight: 500,
                }}
              >
                <Mail size={11} />
                Email
              </button>
            </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
