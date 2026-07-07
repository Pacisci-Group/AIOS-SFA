import {
  Phone,
  Mail,
  ExternalLink,
  Users,
  FileText,
  Clock,
  MessageSquare,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  Send,
  Plus,
  User,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { Ticket, TicketStatus, TimelineEntry } from "./ticket-data";

interface WorkspacePanelProps {
  ticket: Ticket | null;
}

type DropStatus = TicketStatus;

const STATUS_CONFIG: Record<
  DropStatus,
  { label: string; bg: string; text: string; dot: string }
> = {
  open: {
    label: "Open",
    bg: "bg-[var(--kpi-blue-bg)]",
    text: "text-[var(--kpi-blue)]",
    dot: "bg-[var(--kpi-blue)]",
  },
  waiting: {
    label: "Waiting",
    bg: "bg-[var(--kpi-purple-bg)]",
    text: "text-[var(--kpi-purple)]",
    dot: "bg-[var(--kpi-purple)]",
  },
  resolved: {
    label: "Resolved",
    bg: "bg-[var(--kpi-green-bg)]",
    text: "text-[var(--kpi-green)]",
    dot: "bg-[var(--kpi-green)]",
  },
  overdue: {
    label: "Overdue",
    bg: "bg-[var(--kpi-amber-bg)]",
    text: "text-[var(--kpi-amber)]",
    dot: "bg-[var(--kpi-amber)]",
  },
};

const TIMELINE_ICONS: Record<TimelineEntry["type"], React.ReactNode> = {
  created: <Plus className="w-3.5 h-3.5" />,
  note: <MessageSquare className="w-3.5 h-3.5" />,
  status: <Zap className="w-3.5 h-3.5" />,
  system: <AlertCircle className="w-3.5 h-3.5" />,
  call: <Phone className="w-3.5 h-3.5" />,
};

const TIMELINE_ICON_BG: Record<TimelineEntry["type"], string> = {
  created: "bg-[var(--kpi-blue)] text-white",
  note: "bg-slate-700 text-white",
  status: "bg-[var(--kpi-amber)] text-white",
  system: "bg-muted text-muted-foreground",
  call: "bg-[var(--kpi-purple)] text-white",
};

export function WorkspacePanel({ ticket }: WorkspacePanelProps) {
  const [note, setNote] = useState("");
  const [statusDropdown, setStatusDropdown] = useState(false);
  const [currentStatus, setCurrentStatus] = useState<DropStatus>(
    ticket?.status ?? "open"
  );

  // reset local status when ticket changes
  const status = ticket ? currentStatus : "open";
  const sc = STATUS_CONFIG[status];

  if (!ticket) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-background text-center px-8">
        <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
          <FileText className="w-5 h-5 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium text-foreground mb-1">No ticket selected</p>
        <p className="text-xs text-muted-foreground">
          Click any ticket in the left panel to open the workspace.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      {/* Header */}
      <div className="bg-white border-b border-border px-5 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <h1 className="text-lg font-semibold text-foreground">{ticket.clientName}</h1>
              <span className="text-sm font-mono text-muted-foreground">#{ticket.ticketNumber}</span>
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Phone className="w-3 h-3" />
                {ticket.phone}
              </span>
              <span className="flex items-center gap-1">
                <Mail className="w-3 h-3" />
                {ticket.email}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Status dropdown */}
            <div className="relative">
              <button
                onClick={() => setStatusDropdown(!statusDropdown)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border ${sc.bg} ${sc.text} border-current/20 hover:opacity-80 transition-opacity`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />
                {sc.label}
                <ChevronDown className="w-3 h-3 opacity-60" />
              </button>
              {statusDropdown && (
                <div className="absolute right-0 top-full mt-1 bg-white border border-border rounded-md shadow-lg z-20 min-w-[130px] py-0.5">
                  {(Object.keys(STATUS_CONFIG) as DropStatus[]).map((s) => {
                    const c = STATUS_CONFIG[s];
                    return (
                      <button
                        key={s}
                        onClick={() => {
                          setCurrentStatus(s);
                          setStatusDropdown(false);
                        }}
                        className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted transition-colors text-left ${
                          s === status ? "font-semibold" : ""
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
                        {c.label}
                        {s === status && (
                          <CheckCircle2 className="w-3 h-3 ml-auto text-[var(--kpi-green)]" />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] px-5 py-4 space-y-4">
        {/* Data grid */}
        <div className="bg-white rounded-lg border border-border p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
            Ticket Details
          </h3>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2.5">
            <DataRow
              label="Assigned Rep"
              value={
                <span className="flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded-full bg-[var(--kpi-blue-bg)] flex items-center justify-center">
                    <User className="w-3 h-3 text-[var(--kpi-blue)]" />
                  </span>
                  {ticket.assignedRep}
                </span>
              }
            />
            <DataRow
              label="Category"
              value={ticket.category}
            />
            <DataRow
              label="Policy Linked"
              value={
                <button className="flex items-center gap-1 text-[var(--kpi-blue)] hover:underline">
                  {ticket.policyType} — {ticket.policyNumber}
                  <ExternalLink className="w-3 h-3" />
                </button>
              }
            />
            <DataRow
              label="Priority"
              value={
                <span
                  className={`px-1.5 py-0.5 rounded text-xs ${
                    ticket.priority === "high"
                      ? "bg-red-100 text-red-700"
                      : ticket.priority === "medium"
                      ? "bg-amber-100 text-amber-700"
                      : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {ticket.priority}
                </span>
              }
            />
            <DataRow
              label="Household"
              value={
                <button className="flex items-center gap-1 text-[var(--kpi-blue)] hover:underline">
                  <Users className="w-3 h-3" />
                  {ticket.household}
                  <ExternalLink className="w-3 h-3" />
                </button>
              }
            />
            <DataRow
              label="Days Open"
              value={
                <span
                  className={`font-mono text-sm font-semibold ${
                    ticket.daysOpen > 10
                      ? "text-[var(--kpi-amber)]"
                      : "text-foreground"
                  }`}
                >
                  {ticket.daysOpen}d
                </span>
              }
            />
          </div>
        </div>

        {/* Timeline */}
        <div className="bg-white rounded-lg border border-border p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Activity Timeline
            </h3>
            <span className="text-xs text-muted-foreground">
              {ticket.timeline.length} event{ticket.timeline.length !== 1 ? "s" : ""}
            </span>
          </div>

          <div className="relative">
            {/* Vertical line */}
            <div className="absolute left-3.5 top-4 bottom-4 w-px bg-border" />

            <div className="space-y-4">
              {ticket.timeline.map((entry) => (
                <div key={entry.id} className="flex gap-3 relative">
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 z-10 ${TIMELINE_ICON_BG[entry.type]}`}
                  >
                    {TIMELINE_ICONS[entry.type]}
                  </div>
                  <div className="flex-1 pb-0.5">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-mono text-muted-foreground">
                        {entry.timestamp}
                      </span>
                      {entry.author && (
                        <span className="text-xs text-muted-foreground">· {entry.author}</span>
                      )}
                    </div>
                    <p className="text-sm text-foreground leading-relaxed">{entry.content}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Note input */}
        <div className="bg-white rounded-lg border border-border p-4">
          <div className="flex items-center gap-2 mb-2">
            <MessageSquare className="w-3.5 h-3.5 text-muted-foreground" />
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Add Internal Note
            </h3>
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Type your note here — visible only to agency staff…"
            rows={3}
            className="w-full text-sm bg-[var(--input-background)] border border-border rounded-md px-3 py-2 outline-none focus:ring-2 focus:ring-[var(--ring)] resize-none placeholder:text-muted-foreground"
          />
          <div className="flex items-center justify-between mt-2">
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Will be timestamped and logged to timeline
            </span>
            <button
              onClick={() => setNote("")}
              disabled={!note.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--kpi-blue)] text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
            >
              <Send className="w-3 h-3" />
              Post Note
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DataRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm text-foreground">{value}</span>
    </div>
  );
}
