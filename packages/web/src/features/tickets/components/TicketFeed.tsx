import { ArrowDownUp, Check, ListFilter, Search, X } from "lucide-react";
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
import {
  DEFAULT_TICKET_QUEUE_SORT,
  TICKET_QUEUE_SORTS,
  TICKET_QUEUE_TAB_LABELS,
  type TicketQueueSort,
  type TicketQueueTab,
} from "@/lib/ticket-queue";
import { cn } from "@/lib/utils";
import type { TicketQueue } from "../useTicketQueue";
import {
  CATEGORY_SHORT,
  TICKET_STATUS_CONFIG,
  type Ticket,
} from "./ticket-data";

interface TicketFeedProps {
  /**
   * The queue this feed renders and drives: its filters, its ranking, and the
   * rows they produce. Held in the URL by `useTicketQueue` so the view survives
   * the trip from the Service Dashboard (and a refresh, and back).
   */
  queue: TicketQueue;
  selectedId: string | null;
  onSelect: (id: string) => void;
  emptyLabel?: string;
}

/**
 * The queue on the left of the ticket workspace.
 *
 * Search, the status filters, the category filter and the sort go through
 * `Input`, `FilterToggles` and `DropdownMenu` rather than the hand-rolled
 * equivalents this had before — the previous search box drew its own focus ring
 * off `--ring`, the filter row was bare `<button>`s with no group semantics or
 * pressed state, and the category picker was a `fixed inset-0` click-away layer
 * with no escape handling and no `aria-expanded`.
 *
 * The state behind all four is the page's, not this component's: see
 * `useTicketQueue`.
 */
export function TicketFeed({
  queue,
  selectedId,
  onSelect,
  emptyLabel = "No tickets match your search.",
}: TicketFeedProps) {
  const {
    rows,
    tabs,
    tab,
    setTab,
    type,
    setType,
    categoryOptions,
    sort,
    setSort,
    query,
    setQuery,
    isFiltered,
    clearFilters,
  } = queue;

  const sortLabel =
    TICKET_QUEUE_SORTS.find((option) => option.value === sort)?.label ?? "";

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

        {tabs.length > 0 && (
          <FilterToggles
            label="Filter tickets by status"
            options={tabs.map((value) => ({
              value,
              label: TICKET_QUEUE_TAB_LABELS[value],
            }))}
            value={tab}
            onChange={(next: TicketQueueTab) => setTab(next)}
          />
        )}
      </div>

      <div className="flex items-center justify-between gap-2 px-4 py-2">
        <span className="truncate text-sm text-muted-foreground">
          {rows.length} ticket{rows.length !== 1 ? "s" : ""}
          {type && <span className="text-foreground"> · {type}</span>}
        </span>

        <div className="flex shrink-0 items-center gap-0.5">
          {/* One way out of a view that arrived with the link, rather than
              three controls to walk back by hand. */}
          {isFiltered && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs text-muted-foreground"
              onClick={clearFilters}
            >
              <X />
              Clear
            </Button>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Sort tickets — ${sortLabel}`}
                className={cn(
                  sort !== DEFAULT_TICKET_QUEUE_SORT && "text-primary",
                )}
              >
                <ArrowDownUp />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {TICKET_QUEUE_SORTS.map((option) => (
                <FilterOption
                  key={option.value}
                  label={option.label}
                  active={sort === option.value}
                  onSelect={() => setSort(option.value as TicketQueueSort)}
                />
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Filter by category"
                className={cn(type && "text-primary")}
              >
                <ListFilter />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="max-h-64 w-48 overflow-y-auto"
            >
              <FilterOption
                label="All categories"
                active={!type}
                onSelect={() => setType("")}
              />
              {categoryOptions.map((category) => (
                <FilterOption
                  key={category}
                  label={category}
                  active={type === category}
                  onSelect={() => setType(category)}
                />
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* List — scrolls independently of the workspace pane. `min-h-0` keeps
          this flex child from growing past its parent instead of scrolling. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.length === 0 && (
          <div className="flex h-32 flex-col items-center justify-center gap-2 px-4 text-center">
            <p className="text-sm text-muted-foreground">
              {isFiltered ? "No tickets match these filters." : emptyLabel}
            </p>
            {isFiltered && (
              <Button variant="outline" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
          </div>
        )}
        {rows.map((ticket) => (
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

      {/* No status dot here any more — the status badge at the foot of the row
          carries the same colour with a label attached. */}
      <span className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
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

      {/* The ticket's state, where the priority pill used to be. Priority reads
          "medium" on everything this app opens and nothing can change it — see
          the note in `ticket-data.ts`. */}
      <span className="flex items-center justify-between gap-2">
        <Badge
          size="sm"
          variant="ghost"
          className={cn("gap-1", status.bg, status.text)}
        >
          <span className={cn("size-2 shrink-0 rounded-full", status.dot)} />
          {status.label}
        </Badge>
        <span className="truncate text-xs text-muted-foreground">
          {ticket.lastActivity}
        </span>
      </span>
    </button>
  );
}

function FilterOption({
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
