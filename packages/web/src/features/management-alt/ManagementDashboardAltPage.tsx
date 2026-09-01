import { useState, useEffect } from "react";
import { Phone, MessageSquare, X, Search, ExternalLink, ChevronRight, Flame, Clock, AlertCircle, CheckCircle2, Mail, User, Home, DollarSign, Zap, Bell } from "lucide-react";
import { AppSidebar } from "@/components/layout/AppSidebar";

// ─── Types ───────────────────────────────────────────────────────────────────

type AgingLevel = "fresh" | "warm" | "hot" | "critical";
type SourceBadge = "EverQuote" | "Web Form" | "Cold Inbound" | "Referral" | "Facebook Ad" | "Google Ad";
type PipelineTag = "follow-up" | "quoted" | "hot";
type SidecarState = "closed" | "mailer" | "lead-detail";

interface UnclaimedLead {
  id: string;
  name: string;
  source: SourceBadge;
  phone: string;
  arrivedAt: Date;
  agingLevel: AgingLevel;
  agingLabel: string;
  vehicle?: string;
  currentLimits?: string;
  notes?: string;
  email?: string;
}

interface PipelineLead {
  id: string;
  name: string;
  source: SourceBadge;
  phone: string;
  tag: PipelineTag;
  lastContact: string;
  followUpDate: string;
  premium?: string;
  status: string;
  email?: string;
}

// ─── Mock Data ────────────────────────────────────────────────────────────────

const now = new Date();
const minsAgo = (m: number) => new Date(now.getTime() - m * 60000);
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600000);
const daysAgo = (d: number) => new Date(now.getTime() - d * 86400000);

const UNCLAIMED_LEADS: UnclaimedLead[] = [
  { id: "u1", name: "Sandra Kowalski", source: "EverQuote", phone: "(405) 882-3341", arrivedAt: minsAgo(4), agingLevel: "fresh", agingLabel: "4 mins ago", vehicle: "2021 Toyota Camry", currentLimits: "100/300/100", email: "s.kowalski@gmail.com" },
  { id: "u2", name: "Marcus Delgado", source: "Web Form", phone: "(918) 554-0129", arrivedAt: minsAgo(22), agingLevel: "fresh", agingLabel: "22 mins ago", vehicle: "2019 Ford F-150", currentLimits: "50/100/50", notes: "Mentioned comparing 3 carriers", email: "mdelgado@outlook.com" },
  { id: "u3", name: "Priya Nambiar", source: "Google Ad", phone: "(580) 773-4422", arrivedAt: hoursAgo(2), agingLevel: "warm", agingLabel: "2 hrs ago", vehicle: "2022 Honda CR-V", currentLimits: "25/50/25", email: "priya.n@yahoo.com" },
  { id: "u4", name: "Tyler Renfrow", source: "Facebook Ad", phone: "(405) 210-8875", arrivedAt: hoursAgo(5), agingLevel: "hot", agingLabel: "5 hrs ago", notes: "Has spouse on same policy", email: "tyler.renfrow@gmail.com" },
  { id: "u5", name: "Deborah Faulkner", source: "Cold Inbound", phone: "(918) 334-7710", arrivedAt: hoursAgo(9), agingLevel: "hot", agingLabel: "9 hrs ago", vehicle: "2018 Chevy Silverado", currentLimits: "100/300/100", email: "dfaulkner@hotmail.com" },
  { id: "u6", name: "James Whitmore", source: "EverQuote", phone: "(580) 441-2098", arrivedAt: daysAgo(1), agingLevel: "critical", agingLabel: "1 day ago", vehicle: "2020 Kia Sorento", email: "jwhitmore@gmail.com" },
  { id: "u7", name: "Alicia Tran", source: "Referral", phone: "(405) 667-3341", arrivedAt: daysAgo(2), agingLevel: "critical", agingLabel: "2 days ago", currentLimits: "50/100/50", notes: "Referred by existing client Dave Tran", email: "aliciatran@email.com" },
];

