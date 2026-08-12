import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowLeftRight,
  CreditCard,
  Filter,
  FileCheck,
  FileSignature,
  FileText,
  MessageSquare,
  Mail,
  Phone,
  RefreshCw,
  ShieldCheck,
  ShieldX,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import {
  isTerminalTicketStatus,
  type ServiceTicketCategory,
  type ServiceTicketStatus,
  type ServiceTicketView,
} from "@sfa/shared";
import { listServiceTicketsForHousehold } from "@/lib/service-tickets-api";
import { TICKET_STATUS_CONFIG } from "@/features/tickets/components/ticket-data";

/**
 * The household's Activity & Tickets column: every service ticket the client
 * owns, newest activity first.
 *
 * A ticket is the only durable record of a client interaction in this system —
 * calls, emails, and notes are timeline entries *inside* a ticket rather than
 * free-standing events — so the client's history is its ticket history. Each
 * card summarizes one ticket with its latest timeline entry and links to the
 * ticket workspace, which is where the full thread and any writing happen.
 *
 * Archived tickets are included on purpose (see `listForHousehold` on the API
 * side): a 360 view that hid last month's resolved claim would be lying.
 */
export function ActivityFeed({
  householdId,
  isDemo = false,
}: {
  householdId?: string;
  isDemo?: boolean;
}) {
  const [filter, setFilter] = useState<FilterType>("All");

  const query = useQuery({
    queryKey: ["household-tickets", householdId],
    queryFn: () => listServiceTicketsForHousehold(householdId as string),
    enabled: Boolean(householdId) && !isDemo,
  });

  const items = useMemo<FeedItem[]>(
    () => (isDemo ? DEMO_ITEMS : (query.data ?? []).map(toFeedItem)),
    [isDemo, query.data],
  );

  const filtered = items.filter((item) => {
    if (filter === "All") return true;
    if (filter === "Open") return !isTerminalTicketStatus(item.status);
    if (filter === "Overdue") return item.status === "overdue";
    return isTerminalTicketStatus(item.status);
  });

  const openCount = items.filter(
    (item) => !isTerminalTicketStatus(item.status),
  ).length;

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b shrink-0" style={{ borderColor: "var(--border)" }}>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs uppercase tracking-widest" style={{ color: "var(--muted-foreground)", fontFamily: "'JetBrains Mono', monospace" }}>
            Activity &amp; Tickets
          </p>
          {openCount > 0 && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs" style={{ background: "#2d0a0a", color: "#f87171", border: "1px solid #7f1d1d" }}>
              {openCount} open
            </span>
          )}
        </div>

        {/* Filter pills */}
        <div className="flex items-center gap-1.5">
          <Filter size={11} style={{ color: "var(--muted-foreground)" }} />
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className="px-2.5 py-1 rounded text-xs transition-all"
              style={
                filter === f
                  ? { background: "#1d4ed8", color: "#fff" }
                  : { background: "var(--muted)", color: "var(--muted-foreground)", border: "1px solid var(--border)" }
              }
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Timeline */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3" style={{ scrollbarWidth: "none" }}>
        <div className="flex flex-col gap-0 relative">
          {/* Vertical line */}
          <div className="absolute left-[18px] top-2 bottom-2 w-px" style={{ background: "var(--border)" }} />

          {filtered.map((item) => (
            <FeedRow key={item.id} item={item} />
          ))}
        </div>

        {/* `isLoading`, not `isPending`: a disabled query (demo, or no id yet)
            stays pending forever and would sit on the spinner. */}
        {query.isLoading && (
          <p className="text-xs text-center py-8" style={{ color: "var(--muted-foreground)" }}>
            Loading tickets…
          </p>
        )}

        {query.isError && (
          <p className="text-xs text-center py-8" style={{ color: "var(--muted-foreground)" }}>
            Could not load this client's tickets.
          </p>
        )}

        {!query.isLoading && !query.isError && filtered.length === 0 && (
          <div className="flex items-center justify-center h-32">
            <p className="text-xs" style={{ color: "var(--muted-foreground)" }}>
              {items.length === 0 ? "No tickets for this client yet" : "No matching activity"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * One ticket card. The whole card is the link target — a CSR reading the feed
 * is nearly always on their way into the ticket.
 */
function FeedRow({ item }: { item: FeedItem }) {
  const Icon = item.icon;
  const status = TICKET_STATUS_CONFIG[item.status];

  const body = (
    <>
      {/* Icon node */}
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 z-10 transition-transform group-hover:scale-105"
        style={{ background: item.bg, border: `1px solid ${item.color}30` }}
      >
        <Icon size={15} style={{ color: item.color }} />
      </div>

      {/* Content */}
      <div
        className="flex-1 rounded-lg p-3 transition-all group-hover:border-white/10"
        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
      >
        <div className="flex items-start justify-between gap-2 mb-1">
          <p className="text-xs font-semibold leading-tight" style={{ color: "var(--foreground)" }}>
            {item.title}
          </p>
          <span
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs shrink-0 ${status.bg} ${status.text}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
            {status.label}
          </span>
        </div>

        <p className="text-xs leading-relaxed mb-2" style={{ color: "var(--muted-foreground)" }}>
          {item.description}
        </p>

        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-mono" style={{ color: "var(--muted-foreground)", fontFamily: "'JetBrains Mono', monospace", opacity: 0.7 }}>
            {item.timestamp}
          </span>
          <div className="flex items-center gap-1.5 shrink-0">
            {item.isHighPriority && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--kpi-amber-bg)] text-[var(--kpi-amber)]">
                High
              </span>
            )}
            {item.agent && (
              <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}>
                {item.agent}
              </span>
            )}
          </div>
        </div>
      </div>
    </>
  );

  if (!item.ticketId) {
    return <div className="relative flex gap-3 pb-4 group">{body}</div>;
  }

  return (
    <Link
      to={`/crm/tickets?ticket=${item.ticketId}`}
      className="relative flex gap-3 pb-4 group"
    >
      {body}
    </Link>
  );
}

