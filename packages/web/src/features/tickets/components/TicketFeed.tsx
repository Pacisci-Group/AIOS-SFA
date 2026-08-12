import { Search, SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import {
  SERVICE_TICKET_CATEGORIES,
  type ServiceTicketCategory,
} from "@sfa/shared";
import { compareTicketUrgency } from "@/lib/ticket-urgency";
import { Ticket, TicketStatus } from "./ticket-data";

type FilterTab = "all" | "open" | "waiting" | "resolved";

interface TicketFeedProps {
  tickets: Ticket[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /**
   * Status tabs are meaningless where every ticket shares one status (the
   * Archived Tickets view), so they can be hidden.
   */
  showStatusTabs?: boolean;
  emptyLabel?: string;
}

const STATUS_COLORS: Record<TicketStatus, { dot: string; text: string }> = {
  open: { dot: "bg-[var(--kpi-blue)]", text: "text-[var(--kpi-blue)]" },
  waiting: { dot: "bg-[var(--kpi-purple)]", text: "text-[var(--kpi-purple)]" },
  resolved: { dot: "bg-[var(--kpi-green)]", text: "text-[var(--kpi-green)]" },
  overdue: { dot: "bg-[var(--kpi-amber)]", text: "text-[var(--kpi-amber)]" },
  in_progress: { dot: "bg-[var(--kpi-blue)]", text: "text-[var(--kpi-blue)]" },
  waiting_on_client: {
    dot: "bg-[var(--kpi-purple)]",
    text: "text-[var(--kpi-purple)]",
  },
  waiting_on_carrier: {
    dot: "bg-[var(--kpi-purple)]",
    text: "text-[var(--kpi-purple)]",
  },
  closed: { dot: "bg-muted-foreground", text: "text-muted-foreground" },
};

/** Abbreviations for the narrow feed rows; anything unlisted falls back to the full name. */
const CATEGORY_SHORT: Record<string, string> = {
  "Renewal Review": "Renewal",
  "Renewal Taken": "Renewal Taken",
  "Claims Assist": "Claims",
  "Policy Change": "Pol. Change",
  "Company Transfer": "Transfer",
  Endorsement: "Endorse",
  Onboarding: "Onboard",
};

const PRIORITY_COLOR: Record<string, string> = {
  high: "bg-red-500/15 text-red-400",
  medium: "bg-amber-500/15 text-amber-400",
  low: "bg-slate-500/15 text-slate-300",
};

export function TicketFeed({
  tickets,
  selectedId,
  onSelect,
  showStatusTabs = true,
  emptyLabel = "No tickets match your search.",
}: TicketFeedProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterTab>("all");
  const [category, setCategory] = useState<ServiceTicketCategory | "all">("all");
  const [categoryOpen, setCategoryOpen] = useState(false);

  // Only offer categories actually present in the queue — a picker listing all
  // twelve when the CSR has three is noise.
  const availableCategories = useMemo(
    () =>
      SERVICE_TICKET_CATEGORIES.filter((c) =>
        tickets.some((t) => t.category === c),
      ),
    [tickets],
  );

  const filtered = useMemo(() => {
    const matches = tickets.filter((t) => {
      const matchesFilter =
        filter === "all" ||
        (filter === "open" && (t.status === "open" || t.status === "overdue")) ||
        (filter === "waiting" && t.status === "waiting") ||
        (filter === "resolved" && t.status === "resolved");

      const matchesCategory = category === "all" || t.category === category;

      const q = query.toLowerCase();
      const matchesQuery =
        !q ||
        t.clientName.toLowerCase().includes(q) ||
        t.ticketNumber.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q) ||
        t.policyNumber.includes(q) ||
        t.phone.includes(q);

      return matchesFilter && matchesCategory && matchesQuery;
    });

    // Same ranking the Service Dashboard queue uses, so a ticket holds the
    // same relative position wherever it is seen.
    return matches.sort(compareTicketUrgency);
  }, [tickets, filter, category, query]);

  const tabs: { label: string; value: FilterTab }[] = [
    { label: "All", value: "all" },
    { label: "Open", value: "open" },
    { label: "Waiting", value: "waiting" },
    { label: "Resolved", value: "resolved" },
  ];

  return (
    <div className="flex flex-col h-full bg-card border-r border-border overflow-hidden">
      {/* Search + filter */}
      <div className="px-3 pt-3 pb-2 border-b border-border space-y-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Search name, policy, phone, ID…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-sm bg-[var(--input-background)] border border-border rounded-md outline-none focus:ring-2 focus:ring-[var(--ring)] placeholder:text-muted-foreground"
          />
        </div>
        {showStatusTabs && (
        <div className="flex items-center bg-muted rounded-md p-0.5 gap-0.5">
          {tabs.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setFilter(tab.value)}
              className={`flex-1 text-xs py-1 rounded transition-all ${
                filter === tab.value
                  ? "bg-secondary text-foreground shadow-sm font-medium"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        )}
      </div>

      {/* Count + category filter */}
      <div className="px-3 py-1.5 flex items-center justify-between relative">
        <span className="text-xs text-muted-foreground">
          {filtered.length} ticket{filtered.length !== 1 ? "s" : ""}
          {category !== "all" ? (
            <span className="text-foreground"> · {category}</span>
          ) : null}
        </span>
        <button
          type="button"
          onClick={() => setCategoryOpen((open) => !open)}
          title="Filter by category"
          className={`transition-colors ${
            category === "all"
              ? "text-muted-foreground hover:text-foreground"
              : "text-[var(--kpi-blue)]"
          }`}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
        </button>

        {categoryOpen && (
          <>
            {/* Click-away layer, matching the dropdown idiom in WorkspacePanel. */}
            <div
              className="fixed inset-0 z-10"
              onClick={() => setCategoryOpen(false)}
            />
            <div className="absolute right-3 top-8 z-20 w-44 max-h-64 overflow-y-auto rounded-md border border-border bg-card py-1 shadow-lg">
              <CategoryOption
                label="All categories"
                active={category === "all"}
                onClick={() => {
                  setCategory("all");
                  setCategoryOpen(false);
                }}
              />
              {availableCategories.map((c) => (
                <CategoryOption
                  key={c}
                  label={c}
                  active={category === c}
                  onClick={() => {
                    setCategory(c);
                    setCategoryOpen(false);
                  }}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* List — scrolls independently of the workspace pane. `min-h-0` keeps
          this flex child from growing past its parent instead of scrolling. */}
      <div className="flex-1 min-h-0 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {filtered.length === 0 && (
          <div className="flex items-center justify-center h-32 text-sm text-muted-foreground px-4 text-center">
            {emptyLabel}
          </div>
        )}
        {filtered.map((ticket) => {
          const sc = STATUS_COLORS[ticket.status];
          const isSelected = selectedId === ticket.id;
          const isOverdue = ticket.daysOpen > 10 && ticket.status !== "resolved";
          // Each onboarding ticket IS one call, so the row shows its own step.
          const onboardingStep = ticket.onboarding ?? null;

          return (
            <button
              key={ticket.id}
              onClick={() => onSelect(ticket.id)}
              className={`w-full text-left px-3 py-2.5 border-b border-border transition-colors group ${
                isSelected
                  ? "bg-[var(--kpi-blue-bg)] border-l-2 border-l-[var(--kpi-blue)]"
                  : "hover:bg-muted/50 border-l-2 border-l-transparent"
              }`}
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <span className={`text-sm font-semibold leading-tight ${isSelected ? "text-[var(--kpi-blue)]" : "text-foreground"}`}>
                  {ticket.clientName}
                </span>
                <span
                  className={`shrink-0 text-xs font-mono px-1.5 py-0.5 rounded ${
                    isOverdue
                      ? "bg-[var(--kpi-amber-bg)] text-[var(--kpi-amber)] font-semibold"
                      : "bg-muted text-muted-foreground"
                  } ${isOverdue ? "animate-pulse" : ""}`}
                >
                  {ticket.status === "resolved" ? "✓ Done" : `${ticket.daysOpen}d open`}
                </span>
              </div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className={`inline-block w-1.5 h-1.5 rounded-full ${sc.dot} shrink-0`} />
                <span className="text-xs text-muted-foreground font-mono">{ticket.ticketNumber}</span>
                <span className="text-xs text-muted-foreground">·</span>
                <span className="text-xs text-muted-foreground">{CATEGORY_SHORT[ticket.category] ?? ticket.category}</span>
              </div>
              {/* Which call this is and when it is owed, so a CSR can triage
                  without opening the ticket. */}
              {onboardingStep && (
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span
                    className={`text-xs px-1.5 py-0.5 rounded-sm ${
                      onboardingStep.isOverdue
                        ? "bg-red-500/15 text-red-400 font-medium"
                        : onboardingStep.completedAt
                          ? "bg-muted text-muted-foreground"
                          : "bg-[var(--kpi-blue-bg)] text-[var(--kpi-blue)]"
                    }`}
                  >
                    {onboardingStep.label}
                  </span>
                  <span className="text-xs text-muted-foreground truncate">
                    {onboardingStep.completedAt
                      ? `step ${onboardingStep.sequence}/${onboardingStep.totalSteps} · done`
                      : onboardingStep.isOverdue
                        ? `overdue since ${shortDate(onboardingStep.dueAt)}`
                        : `due ${shortDate(onboardingStep.dueAt)}`}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className={`text-xs px-1.5 py-0.5 rounded-sm ${PRIORITY_COLOR[ticket.priority]}`}>
                  {ticket.priority}
                </span>
                <span className="text-xs text-muted-foreground">{ticket.lastActivity}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CategoryOption({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full px-3 py-1.5 text-left text-xs transition-colors hover:bg-muted ${
        active ? "text-[var(--kpi-blue)] font-medium" : "text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

function shortDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
