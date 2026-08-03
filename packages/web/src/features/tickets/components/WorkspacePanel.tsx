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
import { useEffect, useMemo, useRef, useState } from "react";
import {
  SERVICE_TICKET_PICKER_STATUSES,
  type OnboardingChecklistKey,
  type OnboardingStepKey,
  type RenewalOutcome,
  type RenewalStepKey,
  type ServiceTicketNoteType,
} from "@sfa/shared";
import { HouseholdDrawer } from "@/features/clients/components/HouseholdDrawer";
import { PolicyDrawer } from "@/features/clients/components/PolicyDrawer";
import { OnboardingPanel } from "./OnboardingPanel";
import { RenewalPanel } from "./RenewalPanel";
import {
  TICKET_STATUS_CONFIG as STATUS_CONFIG,
  Ticket,
  TicketStatus,
  TimelineEntry,
} from "./ticket-data";

interface WorkspacePanelProps {
  ticket: Ticket | null;
  onChangeStatus?: (id: string, status: TicketStatus) => void;
  onAddNote?: (id: string, content: string, type: ServiceTicketNoteType) => void;
  isMutating?: boolean;
  /** Gates the onboarding controls; falls back to read-only when omitted. */
  canWrite?: boolean;
  onCompleteOnboardingStep?: (id: string, stepKey: OnboardingStepKey) => void;
  onToggleOnboardingChecklist?: (
    id: string,
    key: OnboardingChecklistKey,
    value: boolean,
  ) => void;
  /** Gates the renewal controls; falls back to read-only when omitted. */
  onToggleRenewalPolicy?: (
    id: string,
    policyId: string,
    discussed: boolean,
  ) => void;
  onCompleteRenewalStep?: (
    id: string,
    stepKey: RenewalStepKey,
    outcome?: RenewalOutcome,
  ) => void;
  onChangeRenewalOutcome?: (id: string, outcome: RenewalOutcome) => void;
}

type DropStatus = TicketStatus;

const TIMELINE_ICONS: Record<TimelineEntry["type"], React.ReactNode> = {
  created: <Plus className="w-3.5 h-3.5" />,
  note: <MessageSquare className="w-3.5 h-3.5" />,
  status: <Zap className="w-3.5 h-3.5" />,
  system: <AlertCircle className="w-3.5 h-3.5" />,
  call: <Phone className="w-3.5 h-3.5" />,
  email: <Mail className="w-3.5 h-3.5" />,
};

const TIMELINE_ICON_BG: Record<TimelineEntry["type"], string> = {
  created: "bg-[var(--kpi-blue)] text-white",
  note: "bg-slate-700 text-white",
  status: "bg-[var(--kpi-amber)] text-white",
  system: "bg-muted text-muted-foreground",
  call: "bg-[var(--kpi-purple)] text-white",
  email: "bg-[var(--kpi-green)] text-white",
};

const NOTE_TYPE_CONFIG: Record<
  ServiceTicketNoteType,
  { label: string; action: string; placeholder: string; icon: React.ReactNode }
> = {
  note: {
    label: "Note",
    action: "Post Note",
    placeholder: "Type your note here — visible only to agency staff…",
    icon: <MessageSquare className="w-3.5 h-3.5" />,
  },
  call: {
    label: "Phone Call",
    action: "Log Call",
    placeholder: "Summarize the call — who you spoke to and the outcome…",
    icon: <Phone className="w-3.5 h-3.5" />,
  },
  email: {
    label: "Email",
    action: "Log Email",
    placeholder: "Summarize the email you sent or received…",
    icon: <Mail className="w-3.5 h-3.5" />,
  },
};

const NOTE_TYPES: ServiceTicketNoteType[] = ["note", "call", "email"];