/* -------------------------------------------------------------------------- *
 * Feed items
 * -------------------------------------------------------------------------- */

interface FeedItem {
  id: string;
  /** Set for real tickets; the demo items link nowhere. */
  ticketId?: string;
  icon: LucideIcon;
  color: string;
  bg: string;
  title: string;
  description: string;
  timestamp: string;
  status: ServiceTicketStatus;
  agent?: string;
  isHighPriority?: boolean;
}

const FILTERS = ["All", "Open", "Overdue", "Resolved"] as const;
type FilterType = (typeof FILTERS)[number];

/**
 * Icon and accent per ticket category, carried over from the mockup's activity
 * types. Categories that mean the same thing to a reader — a payment and a
 * billing question, an endorsement and a policy change — share an accent.
 */
const CATEGORY_ICONS: Record<
  ServiceTicketCategory,
  { icon: LucideIcon; color: string; bg: string }
> = {
  Onboarding: { icon: UserPlus, color: "#3b82f6", bg: "#1e3a5f" },
  Endorsement: { icon: FileSignature, color: "#06b6d4", bg: "#0a1628" },
  "Policy Change": { icon: FileSignature, color: "#06b6d4", bg: "#0a1628" },
  Billing: { icon: CreditCard, color: "#10b981", bg: "#052e16" },
  Payment: { icon: CreditCard, color: "#10b981", bg: "#052e16" },
  "Claims Assist": { icon: FileCheck, color: "#ef4444", bg: "#2d0a0a" },
  "Renewal Review": { icon: RefreshCw, color: "#f59e0b", bg: "#1c1002" },
  "Renewal Taken": { icon: ShieldCheck, color: "#f59e0b", bg: "#1c1002" },
  "Company Transfer": { icon: ArrowLeftRight, color: "#8b5cf6", bg: "#1e1b4b" },
  Save: { icon: ShieldCheck, color: "#10b981", bg: "#052e16" },
  Termination: { icon: ShieldX, color: "#ef4444", bg: "#2d0a0a" },
  // Violet, matching the "Start Quote" quick action this ticket comes from.
  Quote: { icon: FileText, color: "#8b5cf6", bg: "#1e1b4b" },
  Other: { icon: MessageSquare, color: "#94a3b8", bg: "#1e293b" },
};