const PIPELINE_LEADS: PipelineLead[] = [
  { id: "p1", name: "Norah Blackwell", source: "EverQuote", phone: "(405) 338-1190", tag: "hot", lastContact: "Today 10:42 AM", followUpDate: "Today 3:00 PM", premium: "$1,247/yr", status: "Quoted — Awaiting Signature", email: "nblackwell@gmail.com" },
  { id: "p2", name: "Garrett Simmons", source: "Web Form", phone: "(918) 220-4457", tag: "hot", lastContact: "Today 9:15 AM", followUpDate: "Today 1:30 PM", premium: "$2,108/yr", status: "Review Call Scheduled", email: "gsimmons@outlook.com" },
  { id: "p3", name: "Cynthia Okonkwo", source: "Referral", phone: "(580) 882-3341", tag: "quoted", lastContact: "Yesterday 4:30 PM", followUpDate: "Tomorrow 10:00 AM", premium: "$1,816/yr", status: "Quote Sent — Pending Review", email: "c.okonkwo@yahoo.com" },
  { id: "p4", name: "Brandon Xu", source: "Google Ad", phone: "(405) 554-7712", tag: "quoted", lastContact: "Jun 20", followUpDate: "Jun 23 2:00 PM", premium: "$943/yr", status: "Quoted — No Response", email: "brandon.xu@gmail.com" },
  { id: "p5", name: "Michelle Portillo", source: "Facebook Ad", phone: "(918) 773-0034", tag: "follow-up", lastContact: "Jun 19", followUpDate: "Today EOD", premium: undefined, status: "Needs Callback", email: "mportillo@gmail.com" },
  { id: "p6", name: "Kevin O'Brien", source: "Cold Inbound", phone: "(580) 334-5521", tag: "follow-up", lastContact: "Jun 18", followUpDate: "Jun 23 9:00 AM", premium: undefined, status: "Left Voicemail ×2", email: "kobrien@hotmail.com" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SOURCE_COLORS: Record<SourceBadge, string> = {
  "EverQuote":   "bg-blue-900/60 text-blue-300 border border-blue-700/40",
  "Web Form":    "bg-indigo-900/60 text-indigo-300 border border-indigo-700/40",
  "Cold Inbound":"bg-slate-700/60 text-slate-300 border border-slate-600/40",
  "Referral":    "bg-purple-900/60 text-purple-300 border border-purple-700/40",
  "Facebook Ad": "bg-sky-900/60 text-sky-300 border border-sky-700/40",
  "Google Ad":   "bg-cyan-900/60 text-cyan-300 border border-cyan-700/40",
};

const AGING_CONFIG: Record<AgingLevel, { dot: string; text: string; pulse: boolean }> = {
  fresh:    { dot: "bg-emerald-400",  text: "text-emerald-400", pulse: false },
  warm:     { dot: "bg-amber-400",    text: "text-amber-400",   pulse: false },
  hot:      { dot: "bg-orange-500",   text: "text-orange-400",  pulse: false },
  critical: { dot: "bg-red-500",      text: "text-red-400",     pulse: true  },
};

const TAG_CONFIG: Record<PipelineTag, { label: string; color: string }> = {
  "hot":       { label: "Hot Lead 🔥", color: "text-orange-400 bg-orange-950/50 border border-orange-700/30" },
  "quoted":    { label: "Quoted / Review Pending", color: "text-sky-400 bg-sky-950/50 border border-sky-700/30" },
  "follow-up": { label: "Follow-up Due", color: "text-amber-400 bg-amber-950/50 border border-amber-700/30" },
};

// ─── Mailer QCN data ──────────────────────────────────────────────────────────

const QCN_RESULTS: Record<string, { name: string; address: string; premium: string; sqft: string; yearBuilt: string }> = {
  "43ca417e5836": { name: "Matthew Quickel", address: "202 S Byrd St, Tishomingo, OK 73460", premium: "$1,816.44", sqft: "1,785", yearBuilt: "1975" },
  "7b2f9c3d1a84": { name: "Patricia Nguyen", address: "815 Oak Ridge Dr, Ada, OK 74820", premium: "$2,104.00", sqft: "2,140", yearBuilt: "1988" },
  "a1e5d8f23c97": { name: "Robert Caldwell", address: "1044 Maple Ave, Durant, OK 74701", premium: "$1,492.60", sqft: "1,620", yearBuilt: "1967" },
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function AgingBadge({ level, label }: { level: AgingLevel; label: string }) {
  const cfg = AGING_CONFIG[level];
  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-xs ${cfg.text}`}>
      <span className={`relative flex h-2 w-2 shrink-0`}>
        {cfg.pulse && <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${cfg.dot} opacity-60`} />}
        <span className={`relative inline-flex rounded-full h-2 w-2 ${cfg.dot}`} />
      </span>
      {label}
    </span>
  );
}