export function WorkspacePanel({
  ticket,
  onChangeStatus,
  onAddNote,
  isMutating,
  canWrite,
  onCompleteOnboardingStep,
  onToggleOnboardingChecklist,
  onToggleRenewalPolicy,
  onCompleteRenewalStep,
  onChangeRenewalOutcome,
}: WorkspacePanelProps) {
  const [note, setNote] = useState("");
  const [statusDropdown, setStatusDropdown] = useState(false);
  const [noteType, setNoteType] = useState<ServiceTicketNoteType>("note");
  const [noteTypeDropdown, setNoteTypeDropdown] = useState(false);
  const [householdOpen, setHouseholdOpen] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);
  const noteCfg = NOTE_TYPE_CONFIG[noteType];

  // This pane scrolls independently of the ticket feed, so its scroll position
  // survives a ticket change — landing the reader midway down a ticket they
  // just opened. Reset to the top whenever the selection changes.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [ticket?.id]);

  // Newest activity first: what happened last is what the CSR needs, and the
  // API returns the timeline in the order it was appended. Sorted by `at`
  // rather than reversed, since entries are not guaranteed to be stored in
  // chronological order — a backdated seed or fixture can interleave them.
  const orderedTimeline = useMemo(
    () =>
      [...(ticket?.timeline ?? [])].sort(
        (a, b) => Date.parse(b.at) - Date.parse(a.at),
      ),
    [ticket?.timeline],
  );

  // The ticket's persisted status from the server is the source of truth.
  const status: DropStatus = ticket?.status ?? "open";
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
      <div className="bg-card border-b border-border px-5 py-3">
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
                <div className="absolute right-0 top-full mt-1 bg-popover border border-border rounded-md shadow-lg z-20 min-w-[130px] py-0.5">
                  {SERVICE_TICKET_PICKER_STATUSES.map((s) => {
                    const c = STATUS_CONFIG[s];
                    return (
                      <button
                        key={s}
                        onClick={() => {
                          setStatusDropdown(false);
                          if (ticket && s !== status) {
                            onChangeStatus?.(ticket.id, s);
                          }
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

      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] px-5 py-4 space-y-4"
      >
        {/* Data grid */}
        <div className="bg-card rounded-lg border border-border p-4">
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
                // Only a ticket with a real linked record opens the drawer;
                // otherwise show the denormalized display string as plain text.
                ticket.policyId ? (
                  <button
                    type="button"
                    onClick={() => setPolicyOpen(true)}
                    className="flex items-center gap-1 text-[var(--kpi-blue)] hover:underline"
                  >
                    {ticket.policyType} — {ticket.policyNumber}
                    <ExternalLink className="w-3 h-3" />
                  </button>
                ) : (
                  <span>
                    {ticket.policyType} — {ticket.policyNumber}
                  </span>
                )
              }
            />
            <DataRow
              label="Priority"
              value={
                <span
                  className={`px-1.5 py-0.5 rounded text-xs ${
                    ticket.priority === "high"
                      ? "bg-red-500/15 text-red-400"
                      : ticket.priority === "medium"
                      ? "bg-amber-500/15 text-amber-400"
                      : "bg-slate-500/15 text-slate-300"
                  }`}
                >
                  {ticket.priority}
                </span>
              }
            />
            <DataRow
              label="Household"
              value={
                ticket.householdId ? (
                  <button
                    type="button"
                    onClick={() => setHouseholdOpen(true)}
                    className="flex items-center gap-1 text-[var(--kpi-blue)] hover:underline"
                  >
                    <Users className="w-3 h-3" />
                    {ticket.household}
                    <ExternalLink className="w-3 h-3" />
                  </button>
                ) : (
                  <span className="flex items-center gap-1">
                    <Users className="w-3 h-3" />
                    {ticket.household}
                  </span>
                )
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

        {/* Onboarding steps — the only category-specific panel. Absent for
            every other category, so nothing shifts for a normal ticket. */}
        {ticket.onboarding && onCompleteOnboardingStep ? (
          <OnboardingPanel
            step={ticket.onboarding}
            canWrite={canWrite ?? false}
            isMutating={isMutating}
            onCompleteStep={(stepKey) =>
              onCompleteOnboardingStep(ticket.id, stepKey)
            }
            onToggleChecklist={(key, value) =>
              onToggleOnboardingChecklist?.(ticket.id, key, value)
            }
          />
        ) : null}

        {/* Renewal outreach — the sibling category panel. A ticket never
            carries both payloads, but nothing here assumes that. */}
        {ticket.renewal && onCompleteRenewalStep ? (
          <RenewalPanel
            step={ticket.renewal}
            canWrite={canWrite ?? false}
            isMutating={isMutating}
            onTogglePolicy={(policyId, discussed) =>
              onToggleRenewalPolicy?.(ticket.id, policyId, discussed)
            }
            onCompleteStep={(stepKey, outcome) =>
              onCompleteRenewalStep(ticket.id, stepKey, outcome)
            }
            onChangeOutcome={(outcome) =>
              onChangeRenewalOutcome?.(ticket.id, outcome)
            }
          />
        ) : null}

        {/* Timeline */}
        <div className="bg-card rounded-lg border border-border p-4">
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
              {orderedTimeline.map((entry) => (
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
        <div className="bg-card rounded-lg border border-border p-4">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-3.5 h-3.5 text-muted-foreground" />
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Log Activity
              </h3>
            </div>
            {/* Note-type dropdown */}
            <div className="relative">
              <button
                onClick={() => setNoteTypeDropdown(!noteTypeDropdown)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border border-border bg-[var(--input-background)] text-foreground hover:opacity-80 transition-opacity"
              >
                {noteCfg.icon}
                {noteCfg.label}
                <ChevronDown className="w-3 h-3 opacity-60" />
              </button>
              {noteTypeDropdown && (
                <div className="absolute right-0 top-full mt-1 bg-popover border border-border rounded-md shadow-lg z-20 min-w-[150px] py-0.5">
                  {NOTE_TYPES.map((t) => {
                    const c = NOTE_TYPE_CONFIG[t];
                    return (
                      <button
                        key={t}
                        onClick={() => {
                          setNoteType(t);
                          setNoteTypeDropdown(false);
                        }}
                        className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted transition-colors text-left ${
                          t === noteType ? "font-semibold" : ""
                        }`}
                      >
                        {c.icon}
                        {c.label}
                        {t === noteType && (
                          <CheckCircle2 className="w-3 h-3 ml-auto text-[var(--kpi-green)]" />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={noteCfg.placeholder}
            rows={3}
            className="w-full text-sm bg-[var(--input-background)] border border-border rounded-md px-3 py-2 outline-none focus:ring-2 focus:ring-[var(--ring)] resize-none placeholder:text-muted-foreground"
          />
          <div className="flex items-center justify-between mt-2">
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Will be timestamped and logged to timeline
            </span>
            <button
              onClick={() => {
                if (ticket && note.trim()) {
                  onAddNote?.(ticket.id, note.trim(), noteType);
                  setNote("");
                }
              }}
              disabled={!note.trim() || isMutating}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--kpi-blue)] text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
            >
              <Send className="w-3 h-3" />
              {noteCfg.action}
            </button>
          </div>
        </div>
      </div>

      <HouseholdDrawer
        householdId={ticket.householdId}
        open={householdOpen}
        onOpenChange={setHouseholdOpen}
      />
      <PolicyDrawer
        policyId={ticket.policyId}
        open={policyOpen}
        onOpenChange={setPolicyOpen}
      />
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
