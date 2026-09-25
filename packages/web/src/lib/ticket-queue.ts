import {
  SERVICE_TICKET_ACTIVE_STATUSES,
  SERVICE_TICKET_CATEGORIES,
  SERVICE_TICKET_QUEUE_SORTS,
  SERVICE_TICKET_STATUSES,
  urgencyRankFor,
  type ServiceTicketQueueSort,
  type ServiceTicketStatus,
} from '@sfa/shared';

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
 * So the vocabulary lives here, once, and the *state* lives in the URL under
 * the names below. Every queue reads the same params, so a link out of one
 * queue into another (`ticketQueueLink`) carries the view with it, a refresh
 * keeps it, and back restores it.
 *
 * Since PAC-98 the filtering and the ranking happen on the server — the list
 * pages, and a filter or a sort applied to one page in the browser would only
 * ever describe that page. This module turns the view into request parameters;
 * the rows come back already narrowed and ranked, and must be rendered in the
 * order given.
 */

/* -------------------------------------------------------------------------- *
 * Status tabs
 * -------------------------------------------------------------------------- */

/**
 * The status filters a queue can offer, in urgency order.
 *
 * Each maps onto one band of the shared urgency rank
 * (`SERVICE_TICKET_URGENCY_RANK`) — the same numbers the server sorts by — so a
 * tab selects exactly the tickets that sort into that band, and no tab can
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

/** The urgency band each narrowing tab selects. */
const TAB_BAND: Record<Exclude<TicketQueueTab, 'all'>, number> = {
  overdue: 0,
  open: 1,
  waiting: 2,
  resolved: 3,
};

/**
 * A tab as the API's `?status=` list.
 *
 * Derived from the rank rather than listed, so the finer statuses land in the
 * band they sort into: the workspace's "Waiting" used to send `waiting` alone
 * and so never listed a `waiting_on_client` or `waiting_on_carrier` ticket,
 * while the dashboard's "Waiting on Others" — the same band — always did.
 */
export function ticketQueueTabStatuses(
  tab: TicketQueueTab,
): readonly ServiceTicketStatus[] {
  if (tab === 'all') return SERVICE_TICKET_ACTIVE_STATUSES;
  return SERVICE_TICKET_STATUSES.filter(
    (status) => urgencyRankFor(status) === TAB_BAND[tab],
  );
}

/* -------------------------------------------------------------------------- *
 * Sort
 * -------------------------------------------------------------------------- */

/**
 * How the rows are ranked. Urgency is never switched off — the option only
 * decides the order *inside* each urgency band. See `SERVICE_TICKET_QUEUE_SORTS`
 * for the distinction; the server applies it.
 */
export const TICKET_QUEUE_SORTS: readonly {
  value: ServiceTicketQueueSort;
  label: string;
}[] = [
  { value: 'urgency', label: 'Urgency' },
  { value: 'activity', label: 'Latest activity' },
];

export type TicketQueueSort = ServiceTicketQueueSort;

/** Stays out of the URL: the default view carries no `?sort=`. */
export const DEFAULT_TICKET_QUEUE_SORT: TicketQueueSort = 'urgency';

/* -------------------------------------------------------------------------- *
 * URL state
 * -------------------------------------------------------------------------- */

/**
 * The params every queue shares, with the value that means "not set".
 *
 * A surface with extra state of its own (`page`, the workspace feed's `q`)
 * spreads these into its own frozen defaults object — `useUrlState` memoises
 * on the identity of that object, so it has to be module scope at the call
 * site.
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
   * Pinned to the vocabulary, because this value reaches the API.
   *
   * PAC-97 loosened it to a length bound while the filter ran against tickets
   * already in memory, where a value outside the enum cost nothing worse than
   * an empty list. PAC-98 moved the filter onto the request — `?type=` becomes
   * `?category=` — and a hand-edited URL should render the default view, not
   * send junk to Mongo and take a 400.
   */
  type: SERVICE_TICKET_CATEGORIES,
  /*
   * A sort key is ours, not the data's, so anything outside the list is a
   * stale or hand-edited link and the default ranking is the right answer.
   */
  sort: SERVICE_TICKET_QUEUE_SORTS,
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
 * Only the params that decide *which* tickets are listed, and in what order,
 * travel. `page` does not: the dashboard shows 8 rows a page and the workspace
 * feed 25, so page 3 of one is meaningless to the other. Nor does `q`, which
 * is the feed's own.
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