function SourcePill({ source }: { source: SourceBadge }) {
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium font-mono ${SOURCE_COLORS[source]}`}>
      {source}
    </span>
  );
}

// ─── Sidecar: Mailer QCN Panel ────────────────────────────────────────────────

function SidecarMailer({ onClose }: { onClose: () => void }) {
  const [qcn, setQcn] = useState("43ca417e5836");
  const [result, setResult] = useState<typeof QCN_RESULTS[string] | null>(QCN_RESULTS["43ca417e5836"]);
  const [logged, setLogged] = useState(false);

  const handleSearch = (val: string) => {
    setQcn(val);
    setLogged(false);
    setResult(QCN_RESULTS[val.trim()] ?? null);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <Mail size={15} className="text-success" />
            <span className="text-xs font-mono font-medium text-success uppercase tracking-widest">Mailer QCN Lookup</span>
          </div>
          <p className="text-muted-foreground text-xs">Enter a Quote Control Number to pull property data</p>
        </div>
        <button onClick={onClose} className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
          <X size={16} />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
        {/* Search */}
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Quote Control Number</label>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={qcn}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Enter QCN (e.g. 43ca417e5836)"
              className="w-full pl-9 pr-4 py-2.5 bg-secondary rounded-lg border border-border font-mono text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary transition-all"
            />
          </div>
        </div>

        {/* Result Card */}
        {result ? (
          <div className="space-y-4">
            {/* Recipient */}
            <div className="bg-secondary rounded-lg border border-border p-4">
              <div className="flex items-center gap-2 mb-3">
                <User size={13} className="text-primary" />
                <span className="text-xs font-mono uppercase tracking-widest text-primary">Recipient</span>
              </div>
              <p className="text-foreground font-semibold text-base leading-tight">{result.name}</p>
              <p className="text-muted-foreground text-sm mt-1 leading-snug">{result.address}</p>
            </div>

            {/* Property Details */}
            <div className="bg-secondary rounded-lg border border-border p-4">
              <div className="flex items-center gap-2 mb-3">
                <Home size={13} className="text-success" />
                <span className="text-xs font-mono uppercase tracking-widest text-success">Property Details</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Est. Yearly Premium</p>
                  <p className="text-foreground font-mono font-semibold text-lg">{result.premium}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Year Built</p>
                  <p className="text-foreground font-mono font-semibold text-lg">{result.yearBuilt}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">Square Footage</p>
                  <p className="text-foreground font-mono font-semibold text-lg">{result.sqft} sq ft</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">QCN Hash</p>
                  <p className="text-muted-foreground font-mono text-xs truncate">{qcn}</p>
                </div>
              </div>
            </div>
          </div>
        ) : qcn.length > 0 ? (
          <div className="bg-secondary rounded-lg border border-border/50 border-dashed p-6 text-center">
            <AlertCircle size={20} className="text-muted-foreground mx-auto mb-2" />
            <p className="text-muted-foreground text-sm">No record found for <span className="font-mono text-foreground">{qcn}</span></p>
          </div>
        ) : null}
      </div>

      {/* Footer actions */}
      {result && (
        <div className="px-5 py-4 border-t border-border shrink-0 space-y-3">
          <button
            onClick={() => setLogged(true)}
            className={`w-full py-3 rounded-lg font-semibold text-sm transition-all flex items-center justify-center gap-2 ${
              logged
                ? "bg-emerald-700/40 text-emerald-300 border border-emerald-700/50 cursor-default"
                : "bg-success text-white hover:bg-emerald-500 active:scale-[0.98]"
            }`}
          >
            {logged ? <><CheckCircle2 size={15} /> Logged to Pipeline</> : <><Zap size={15} /> LOG LEAD INTO MY WORKING PIPELINE</>}
          </button>
          <a
            href={`https://www.zillow.com/homes/${encodeURIComponent(result.address)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full py-2.5 rounded-lg font-medium text-sm transition-all flex items-center justify-center gap-2 text-primary border border-primary/40 hover:bg-primary/10 active:scale-[0.98]"
          >
            <ExternalLink size={14} /> View Property on Zillow
          </a>
        </div>
      )}
    </div>
  );
}

