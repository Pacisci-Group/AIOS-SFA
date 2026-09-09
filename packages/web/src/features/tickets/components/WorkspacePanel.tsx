import {
  AlertCircle,
  ArrowLeft,
  ArrowLeftRight,
  Clock,
  ExternalLink,
  FileText,
  Lock,
  Mail,
  MessageSquare,
  Phone,
  Plus,
  Send,
  User,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type {
  OnboardingChecklistKey,
  OnboardingStepKey,
  RenewalOutcome,
  RenewalStepKey,
  ServiceTicketNoteType,
} from "@sfa/shared";
import { DataRow, DetailCard } from "@/components/common/DetailCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { HouseholdDrawer } from "@/features/clients/components/HouseholdDrawer";
import { PolicyDrawer } from "@/features/clients/components/PolicyDrawer";
import { cn } from "@/lib/utils";
import { OnboardingPanel } from "./OnboardingPanel";
import { PolicyTransferPanel } from "./PolicyTransferPanel";
import { RenewalPanel } from "./RenewalPanel";
import { TicketStatusSelect } from "./TicketStatusSelect";
import {
  TICKET_PRIORITY_CLASS,
  TICKET_STATUS_CONFIG,
  type Ticket,
  type TicketStatus,
  type TimelineEntry,
} from "./ticket-data";

interface WorkspacePanelProps {
  ticket: Ticket | null;
  onChangeStatus?: (id: string, status: TicketStatus) => void;
  onAddNote?: (id: string, content: string, type: ServiceTicketNoteType) => void;
  isMutating?: boolean;
  /** Gates the onboarding controls; falls back to read-only when omitted. */
  canWrite?: boolean;
  /**
   * Returns to the ticket list. Rendered only below `lg`, where the two panes
   * are stacked rather than side by side and the list is off-screen.
   */
  onBack?: () => void;
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

/**
 * Icon and accent per timeline entry type — the same `{ icon, tone, tint }`
 * shape the lead timeline uses (`features/lead/components/lead-display.ts`), so
 * an event bubble looks the same on a ticket as it does on a lead.
 *
 * Colours read from the theme tokens rather than the `--kpi-*` variables these
 * used to carry, which were declared only under `.dark` and rendered as solid
 * white-on-nothing circles on the light theme.
 */
const TIMELINE_DISPLAY: Record<
  TimelineEntry["type"],
  { icon: LucideIcon; tone: string; tint: string }
> = {
  created: { icon: Plus, tone: "text-primary", tint: "bg-primary/12" },
  note: {
    icon: MessageSquare,
    tone: "text-slate-600 dark:text-slate-400",
    tint: "bg-slate-400/12",
  },
  status: {
    icon: Zap,
    tone: "text-amber-600 dark:text-amber-500",
    tint: "bg-amber-500/15",
  },
  system: {
    icon: AlertCircle,
    tone: "text-muted-foreground",
    tint: "bg-muted",
  },
  call: {
    icon: Phone,
    tone: "text-violet-600 dark:text-violet-400",
    tint: "bg-violet-400/12",
  },
  email: { icon: Mail, tone: "text-success", tint: "bg-success/12" },
};

const NOTE_TYPE_CONFIG: Record<
  ServiceTicketNoteType,
  { label: string; action: string; placeholder: string; icon: LucideIcon }
> = {
  note: {
    label: "Note",
    action: "Post note",
    placeholder: "Type your note here — visible only to agency staff…",
    icon: MessageSquare,
  },
  call: {
    label: "Phone call",
    action: "Log call",
    placeholder: "Summarize the call — who you spoke to and the outcome…",
    icon: Phone,
  },
  email: {
    label: "Email",
    action: "Log email",
    placeholder: "Summarize the email you sent or received…",
    icon: Mail,
  },
};

const NOTE_TYPES: ServiceTicketNoteType[] = ["note", "call", "email"];

export function WorkspacePanel({
  ticket,
  onChangeStatus,
  onAddNote,
  isMutating,
  canWrite,
  onBack,
  onCompleteOnboardingStep,
  onToggleOnboardingChecklist,
  onToggleRenewalPolicy,
  onCompleteRenewalStep,
  onChangeRenewalOutcome,
}: WorkspacePanelProps) {
  const [note, setNote] = useState("");
  const [noteType, setNoteType] = useState<ServiceTicketNoteType>("note");
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

  /**
   * Why the status picker is missing on a quote ticket.
   *
   * `leadStatus` comes back only on the single-ticket read, which is exactly
   * what this panel does — but it is still guarded, so the sentence degrades to
   * the rule alone rather than rendering "currently null".
   */
  const leadLockHint = ticket?.isStatusLocked
    ? `Status follows the linked lead${
        ticket.leadStatus ? ` (currently ${ticket.leadStatus})` : ""
      } — it resolves when the lead is marked Sold or Closed.`
    : undefined;

  if (!ticket) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-background px-8 text-center">
        <span className="mb-3 flex size-12 items-center justify-center rounded-full bg-muted">
          <FileText aria-hidden className="size-5 text-muted-foreground" />
        </span>
        <p className="text-base font-medium text-foreground">
          No ticket selected
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Pick any ticket in the list to open its workspace.
        </p>
        {/*
          The way out, and not decoration: below `lg` the queue pane is
          `hidden` while this one shows, and a `?ticket=` deep link opens
          straight onto this pane. If the queue then comes back empty — every
          ticket resolved and archived, or an id outside the reader's scope —
          nothing is selected, and without this the only exit is browser-back.
        */}
        {onBack && (
          <Button variant="outline" size="sm" onClick={onBack} className="mt-4 lg:hidden">
            <ArrowLeft />
            Back to tickets
          </Button>
        )}
      </div>
    );
  }

  const status = TICKET_STATUS_CONFIG[ticket.status];

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <header className="border-b border-border bg-card px-4 py-4 md:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2">
            {onBack && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onBack}
                aria-label="Back to tickets"
                className="-ml-1 lg:hidden"
              >
                <ArrowLeft />
              </Button>
            )}
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-2">
                {/* `h2`, not `h1`: the page's own header above already owns the
                    `h1` ("Service tickets" / "Archived tickets"), and this pane
                    is a section of that page. */}
                <h2 className="truncate text-lg font-semibold tracking-tight text-card-foreground">
                  {ticket.clientName}
                </h2>
                <span className="text-sm tabular-nums text-muted-foreground">
                  {ticket.ticketNumber}
                </span>
              </div>
              {/* Linkified only when there is something to dial or mail — a
                  migrated ticket can carry an empty string, and `tel:` with no
                  number is a link that does nothing when tapped. */}
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                <ContactLink
                  icon={Phone}
                  value={ticket.phone}
                  href={
                    ticket.phone
                      ? `tel:${ticket.phone.replace(/[^\d+]/g, "")}`
                      : undefined
                  }
                />
                <ContactLink
                  icon={Mail}
                  value={ticket.email}
                  href={ticket.email ? `mailto:${ticket.email}` : undefined}
                />
              </div>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {/*
              A policy transfer is recorded in the full Sold wizard, so this
              navigates rather than opening a dialog. Hidden once one exists —
              one transfer per ticket, and the panel below then shows it.
            */}
            {ticket.allowsPolicyTransfer && !ticket.policyTransfer && canWrite && (
              <Button asChild size="sm" variant="outline">
                <Link to={`/policy-transfers/new?ticketId=${ticket.id}`}>
                  <ArrowLeftRight />
                  Policy transfer
                </Link>
              </Button>
            )}

            {/*
              A quote ticket's status belongs to its lead, so there is nothing
              to pick here — a static badge plus the one route that *can* move
              it. Without that link the panel would state a rule the CSR has no
              way to act on. The server enforces the same thing (400 on
              `PATCH …/status`); this is the affordance, not the gate.
            */}
            {ticket.isStatusLocked ? (
              <>
                <Badge
                  size="lg"
                  variant="ghost"
                  className={cn("gap-1.5", status.bg, status.text)}
                  title={leadLockHint}
                >
                  <Lock aria-hidden className="opacity-70" />
                  {status.label}
                </Badge>
                <Button asChild variant="link" size="sm">
                  <Link to={`/leads/${ticket.leadId}`} title={leadLockHint}>
                    Open lead
                    <ExternalLink />
                  </Link>
                </Button>
              </>
            ) : (
              <TicketStatusSelect
                value={ticket.status}
                onChange={(next) => onChangeStatus?.(ticket.id, next)}
                disabled={!canWrite || isMutating}
              />
            )}
          </div>
        </div>

        {ticket.isStatusLocked && (
          <p className="mt-2 text-sm text-muted-foreground">{leadLockHint}</p>
        )}
      </header>

      <div
        ref={scrollRef}
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 md:p-5"
      >
        <DetailCard title="Ticket details" icon={FileText}>
          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <DataRow
              label="Assigned rep"
              value={
                <span className="flex items-center gap-1.5">
                  <span className="flex size-5 items-center justify-center rounded-full bg-primary/12">
                    <User aria-hidden className="size-3 text-primary" />
                  </span>
                  {ticket.assignedRep}
                </span>
              }
            />
            <DataRow label="Category" value={ticket.category} />
            <DataRow
              label="Policy linked"
              value={
                // Only a ticket with a real linked record opens the drawer;
                // otherwise show the denormalized display string as plain text.
                ticket.policyId ? (
                  <Button
                    variant="link"
                    size="xs"
                    className="h-auto p-0"
                    onClick={() => setPolicyOpen(true)}
                  >
                    {ticket.policyType} — {ticket.policyNumber}
                    <ExternalLink />
                  </Button>
                ) : (
                  `${ticket.policyType} — ${ticket.policyNumber}`
                )
              }
            />
            <DataRow
              label="Priority"
              value={
                <Badge
                  size="sm"
                  variant="ghost"
                  className={cn(
                    "capitalize",
                    TICKET_PRIORITY_CLASS[ticket.priority],
                  )}
                >
                  {ticket.priority}
                </Badge>
              }
            />
            <DataRow
              label="Household"
              value={
                ticket.householdId ? (
                  <Button
                    variant="link"
                    size="xs"
                    className="h-auto p-0"
                    onClick={() => setHouseholdOpen(true)}
                  >
                    <Users />
                    {ticket.household}
                    <ExternalLink />
                  </Button>
                ) : (
                  <span className="flex items-center gap-1.5">
                    <Users aria-hidden className="size-4 text-muted-foreground" />
                    {ticket.household}
                  </span>
                )
              }
            />
            <DataRow
              label="Days open"
              value={
                <span
                  className={cn(
                    "font-semibold tabular-nums",
                    ticket.daysOpen > 10 && "text-destructive",
                  )}
                >
                  {ticket.daysOpen}d
                </span>
              }
            />
          </div>
        </DetailCard>

        {/* Onboarding steps — one of three category-specific panels. Absent for
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
        {ticket.policyTransfer ? (
          <PolicyTransferPanel transfer={ticket.policyTransfer} />
        ) : null}

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

        <DetailCard
          title="Activity timeline"
          icon={Clock}
          action={
            <span className="text-sm text-muted-foreground">
              {ticket.timeline.length}{" "}
              {ticket.timeline.length === 1 ? "event" : "events"}
            </span>
          }
        >
          {orderedTimeline.length === 0 ? (
            <p className="text-base text-muted-foreground">
              Nothing has been logged against this ticket yet.
            </p>
          ) : (
            <ol>
              {orderedTimeline.map((entry, index) => {
                const {
                  icon: Icon,
                  tone,
                  tint,
                } = TIMELINE_DISPLAY[entry.type] ?? TIMELINE_DISPLAY.system;
                const isLast = index === orderedTimeline.length - 1;

                return (
                  <li key={entry.id} className="relative flex gap-3">
                    {/* The connector, stopping at the last entry. */}
                    {!isLast && (
                      <span
                        aria-hidden
                        className="absolute bottom-0 left-4 top-10 w-px bg-border"
                      />
                    )}
                    <span
                      aria-hidden
                      className={cn(
                        "relative z-10 mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
                        tint,
                      )}
                    >
                      <Icon className={cn("size-4", tone)} />
                    </span>
                    <div className="min-w-0 flex-1 pb-4">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-sm tabular-nums text-muted-foreground">
                          {entry.timestamp}
                        </span>
                        {entry.author && (
                          <span className="text-sm text-muted-foreground">
                            · {entry.author}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-base leading-relaxed text-card-foreground">
                        {entry.content}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </DetailCard>

        <DetailCard
          title="Log activity"
          icon={MessageSquare}
          action={
            <Select
              value={noteType}
              onValueChange={(value) =>
                setNoteType(value as ServiceTicketNoteType)
              }
            >
              <SelectTrigger size="sm" aria-label="Activity type" className="w-auto gap-1.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {NOTE_TYPES.map((type) => {
                  const config = NOTE_TYPE_CONFIG[type];
                  const Icon = config.icon;
                  return (
                    <SelectItem key={type} value={type}>
                      <span className="inline-flex items-center gap-2">
                        <Icon className="size-4" />
                        {config.label}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          }
        >
          {/* No `rows`: `ui/textarea` sets `field-sizing-content`, which makes
              the box size to its own content and ignores the attribute. It
              opens at the primitive's `min-h-16` and grows as you type. */}
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={noteCfg.placeholder}
            aria-label={noteCfg.action}
            disabled={!canWrite}
            className="resize-none"
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Clock aria-hidden className="size-4" />
              Timestamped and added to the timeline
            </span>
            <Button
              size="sm"
              disabled={!canWrite || !note.trim() || isMutating}
              onClick={() => {
                if (note.trim()) {
                  onAddNote?.(ticket.id, note.trim(), noteType);
                  setNote("");
                }
              }}
            >
              <Send />
              {noteCfg.action}
            </Button>
          </div>
        </DetailCard>
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

/** A phone or email in the ticket header — a link only when there is a value. */
function ContactLink({
  icon: Icon,
  value,
  href,
}: {
  icon: LucideIcon;
  value: string;
  href?: string;
}) {
  const body = (
    <>
      <Icon aria-hidden className="size-4 shrink-0" />
      <span className="truncate">{value || "—"}</span>
    </>
  );

  if (!href) {
    return <span className="flex min-w-0 items-center gap-1.5">{body}</span>;
  }

  return (
    <a
      href={href}
      className="flex min-w-0 items-center gap-1.5 transition-colors hover:text-foreground"
    >
      {body}
    </a>
  );
}
