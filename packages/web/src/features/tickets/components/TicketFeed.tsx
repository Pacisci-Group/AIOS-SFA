import { Check, ListFilter, Search } from "lucide-react";
import { useMemo, useState } from "react";
import {
  SERVICE_TICKET_CATEGORIES,
  type ServiceTicketCategory,
} from "@sfa/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { FilterToggles } from "@/components/common/FilterToggles";
import { compareTicketUrgency } from "@/lib/ticket-urgency";
import { cn } from "@/lib/utils";
import {
  CATEGORY_SHORT,
  TICKET_PRIORITY_CLASS,
  TICKET_STATUS_CONFIG,
  type Ticket,
} from "./ticket-data";

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

const TABS: readonly { label: string; value: FilterTab }[] = [
  { label: "All", value: "all" },
  { label: "Open", value: "open" },
  { label: "Waiting", value: "waiting" },
  { label: "Resolved", value: "resolved" },
];

/**
 * The queue on the left of the ticket workspace.
 *
 * Search, the status filters and the category filter go through `Input`,
 * `FilterToggles` and `DropdownMenu` rather than the hand-rolled equivalents
 * this had before — the previous search box drew its own focus ring off
 * `--ring`, the filter row was bare `<button>`s with no group semantics or
 * pressed state, and the category picker was a `fixed inset-0` click-away layer
 * with no escape handling and no `aria-expanded`.
 */
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

  return (
    <div className="flex h-full flex-col overflow-hidden border-border bg-card lg:border-r">
      <div className="space-y-3 border-b border-border px-4 py-3">
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            aria-label="Search tickets"
            placeholder="Search name, policy, phone, ID…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9 bg-card border-border"
          />
        </div>

        {showStatusTabs && (
          <FilterToggles
            label="Filter tickets by status"
            options={TABS}
            value={filter}
            onChange={setFilter}
          />
        )}
      </div>

      <div className="flex items-center justify-between gap-2 px-4 py-2">
        <span className="truncate text-sm text-muted-foreground">
          {filtered.length} ticket{filtered.length !== 1 ? "s" : ""}
          {category !== "all" && (
            <span className="text-foreground"> · {category}</span>
          )}
        </span>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Filter by category"
              className={cn(category !== "all" && "text-primary")}
            >
              <ListFilter />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-64 w-48 overflow-y-auto">
            <CategoryOption
              label="All categories"
              active={category === "all"}
              onSelect={() => setCategory("all")}
            />
            {availableCategories.map((c) => (
              <CategoryOption
                key={c}
                label={c}
                active={category === c}
                onSelect={() => setCategory(c)}
              />
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* List — scrolls independently of the workspace pane. `min-h-0` keeps
          this flex child from growing past its parent instead of scrolling. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {filtered.length === 0 && (
          <p className="flex h-32 items-center justify-center px-4 text-center text-sm text-muted-foreground">
            {emptyLabel}
          </p>
        )}
        {filtered.map((ticket) => (
          <TicketRow
            key={ticket.id}
            ticket={ticket}
            selected={selectedId === ticket.id}
            onSelect={() => onSelect(ticket.id)}
          />
        ))}
      </div>
    </div>
  );
}

function TicketRow({
  ticket,
  selected,
  onSelect,
}: {
  ticket: Ticket;
  selected: boolean;
  onSelect: () => void;
}) {
  const status = TICKET_STATUS_CONFIG[ticket.status];
  const isOverdue = ticket.daysOpen > 10 && ticket.status !== "resolved";
  // Each onboarding ticket IS one call, so the row shows its own step.
  const onboardingStep = ticket.onboarding ?? null;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "w-full border-b border-l-2 border-border px-4 py-3 text-left transition-colors",
        selected
          ? "border-l-primary bg-primary/12"
          : "border-l-transparent hover:bg-muted/50",
      )}
    >
      <span className="mb-1 flex items-start justify-between gap-2">
        <span
          className={cn(
            "text-sm font-semibold leading-tight",
            selected ? "text-primary" : "text-card-foreground",
          )}
        >
          {ticket.clientName}
        </span>
        <Badge
          size="sm"
          variant="ghost"
          className={cn(
            "shrink-0 tabular-nums",
            isOverdue
              ? "bg-destructive/12 font-semibold text-destructive"
              : "bg-muted text-muted-foreground",
          )}
        >
          {ticket.status === "resolved" ? "Done" : `${ticket.daysOpen}d open`}
        </Badge>
      </span>

      <span className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className={cn("size-2 shrink-0 rounded-full", status.dot)} />
        <span className="tabular-nums">{ticket.ticketNumber}</span>
        <span>·</span>
        <span className="truncate">
          {CATEGORY_SHORT[ticket.category] ?? ticket.category}
        </span>
      </span>

      {/* Which call this is and when it is owed, so a CSR can triage without
          opening the ticket. */}
      {onboardingStep && (
        <span className="mb-1.5 flex items-center gap-1.5">
          <Badge
            size="sm"
            variant="ghost"
            className={cn(
              onboardingStep.isOverdue
                ? "bg-red-500/12 font-medium text-red-600 dark:text-red-400"
                : onboardingStep.completedAt
                  ? "bg-muted text-muted-foreground"
                  : "bg-primary/12 text-primary",
            )}
          >
            {onboardingStep.label}
          </Badge>
          <span className="truncate text-xs text-muted-foreground">
            {onboardingStep.completedAt
              ? `step ${onboardingStep.sequence}/${onboardingStep.totalSteps} · done`
              : onboardingStep.isOverdue
                ? `overdue since ${shortDate(onboardingStep.dueAt)}`
                : `due ${shortDate(onboardingStep.dueAt)}`}
          </span>
        </span>
      )}

      <span className="flex items-center justify-between gap-2">
        <Badge
          size="sm"
          variant="ghost"
          className={cn("capitalize", TICKET_PRIORITY_CLASS[ticket.priority])}
        >
          {ticket.priority}
        </Badge>
        <span className="truncate text-xs text-muted-foreground">
          {ticket.lastActivity}
        </span>
      </span>
    </button>
  );
}

function CategoryOption({
  label,
  active,
  onSelect,
}: {
  label: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem
      onSelect={onSelect}
      className={cn(active && "font-medium text-primary")}
    >
      {label}
      {active && <Check className="ml-auto size-4" />}
    </DropdownMenuItem>
  );
}

function shortDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
