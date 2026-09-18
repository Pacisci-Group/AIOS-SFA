import {
  SERVICE_TICKET_CATEGORIES,
  isTerminalTicketStatus,
  type ServiceTicketStatus,
  type ServiceTicketView,
} from '@sfa/shared';
import {
  sortByLatestActivity,
  sortByUrgency,
  ticketUrgencyBand,
} from './ticket-urgency';

/**
 * One filter model for every ticket queue.
 *
 * ## Why this is shared
 *
 * A CSR filters the Service Dashboard's Priority Ticket Queue down to, say,
 * overdue Billing tickets, clicks one, and lands on the ticket workspace —
 * whose left-hand queue used to be a *different list entirely*: its filters
 * were `useState`, so they started at "everything" on arrival; its status tabs
 * were a different vocabulary (`open`/`waiting`/`resolved` against the
 * dashboard's `overdue`/`waiting`); its "All" included resolved tickets the
 * dashboard excludes; and it had no notion of the dashboard's sort. Nothing
 * carried over, so the queue the rep had built was gone and the list beside
 * the ticket they opened looked unrelated to the one they clicked in.
 *
 * So the vocabulary, the predicates and the ranking live here, once, and the
 * *state* lives in the URL under the names below. Every queue reads the same
 * params, so a link out of one queue into another (`ticketQueueLink`) carries
 * the view with it, a refresh keeps it, and back restores it.
 *
 * `lib/ticket-urgency.ts` owns the ordering and the four-state taxonomy the
 * status tabs are built from; this module owns the filtering.
 */

/* -------------------------------------------------------------------------- *
 * Status tabs
 * -------------------------------------------------------------------------- */

/**
 * The status filters a queue can offer, in urgency order.
 *
 * Each maps onto one band of the shared taxonomy (see `ticketUrgencyBand`), so
 * a tab selects exactly the tickets that sort into that band — no tab can
 * quietly mean something different from the ranking. `all` is "not finished",
 * which is what a work queue is: resolved and closed tickets are reached
 * through `resolved`, and the ones older than the archive window through the
 * Archived Tickets page.
 *
 * Not every queue shows all five — the dashboard offers three, the archive
 * none — so each surface declares its own subset and guards the URL with it.
 */
export const TICKET_QUEUE_TABS = [
  'all',
  'overdue',
  'open',
  'waiting',
  'resolved',
] as const;

export type TicketQueueTab = (typeof TICKET_QUEUE_TABS)[number];

/**
 * Short labels, for a tab strip in a narrow column. The dashboard queue words
 * three of these more fully ("All Assigned", "Waiting on Others") because it
 * has the room and the persona context; the values are the same.
 */
export const TICKET_QUEUE_TAB_LABELS: Record<TicketQueueTab, string> = {
  all: 'All',
  overdue: 'Overdue',
  open: 'Open',
  waiting: 'Waiting',
  resolved: 'Resolved',
};

/**
 * Takes a status rather than a ticket: the dashboard queue flattens its rows
 * into its own shape before filtering, and the status is all this needs.
 */
export function matchesTicketQueueTab(
  status: ServiceTicketStatus,
  tab: TicketQueueTab,
): boolean {
  if (tab === 'all') return !isTerminalTicketStatus(status);
  const band = ticketUrgencyBand(status);
  if (tab === 'overdue') return band === 'overdue';
  if (tab === 'open') return band === 'workable';
  if (tab === 'waiting') return band === 'blocked';
  return band === 'done';
}

/* -------------------------------------------------------------------------- *
 * Category filter
 * -------------------------------------------------------------------------- */

/**
 * The category filter's options: the whole shared vocabulary, plus anything the
 * tickets carry that isn't in it, plus whatever is currently selected.
 *
 * Offering only the categories with a ticket in the list reads well and fails
 * badly. A queue that is all one category offers a single option; a stored
 * category the enum doesn't recognise (a legacy label, a rename) drops out of
 * both sides at once — no option to pick, and no way to reach those tickets;
 * and a filter inherited from another queue (`?type=Billing` arriving from the
 * dashboard) would be unlisted here, leaving an empty list with nothing to say
 * what emptied it. Listing the vocabulary means the control is the same control
 * on every queue. An option with nothing behind it lands on the empty state,
 * which is an honest answer.
 */
