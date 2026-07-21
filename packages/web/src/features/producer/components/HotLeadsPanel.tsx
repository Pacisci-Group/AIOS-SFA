import { Phone, MessageSquare, Mail, Star, Clock } from "lucide-react";
import { usePermissions } from "@/hooks/usePermissions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface Lead {
  id: number;
  name: string;
  source: string;
  sourceEmoji: string;
  status: string;
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
    priority: "warm",
    initials: "FT",
    time: "2d ago",
  },
];

const contactButton =
  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all hover:brightness-110 active:scale-95";

export function HotLeadsPanel() {
  const { canWrite } = usePermissions();
  const canContact = canWrite("leads");

  return (
    <Card className="flex flex-col rounded-xl overflow-hidden p-0 gap-0 bg-card border-border">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-5 rounded-full bg-red-400" />
          <h2 className="text-sm text-foreground font-semibold">
            Priority Contact List
          </h2>
        </div>
        <Badge className="bg-red-400/12 text-red-400 border-transparent rounded-full text-xs font-bold gap-1">
          <Star size={10} fill="currentColor" />
          Hot Leads
        </Badge>
      </div>

      {/* Lead cards */}
      <div className="flex flex-col gap-0 overflow-y-auto" style={{ maxHeight: "360px" }}>
        {leads.map((lead, i) => (
          <div
            key={lead.id}
            className={cn(
              "px-5 py-4 transition-all hover:bg-white/[0.02] group",
              i < leads.length - 1 && "border-b border-white/[0.04]",
            )}
          >
            {/* Top row */}
            <div className="flex items-start gap-3">
              <div
                className={cn(
                  "w-9 h-9 rounded-full flex items-center justify-center text-xs shrink-0 mt-0.5 font-bold border",
                  lead.priority === "hot"
                    ? "bg-red-400/12 text-red-300 border-red-400/25"
                    : "bg-slate-600/40 text-slate-400 border-white/[0.06]",
                )}
              >
                {lead.initials}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-foreground truncate font-semibold">
                    {lead.name}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1 shrink-0 bg-white/[0.06] text-slate-400">
                    {lead.sourceEmoji} {lead.source}
                  </span>
                  {lead.priority === "hot" && (
                    <Star size={10} className="shrink-0 text-amber-500" fill="currentColor" />
                  )}
                </div>

                <p className="text-xs mt-1 leading-relaxed text-muted-foreground">
                  {lead.status}
                </p>
              </div>

              <div className="flex items-center gap-1 text-[10px] text-slate-600 shrink-0 mt-0.5">
                <Clock size={9} />
                {lead.time}
              </div>
            </div>

            {/* Action bar */}
            {canContact && (
              <div className="flex items-center gap-2 mt-3 ml-12">
                <button className={cn(contactButton, "bg-emerald-500/10 text-emerald-500 border-emerald-500/20")}>
                  <Phone size={11} />
                  Call
                </button>
                <button className={cn(contactButton, "bg-sky-400/10 text-sky-400 border-sky-400/20")}>
                  <MessageSquare size={11} />
                  Text
                </button>
                <button className={cn(contactButton, "bg-indigo-400/10 text-indigo-400 border-indigo-400/20")}>
                  <Mail size={11} />
                  Email
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
