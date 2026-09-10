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
import { cn } from "@/lib/utils";
import {
  CATEGORY_SHORT,
  TICKET_PRIORITY_CLASS,
  TICKET_STATUS_CONFIG,
  type Ticket,
} from "./ticket-data";

type FilterTab = "all" | "open" | "waiting" | "resolved";

/**
 * The feed's three controls, owned by the page rather than the feed.
 *
 * Lifted out in PAC-98. They used to be local state filtering an array the
 * page had already fetched in full; now the list is paged server-side, so a
 * filter applied here would only ever narrow the page in front of you. The
 * page holds them, sends them with the request, and resets to page 1 when
 * they change.
 */
export interface TicketFeedFilters {
  query: string;
  filter: FilterTab;
  category: ServiceTicketCategory | 'all';
}

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
  filters: TicketFeedFilters;
  onFiltersChange: (next: TicketFeedFilters) => void;
  /** Categories to offer, from the whole queue rather than the loaded page. */
  categoryOptions?: readonly ServiceTicketCategory[];
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
  filters,
  onFiltersChange,
  categoryOptions,
}: TicketFeedProps) {
  const { query, filter, category } = filters;
  const setQuery = (next: string) => onFiltersChange({ ...filters, query: next });
  const setFilter = (next: FilterTab) =>
    onFiltersChange({ ...filters, filter: next });
  const setCategory = (next: ServiceTicketCategory | "all") =>
    onFiltersChange({ ...filters, category: next });

  /*
   * The picker offers the whole vocabulary unless the page supplies a list.
   *
   * It used to derive the options from `tickets` — "only offer categories
   * actually present in the queue". That reasoning does not survive paging:
   * `tickets` is now one page, so the options would change under the rep as
   * they page, and a category would vanish from the picker while its tickets
   * sat on page two. Same trap PAC-97 hit on the dashboard queue.
   */
  const availableCategories = categoryOptions ?? SERVICE_TICKET_CATEGORIES;

  /*
   * The rows as the server sent them.
   *
   * The status, category and text filtering that used to happen here is now
   * part of the request (PAC-98), and the ranking comes back applied — so
   * there is nothing left to do but render. Re-sorting would order one page
   * against itself rather than against the pages either side of it.
   */
  const filtered = tickets;

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