export function ticketQueueCategoryOptions(
  tickets: ServiceTicketView[],
  selected: string,
): string[] {
  const canonical = new Set<string>(SERVICE_TICKET_CATEGORIES);
  const extras = [
    ...new Set(
      [...tickets.map((t) => t.category as string), selected].filter(
        (category) => category && !canonical.has(category),
      ),
    ),
  ].sort();
  return [...SERVICE_TICKET_CATEGORIES, ...extras];
}

/* -------------------------------------------------------------------------- *
 * Sort
 * -------------------------------------------------------------------------- */

/**
 * How the rows are ranked. Urgency is never switched off — the option only
 * decides the order *inside* each urgency band. Both comparators live in
 * `lib/ticket-urgency.ts`, which explains the distinction at length.
 */
export const TICKET_QUEUE_SORTS = [
  { value: 'urgency', label: 'Urgency' },
  { value: 'activity', label: 'Latest activity' },
] as const;

export type TicketQueueSort = (typeof TICKET_QUEUE_SORTS)[number]['value'];

/** Stays out of the URL: the default view carries no `?sort=`. */
export const DEFAULT_TICKET_QUEUE_SORT: TicketQueueSort = 'urgency';

export function sortTicketQueue(
  tickets: ServiceTicketView[],
  sort: TicketQueueSort,
): ServiceTicketView[] {
  return sort === 'activity'
    ? sortByLatestActivity(tickets)
    : sortByUrgency(tickets);
}

/* -------------------------------------------------------------------------- *
 * Free-text search
 * -------------------------------------------------------------------------- */

/** The fields a queue's search box looks at. Shared so every queue matches alike. */
export function matchesTicketQueueSearch(
  ticket: ServiceTicketView,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    ticket.clientName.toLowerCase().includes(q) ||
    ticket.ticketNumber.toLowerCase().includes(q) ||
    ticket.category.toLowerCase().includes(q) ||
    ticket.policyNumber.toLowerCase().includes(q) ||
    ticket.phone.includes(q)
  );
}

/* -------------------------------------------------------------------------- *
 * URL state
 * -------------------------------------------------------------------------- */

/**
 * The params every queue shares, with the value that means "not set".
 *
 * A surface with extra state of its own (the dashboard's `page`, the
 * workspace feed's `q`) spreads these into its own frozen defaults object —
 * `useUrlState` memoises on the identity of that object, so it has to be
 * module scope at the call site.
 */
export const TICKET_QUEUE_URL_DEFAULTS = {
  tab: 'all' as string,
  type: '',
  sort: '',
};

/**
 * Guards for the shared params. `tab` is deliberately absent: which tabs are
 * legal depends on which ones the surface renders, so each one pins it to its
 * own subset — a tab the URL could set but the strip cannot show would filter
 * the list with nothing to say so.
 */
export const TICKET_QUEUE_URL_ALLOWED = {
  /*
   * Bounded rather than pinned to `SERVICE_TICKET_CATEGORIES`.
   *
   * This filter is applied to tickets already in memory and never reaches the
   * API, so a value outside the vocabulary costs nothing worse than an empty
   * list — while pinning it means any category the data carries but the enum
   * has since renamed is unselectable, because the guard resets it to '' on
   * the way back out of the URL. Length is all that needs guarding.
   */
  type: (value: string) => value.length <= 60,
  /*
   * Pinned to the vocabulary, unlike `type` above: a sort key is ours, not the
   * data's, so anything outside the list is a stale or hand-edited link and
   * falling back to the default ranking is the right answer.
   */
  sort: TICKET_QUEUE_SORTS.map((option) => option.value),
} as const;

/**
 * "No type filter" as a `Select` sees it. Radix reserves the empty string for
 * "nothing selected", which would render the trigger as a blank box rather
 * than "All types" — so the unfiltered state carries a sentinel in the control
 * and stays `''` in the URL, where absence is what means unfiltered.
 */
export const ALL_TICKET_TYPES = '__all__';

/**
 * A link from one queue to a ticket in another, carrying the view along.
 *
 * Only the params that decide *which* tickets are listed travel. `page` does
 * not: the dashboard paginates and the workspace feed scrolls, so page 3 of
 * one is meaningless to the other. Nor does `q`, which is the feed's own.
 */
export function ticketQueueLink(
  path: string,
  ticketId: string,
  from: URLSearchParams,
): string {
  const params = new URLSearchParams();
  params.set('ticket', ticketId);
  for (const key of Object.keys(TICKET_QUEUE_URL_DEFAULTS)) {
    const value = from.get(key);
    if (value) params.set(key, value);
  }
  return `${path}?${params.toString()}`;
}
