import { ArrowDownUp, Check, ListFilter, User, X } from "lucide-react";
import type { ServiceTicketScope } from "@sfa/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TableSearchInput } from "@/components/common/TableSearchInput";
import { FilterToggles } from "@/components/common/FilterToggles";
import {
  DEFAULT_TICKET_QUEUE_SORT,
  TICKET_QUEUE_SORTS,
  TICKET_QUEUE_TAB_LABELS,
  type TicketQueueSort,
  type TicketQueueTab,
} from "@/lib/ticket-queue";
import { NOT_AVAILABLE } from "@/lib/not-available";
import { cn } from "@/lib/utils";
import type { TicketQueue } from "../useTicketQueue";
import {
  CATEGORY_SHORT,
  TICKET_STATUS_CONFIG,
  type Ticket,
} from "./ticket-data";

/**
 * Mine / Everyone (PAC-109). `own` pins the queue to the viewer; `agency` asks
 * for everything they may see, which for a service role is their branch — a
 * ticket is shared work, so a colleague's queue is reachable.
 */
const SCOPE_TABS: readonly { label: string; value: ServiceTicketScope }[] = [
  { label: "Mine", value: "own" },
  { label: "Everyone", value: "agency" },
];

interface TicketFeedProps {
  /**
   * The queue this feed renders and drives: its filters, its ranking, and the
   * page of rows they produce. Held in the URL by `useTicketQueue` so the view
   * survives the trip from the Service Dashboard (and a refresh, and back).
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
 * `TableSearchInput`, `FilterToggles` and `DropdownMenu` rather than the hand-rolled
 * equivalents this had before — the previous search box drew its own focus ring
 * off `--ring`, the filter row was bare `<button>`s with no group semantics or
 * pressed state, and the category picker was a `fixed inset-0` click-away layer
 * with no escape handling and no `aria-expanded`.
 *
 * The state behind all four is the page's, not this component's: see
 * `useTicketQueue`. Since PAC-98 all four are request parameters, and the rows
 * arrive narrowed and ranked — render them in the order given. Re-sorting would
 * order one page against itself rather than against the pages either side.
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
    scope,
    setScope,
    isFiltered,
    clearFilters,
    page,
    isFetching,
  } = queue;
  // The whole filtered queue, not the page in hand.
  const total = page?.total ?? rows.length;

  const sortLabel =
    TICKET_QUEUE_SORTS.find((option) => option.value === sort)?.label ?? "";

  return (
    <div className="flex h-full flex-col overflow-hidden border-border bg-card lg:border-r">
      <div className="space-y-3 border-b border-border px-4 py-3">
        <TableSearchInput
          value={query}
          onValueChange={setQuery}
          label="Search tickets"
          placeholder="Search name, policy, phone, ID…"
          busy={isFetching}
        />

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

        {/* Mine / Everyone (PAC-109). Offered at every data scope: a CSR uses
            it to reach a colleague's queue, an owner to get back to their own. */}
        <FilterToggles
          label="Show my tickets or everyone's"
          options={SCOPE_TABS}
          value={scope}
          onChange={setScope}
        />
      </div>

      <div className="flex items-center justify-between gap-2 px-4 py-2">
        <span className="truncate text-sm text-muted-foreground">
          {total} ticket{total !== 1 ? "s" : ""}
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
            /* Only where it tells you something. Every row in "Mine" is
               assigned to the reader, so the chip would be the same name
               repeated down the list. */
            showAssignee={scope === "agency"}
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
  showAssignee = false,
}: {
  ticket: Ticket;
  selected: boolean;
  onSelect: () => void;
  /** Name the assigned rep — only meaningful in the everyone view. */
  showAssignee?: boolean;
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
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          {/* Whose ticket this is, so the queue is scannable by owner without
              opening every row. Same chip as the workspace panel's
              "Assigned rep". */}
          {showAssignee && ticket.assignedRep && (
            <>
              <span className="flex min-w-0 items-center gap-1">
                <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-primary/12">
                  <User aria-hidden className="size-2.5 text-primary" />
                </span>
                <span className="truncate">{ticket.assignedRep}</span>
              </span>
              <span aria-hidden>·</span>
            </>
          )}
          <span className="truncate">{ticket.lastActivity}</span>
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
  if (!iso) return NOT_AVAILABLE;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