const FALLBACK_ICON = { icon: AlertCircle, color: "#f59e0b", bg: "#1c1002" };

/**
 * A ticket as one feed card. The description is the latest timeline entry —
 * the ticket has no summary field of its own, and the last thing that happened
 * is what a reader scanning the column wants.
 */
function toFeedItem(ticket: ServiceTicketView): FeedItem {
  const config = CATEGORY_ICONS[ticket.category] ?? FALLBACK_ICON;
  const latest = ticket.timeline[ticket.timeline.length - 1];

  return {
    id: ticket.id,
    ticketId: ticket.id,
    icon: config.icon,
    color: config.color,
    bg: config.bg,
    title: `${ticket.category} — ${ticket.ticketNumber}`,
    description:
      latest?.content ||
      [ticket.policyType, ticket.policyNumber].filter(Boolean).join(" · "),
    timestamp: formatStamp(ticket.lastActivityAt),
    status: ticket.status,
    agent: ticket.assignedRep || undefined,
    isHighPriority: ticket.priority === "high",
  };
}

/** "Jun 9, 2026 · 10:14 AM" — the mockup's stamp, from an ISO string. */
function formatStamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })} · ${date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

/**
 * Demo only, for `/clients/demo` — that route has no household id to query.
 * Shaped exactly like the live cards so both render through the same row.
 */
const DEMO_ITEMS: FeedItem[] = [
  {
    id: "a1",
    ...CATEGORY_ICONS.Billing,
    title: "Billing — BILL-104",
    description:
      "Jessica called regarding $18 late fee on Auto policy. Agreed to one-time waiver pending supervisor approval.",
    timestamp: "Jun 9, 2026 · 10:14 AM",
    status: "open",
    agent: "M. Torres",
    isHighPriority: true,
  },
  {
    id: "a2",
    ...CATEGORY_ICONS.Endorsement,
    title: "Endorsement — ENDR-101",
    description:
      "Teen driver added to household roster. Excluded from Auto policy per Jessica's request. Signed exclusion form on file.",
    timestamp: "Jun 6, 2026 · 2:30 PM",
    status: "closed",
    agent: "M. Torres",
  },
  {
    id: "a3",
    ...CATEGORY_ICONS.Payment,
    title: "Payment — PAY-118",
    description:
      "Monthly ACH payment of $184.00 processed successfully. Next due: Jul 15.",
    timestamp: "Jun 3, 2026 · 8:00 AM",
    status: "resolved",
    agent: "System",
  },
  {
    id: "a4",
    ...CATEGORY_ICONS["Renewal Review"],
    title: "Renewal Review — RENEW-142",
    description:
      "Outbound call to review Home policy renewal. Discussed roof inspection results. No changes to coverage requested.",
    timestamp: "May 28, 2026 · 11:45 AM",
    status: "closed",
    agent: "R. Kim",
  },
  {
    id: "a5",
    ...CATEGORY_ICONS["Claims Assist"],
    title: "Claims Assist — CLAIM-133",
    description:
      "Claim #CLM-2024-0882 filed. Adjuster inspected May 14. Settlement of $6,200 issued for roof replacement.",
    timestamp: "May 10, 2026 · 9:00 AM",
    status: "resolved",
    agent: "Allstate Claims",
    isHighPriority: true,
  },
  {
    id: "a6",
    icon: Mail,
    color: "#8b5cf6",
    bg: "#1e1b4b",
    title: "Other — TKT-127",
    description:
      "Umbrella policy renewal documents emailed to jessica.cobb@email.com. Read receipt confirmed.",
    timestamp: "May 5, 2026 · 4:12 PM",
    status: "closed",
    agent: "System",
  },
  {
    id: "a7",
    icon: Phone,
    color: "#3b82f6",
    bg: "#1e3a5f",
    title: "Policy Change — PCHG-119",
    description:
      "Agent requested updated property address for Landlord policy. Awaiting documentation from client.",
    timestamp: "Apr 28, 2026 · 1:00 PM",
    status: "waiting_on_client",
    agent: "R. Kim",
  },
];
