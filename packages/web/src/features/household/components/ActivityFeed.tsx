import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Mail, Phone, type LucideIcon } from "lucide-react";
import {
  isTerminalTicketStatus,
  type ServiceTicketStatus,
  type ServiceTicketView,
} from "@sfa/shared";
import { SectionLabel } from "@/components/common/DetailCard";
import { FilterToggles } from "@/components/common/FilterToggles";
import { Badge } from "@/components/ui/badge";
import { listServiceTicketsForHousehold } from "@/lib/service-tickets-api";
import {
  categoryDisplay,
  TICKET_CATEGORY_DISPLAY,
  TICKET_STATUS_CONFIG,
} from "@/features/tickets/components/ticket-data";
import { cn } from "@/lib/utils";

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
 *
 * The per-category icon and accent come from `TICKET_CATEGORY_DISPLAY` rather
 * than a second copy of the map — this file used to carry its own, keyed by the
 * same categories with different hex values, so a Billing ticket was one green
 * on the ticket workspace and another here.
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
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 space-y-3 border-b border-border px-4 py-4 md:px-5">
        <div className="flex items-center justify-between gap-2">
          <SectionLabel>Activity &amp; tickets</SectionLabel>
          {openCount > 0 && (
            <Badge
              size="sm"
              variant="ghost"
              className="bg-destructive/12 text-destructive"
            >
              {openCount} open
            </Badge>
          )}
        </div>

        <FilterToggles
          label="Filter activity by status"
          options={FILTER_OPTIONS}
          value={filter}
          onChange={setFilter}
        />
      </div>

      {/* Timeline */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 md:px-5">
        {filtered.length > 0 && (
          <ol>
            {filtered.map((item, index) => (
              <FeedRow
                key={item.id}
                item={item}
                isLast={index === filtered.length - 1}
              />
            ))}
          </ol>
        )}

        {/* `isLoading`, not `isPending`: a disabled query (demo, or no id yet)
            stays pending forever and would sit on the spinner. */}
        {query.isLoading && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Loading tickets…
          </p>
        )}

        {query.isError && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Could not load this client's tickets.
          </p>
        )}

        {!query.isLoading && !query.isError && filtered.length === 0 && (
          <p className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            {items.length === 0
              ? "No tickets for this client yet"
              : "No matching activity"}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * One ticket card. The whole card is the link target — a CSR reading the feed
 * is nearly always on their way into the ticket.
 *
 * The connector is drawn per row and starts *below* the icon tile rather than
 * running the full height of the list behind them — same as the lead timeline,
 * and for the same reason: the tiles are alpha tints (`bg-primary/12`), so a
 * line passing behind one shows straight through it.
 */
function FeedRow({ item, isLast }: { item: FeedItem; isLast: boolean }) {
  const Icon = item.icon;
  const status = TICKET_STATUS_CONFIG[item.status];

  const body = (
    <>
      {!isLast && (
        <span
          aria-hidden
          className="absolute bottom-0 left-[18px] top-11 w-px bg-border"
        />
      )}
      <span
        aria-hidden
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-lg transition-transform group-hover:scale-105",
          item.tint,
        )}
      >
        <Icon className={cn("size-4", item.tone)} />
      </span>

      <span className="min-w-0 flex-1 rounded-lg border border-border bg-card p-3 transition-colors group-hover:border-primary/40">
        <span className="mb-1 flex items-start justify-between gap-2">
          <span className="text-sm font-semibold leading-tight text-card-foreground">
            {item.title}
          </span>
          <Badge
            size="sm"
            variant="ghost"
            className={cn("shrink-0 gap-1", status.bg, status.text)}
          >
            <span className={cn("size-2 rounded-full", status.dot)} />
            {status.label}
          </Badge>
        </span>

        <span className="mb-2 block text-sm leading-relaxed text-muted-foreground">
          {item.description}
        </span>

        <span className="flex items-center justify-between gap-2">
          <span className="text-xs tabular-nums text-muted-foreground">
            {item.timestamp}
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            {item.isHighPriority && (
              <Badge
                size="sm"
                variant="ghost"
                className="bg-red-500/12 text-red-600 dark:text-red-400"
              >
                High
              </Badge>
            )}
            {item.agent && (
              <Badge size="sm" variant="ghost" className="bg-muted text-muted-foreground">
                {item.agent}
              </Badge>
            )}
          </span>
        </span>
      </span>
    </>
  );

  if (!item.ticketId) {
    return <li className="group relative flex gap-3 pb-4">{body}</li>;
  }

  return (
    <li className="relative pb-4">
      <Link
        to={`/crm/tickets?ticket=${item.ticketId}`}
        className="group flex gap-3"
      >
        {body}
      </Link>
    </li>
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
  tone: string;
  tint: string;
  title: string;
  description: string;
  timestamp: string;
  status: ServiceTicketStatus;
  agent?: string;
  isHighPriority?: boolean;
}

const FILTERS = ["All", "Open", "Overdue", "Resolved"] as const;
type FilterType = (typeof FILTERS)[number];

const FILTER_OPTIONS: readonly { label: string; value: FilterType }[] =
  FILTERS.map((value) => ({ label: value, value }));

/**
 * A ticket as one feed card. The description is the latest timeline entry —
 * the ticket has no summary field of its own, and the last thing that happened
 * is what a reader scanning the column wants.
 */
function toFeedItem(ticket: ServiceTicketView): FeedItem {
  const config = categoryDisplay(ticket.category);
  const latest = ticket.timeline[ticket.timeline.length - 1];

  return {
    id: ticket.id,
    ticketId: ticket.id,
    icon: config.icon,
    tone: config.tone,
    tint: config.tint,
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
    ...TICKET_CATEGORY_DISPLAY.Billing,
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
    ...TICKET_CATEGORY_DISPLAY.Endorsement,
    title: "Endorsement — ENDR-101",
    description:
      "Teen driver added to household roster. Excluded from Auto policy per Jessica's request. Signed exclusion form on file.",
    timestamp: "Jun 6, 2026 · 2:30 PM",
    status: "closed",
    agent: "M. Torres",
  },
  {
    id: "a3",
    ...TICKET_CATEGORY_DISPLAY.Payment,
    title: "Payment — PAY-118",
    description:
      "Monthly ACH payment of $184.00 processed successfully. Next due: Jul 15.",
    timestamp: "Jun 3, 2026 · 8:00 AM",
    status: "resolved",
    agent: "System",
  },
  {
    id: "a4",
    ...TICKET_CATEGORY_DISPLAY["Renewal Review"],
    title: "Renewal Review — RENEW-142",
    description:
      "Outbound call to review Home policy renewal. Discussed roof inspection results. No changes to coverage requested.",
    timestamp: "May 28, 2026 · 11:45 AM",
    status: "closed",
    agent: "R. Kim",
  },
  {
    id: "a5",
    ...TICKET_CATEGORY_DISPLAY["Claims Assist"],
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
    tone: "text-violet-600 dark:text-violet-400",
    tint: "bg-violet-400/12",
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
    tone: "text-primary",
    tint: "bg-primary/12",
    title: "Policy Change — PCHG-119",
    description:
      "Agent requested updated property address for Landlord policy. Awaiting documentation from client.",
    timestamp: "Apr 28, 2026 · 1:00 PM",
    status: "waiting_on_client",
    agent: "R. Kim",
  },
];