// ─── Sidecar: Lead Detail Panel ───────────────────────────────────────────────

function SidecarLeadDetail({ lead, onClose, onClaim }: { lead: UnclaimedLead; onClose: () => void; onClaim: () => void }) {
  const [claimed, setClaimed] = useState(false);

  const handleClaim = () => {
    setClaimed(true);
    setTimeout(onClaim, 1200);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <User size={14} className="text-primary" />
            <span className="text-xs font-mono font-medium text-primary uppercase tracking-widest">Lead Detail</span>
          </div>
          <p className="text-foreground font-semibold text-base leading-tight">{lead.name}</p>
        </div>
        <button onClick={onClose} className="p-1.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
          <X size={16} />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
        {/* Source & Aging */}
        <div className="flex items-center justify-between">
          <SourcePill source={lead.source} />
          <AgingBadge level={lead.agingLevel} label={lead.agingLabel} />
        </div>

        {/* Contact Info */}
        <div className="bg-secondary rounded-lg border border-border p-4 space-y-3">
          <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Contact</p>
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <Phone size={13} className="text-primary shrink-0" />
              <span className="font-mono text-sm text-foreground">{lead.phone}</span>
            </div>
            {lead.email && (
              <div className="flex items-center gap-3">
                <Mail size={13} className="text-primary shrink-0" />
                <span className="font-mono text-sm text-foreground">{lead.email}</span>
              </div>
            )}
          </div>
        </div>

        {/* Pre-scraped Context */}
        {(lead.vehicle || lead.currentLimits || lead.notes) && (
          <div className="bg-secondary rounded-lg border border-border p-4 space-y-3">
            <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">Pre-scraped Context</p>
            <div className="space-y-2.5">
              {lead.vehicle && (
                <div>
                  <p className="text-xs text-muted-foreground">Current Vehicle</p>
                  <p className="text-sm text-foreground font-medium">{lead.vehicle}</p>
                </div>
              )}
              {lead.currentLimits && (
                <div>
                  <p className="text-xs text-muted-foreground">Current Limits</p>
                  <p className="text-sm font-mono text-foreground">{lead.currentLimits}</p>
                </div>
              )}
              {lead.notes && (
                <div>
                  <p className="text-xs text-muted-foreground">Agent Notes</p>
                  <p className="text-sm text-foreground italic">{lead.notes}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Arrival info */}
        <div className="bg-secondary rounded-lg border border-border p-4">
          <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-2">Arrived</p>
          <p className="text-sm text-foreground font-mono">{lead.arrivedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} — {lead.arrivedAt.toLocaleDateString([], { month: "short", day: "numeric" })}</p>
        </div>
      </div>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-border shrink-0 space-y-3">
        <button
          onClick={handleClaim}
          disabled={claimed}
          className={`w-full py-3 rounded-lg font-semibold text-sm transition-all flex items-center justify-center gap-2 ${
            claimed
              ? "bg-emerald-700/40 text-emerald-300 border border-emerald-700/50 cursor-default"
              : "bg-primary text-white hover:bg-[#0089C0] active:scale-[0.98]"
          }`}
        >
          {claimed ? <><CheckCircle2 size={15} /> Lead Claimed — Moving to Pipeline</> : <><Phone size={15} /> Confirm Outreach & Claim Lead</>}
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button className="py-2.5 rounded-lg font-medium text-sm flex items-center justify-center gap-1.5 text-foreground border border-border hover:bg-muted transition-colors">
            <Phone size={13} /> Call
          </button>
          <button className="py-2.5 rounded-lg font-medium text-sm flex items-center justify-center gap-1.5 text-foreground border border-border hover:bg-muted transition-colors">
            <MessageSquare size={13} /> Text
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [sidecarState, setSidecarState] = useState<SidecarState>("closed");
  const [selectedLead, setSelectedLead] = useState<UnclaimedLead | null>(null);
  const [unclaimedLeads, setUnclaimedLeads] = useState<UnclaimedLead[]>(UNCLAIMED_LEADS);
  const [pipelineLeads, setPipelineLeads] = useState<PipelineLead[]>(PIPELINE_LEADS);
  const [claimedIds, setClaimedIds] = useState<Set<string>>(new Set());
  const [activeTag, setActiveTag] = useState<"all" | PipelineTag>("all");

  const openMailer = () => {
    setSelectedLead(null);
    setSidecarState("mailer");
  };

  const openLeadDetail = (lead: UnclaimedLead) => {
    setSelectedLead(lead);
    setSidecarState("lead-detail");
  };

  const closeSidecar = () => {
    setSidecarState("closed");
    setSelectedLead(null);
  };

  const claimLead = (lead: UnclaimedLead, method: "call" | "text") => {
    setClaimedIds((prev) => new Set([...prev, lead.id]));
    const newPipeline: PipelineLead = {
      id: `claimed-${lead.id}`,
      name: lead.name,
      source: lead.source,
      phone: lead.phone,
      tag: "follow-up",
      lastContact: "Just now",
      followUpDate: "Today EOD",
      status: method === "call" ? "Claimed via Call" : "Claimed via Text",
      email: lead.email,
    };
    setPipelineLeads((prev) => [newPipeline, ...prev]);
    setTimeout(() => {
      setUnclaimedLeads((prev) => prev.filter((l) => l.id !== lead.id));
      setClaimedIds((prev) => { const next = new Set(prev); next.delete(lead.id); return next; });
    }, 800);
  };

  const claimFromSidecar = () => {
    if (!selectedLead) return;
    claimLead(selectedLead, "call");
    closeSidecar();
  };

  const filteredPipeline = activeTag === "all"
    ? pipelineLeads
    : pipelineLeads.filter((l) => l.tag === activeTag);

  const grouped = {
    hot: filteredPipeline.filter((l) => l.tag === "hot"),
    quoted: filteredPipeline.filter((l) => l.tag === "quoted"),
    "follow-up": filteredPipeline.filter((l) => l.tag === "follow-up"),
  };

  const sidecarOpen = sidecarState !== "closed";

  return (
    <div className="flex min-h-screen bg-background">
      <AppSidebar />
      <div className="flex-1 min-w-0 min-h-screen bg-background text-foreground flex flex-col" style={{ fontFamily: "'Inter', sans-serif" }}>
      {/* Top Nav Bar */}
      <header className="shrink-0 h-14 border-b border-border flex items-center justify-between px-6 bg-[#0d1421]">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded bg-primary flex items-center justify-center">
            <span className="text-white font-bold text-xs">A</span>
          </div>
          <span className="font-semibold text-foreground text-sm tracking-wide">Agency Command Center</span>
          <span className="text-border">|</span>
          <span className="text-muted-foreground text-xs font-mono">Jenkins Insurance Group</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Live Feed Active
          </div>
          <button className="relative p-2 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
            <Bell size={15} />
            <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-red-500" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-primary/30 border border-primary/50 flex items-center justify-center text-xs font-semibold text-primary">MJ</div>
            <span className="text-sm text-foreground font-medium">Mike Jenkins</span>
          </div>
        </div>
      </header>

      {/* Main Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Main Feed */}
        <div className={`flex-1 flex flex-col overflow-hidden transition-all duration-300 ${sidecarOpen ? "mr-0" : ""}`}>
          <div className="flex-1 overflow-y-auto p-6 space-y-6">

            {/* ── Unclaimed Pool ─────────────────────────────────────────── */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <h2 className="text-sm font-semibold text-foreground uppercase tracking-widest">Unclaimed Agency Leads Pool</h2>
                  <span className="px-2.5 py-0.5 rounded-full bg-primary text-white text-xs font-mono font-bold">
                    {unclaimedLeads.length} New
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
                  <Clock size={12} />
                  Updated just now
                </div>
              </div>

              <div className="bg-card rounded-xl border border-border overflow-hidden">
                {/* Table Header */}
                <div className="grid gap-4 px-5 py-3 border-b border-border bg-secondary/50 text-xs font-mono uppercase tracking-widest text-muted-foreground"
                  style={{ gridTemplateColumns: "1fr 140px 130px 130px 220px" }}>
                  <span>Lead Name</span>
                  <span>Source</span>
                  <span>Phone</span>
                  <span>Aging</span>
                  <span>Action</span>
                </div>

                {/* Rows */}
                {unclaimedLeads.length === 0 ? (
                  <div className="px-5 py-10 text-center text-muted-foreground text-sm">
                    <CheckCircle2 size={20} className="mx-auto mb-2 text-success" />
                    All leads claimed. Great work!
                  </div>
                ) : (
                  unclaimedLeads.map((lead) => {
                    const isBeingClaimed = claimedIds.has(lead.id);
                    return (
                      <div
                        key={lead.id}
                        className={`grid gap-4 px-5 py-3.5 border-b border-border last:border-b-0 items-center transition-all duration-500 ${
                          isBeingClaimed ? "opacity-30 scale-[0.99]" : "hover:bg-secondary/40"
                        }`}
                        style={{ gridTemplateColumns: "1fr 140px 130px 130px 220px" }}
                      >
                        <button
                          onClick={() => openLeadDetail(lead)}
                          className="text-left text-primary font-semibold text-sm hover:underline hover:text-[#0089C0] transition-colors"
                        >
                          {lead.name}
                        </button>
                        <SourcePill source={lead.source} />
                        <span className="font-mono text-xs text-muted-foreground">{lead.phone}</span>
                        <AgingBadge level={lead.agingLevel} label={lead.agingLabel} />
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => claimLead(lead, "call")}
                            disabled={isBeingClaimed}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/30 text-primary text-xs font-medium hover:bg-primary/20 transition-colors disabled:opacity-40"
                          >
                            <Phone size={12} /> Claim via Call
                          </button>
                          <button
                            onClick={() => claimLead(lead, "text")}
                            disabled={isBeingClaimed}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted border border-border text-muted-foreground text-xs font-medium hover:bg-secondary hover:text-foreground transition-colors disabled:opacity-40"
                          >
                            <MessageSquare size={12} /> Text
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </section>

            {/* ── My Active Pipeline ─────────────────────────────────────── */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <h2 className="text-sm font-semibold text-foreground uppercase tracking-widest">My Working & Hot Leads Pipeline</h2>
                  <span className="px-2.5 py-0.5 rounded-full bg-secondary border border-border text-muted-foreground text-xs font-mono">
                    {pipelineLeads.length} Active
                  </span>
                </div>
                {/* Tag filters */}
                <div className="flex items-center gap-2">
                  {(["all", "hot", "quoted", "follow-up"] as const).map((tag) => (
                    <button
                      key={tag}
                      onClick={() => setActiveTag(tag)}
                      className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                        activeTag === tag
                          ? "bg-primary text-white"
                          : "bg-secondary text-muted-foreground hover:text-foreground border border-border"
                      }`}
                    >
                      {tag === "all" ? "All" : TAG_CONFIG[tag].label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                {(["hot", "quoted", "follow-up"] as const).map((tag) => {
                  const leads = grouped[tag];
                  if (leads.length === 0) return null;
                  const tagCfg = TAG_CONFIG[tag];
                  return (
                    <div key={tag} className="bg-card rounded-xl border border-border overflow-hidden">
                      {/* Group header */}
                      <div className="px-5 py-2.5 border-b border-border bg-secondary/40 flex items-center gap-2.5">
                        <span className={`px-2.5 py-0.5 rounded text-xs font-mono font-medium ${tagCfg.color}`}>
                          {tagCfg.label}
                        </span>
                        <span className="text-xs text-muted-foreground font-mono">{leads.length} leads</span>
                      </div>

                      {/* Table header */}
                      <div className="grid gap-4 px-5 py-2.5 border-b border-border text-xs font-mono uppercase tracking-widest text-muted-foreground"
                        style={{ gridTemplateColumns: "1fr 140px 130px 1fr 1fr 120px" }}>
                        <span>Name</span>
                        <span>Source</span>
                        <span>Phone</span>
                        <span>Status</span>
                        <span>Follow-up</span>
                        <span>Quick Action</span>
                      </div>

                      {leads.map((lead) => (
                        <div
                          key={lead.id}
                          className="grid gap-4 px-5 py-3.5 border-b border-border last:border-b-0 items-center hover:bg-secondary/30 transition-colors"
                          style={{ gridTemplateColumns: "1fr 140px 130px 1fr 1fr 120px" }}
                        >
                          <div>
                            <p className="text-sm font-semibold text-foreground leading-tight">{lead.name}</p>
                            {lead.premium && (
                              <p className="text-xs font-mono text-success mt-0.5">{lead.premium}</p>
                            )}
                          </div>
                          <SourcePill source={lead.source} />
                          <span className="font-mono text-xs text-muted-foreground">{lead.phone}</span>
                          <span className="text-xs text-muted-foreground leading-snug">{lead.status}</span>
                          <div className="flex items-center gap-1.5 text-xs text-amber-400 font-mono">
                            <Clock size={11} className="shrink-0" />
                            {lead.followUpDate}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <button className="p-1.5 rounded bg-primary/10 border border-primary/20 text-primary hover:bg-primary/20 transition-colors">
                              <Phone size={12} />
                            </button>
                            <button className="p-1.5 rounded bg-muted border border-border text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                              <MessageSquare size={12} />
                            </button>
                            <button className="p-1.5 rounded bg-muted border border-border text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                              <ChevronRight size={12} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </section>

          </div>
        </div>

        {/* ── Right Sidecar ─────────────────────────────────────────────────── */}
        <div
          className={`shrink-0 border-l border-border bg-card overflow-hidden flex flex-col transition-all duration-300 ease-in-out ${
            sidecarOpen ? "w-[420px]" : "w-0"
          }`}
          style={{ boxShadow: sidecarOpen ? "-8px 0 32px rgba(0,0,0,0.5)" : "none" }}
        >
          {sidecarOpen && (
            <div className="w-[420px] h-full flex flex-col">
              {sidecarState === "mailer" && <div className="flex flex-col flex-1 min-h-0 h-full"><SidecarMailer onClose={closeSidecar} /></div>}
              {sidecarState === "lead-detail" && selectedLead && (
                <SidecarLeadDetail lead={selectedLead} onClose={closeSidecar} onClaim={claimFromSidecar} />
              )}
            </div>
          )}
        </div>
      </div>

      {/* Sticky Mailer Button.
          `bottom-20`, not `bottom-6`: the app-wide "Report a bug" FAB
          (`features/bug-report/ReportBugWidget`) is mounted on every signed-in
          page and owns `bottom-6 right-6`. This is the one page that had its
          own corner button, so it stacks above it. */}
      <button
        onClick={openMailer}
        className={`fixed bottom-20 right-6 flex items-center gap-2.5 px-5 py-3 rounded-xl font-semibold text-sm shadow-2xl transition-all duration-200 hover:scale-105 active:scale-100 z-50 ${
          sidecarState === "mailer"
            ? "bg-success text-white shadow-emerald-900/50"
            : "bg-success text-white shadow-emerald-900/30 hover:bg-emerald-500"
        }`}
      >
        <Mail size={15} />
        Fast Log Mailer <span className="font-mono font-bold">(QCN)</span>
      </button>
      </div>
    </div>
  );
}
