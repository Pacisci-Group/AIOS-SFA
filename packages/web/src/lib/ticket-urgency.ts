import type { ServiceTicketStatus, ServiceTicketView } from '@sfa/shared';

/**
 * Shared ordering for every ticket queue: most urgent first.
 *
 * Used by both the Service Dashboard's Priority Ticket Queue and the ticket
 * workspace feed, so the same ticket occupies the same relative position
 * wherever a CSR sees it.
 *
 * Deliberately not the API's `lastActivityAt` ordering — recency tells you who
 * was worked on last, not what needs working on next.
 */

/**
 * How loudly a status demands attention. Lower sorts first.
 *
 * The finer create-form statuses collapse onto the four states the queue
 * actually reasons about: something is late, something is workable now,
 * something is blocked on someone else, or it is finished.
 */
const URGENCY_RANK: Record<ServiceTicketStatus, number> = {
  overdue: 0,
  open: 1,
  in_progress: 1,
  waiting: 2,
  waiting_on_client: 2,
  waiting_on_carrier: 2,
  resolved: 3,
  closed: 3,
};

const PRIORITY_RANK: Record<ServiceTicketView['priority'], number> = {
  high: 0,
  medium: 1,
  low: 2,
};

/**
 * The instant a ticket started demanding attention.
 *
 * Onboarding calls carry a real deadline, so that is the honest answer for
 * them. Nothing else has one, so fall back to when the ticket was opened.
 * Either way, *earlier means more urgent* — which is what makes "longest
 * overdue first" fall out of a plain ascending sort.
 */
function urgencyInstant(ticket: ServiceTicketView): number {
  const due = ticket.onboarding?.dueAt;
  return Date.parse(due ?? ticket.openedAt);
}

/**
 * Order tickets by urgency:
 *
 *   1. status — overdue, then workable now, then blocked, then done
 *   2. how long it has been demanding attention — within overdue this is
 *      literally "overdue the longest first"
 *   3. priority, as a tiebreak between equally-aged tickets
 *
 * Note that (2) outranks priority on purpose: a call that blew its SLA three
 * days ago outranks one that blew it this morning, whatever their priorities.
 */
export function compareTicketUrgency(
  a: ServiceTicketView,
  b: ServiceTicketView,
): number {
  const byStatus = URGENCY_RANK[a.status] - URGENCY_RANK[b.status];
  if (byStatus !== 0) return byStatus;

  const byAge = urgencyInstant(a) - urgencyInstant(b);
  if (byAge !== 0) return byAge;

  const byPriority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  if (byPriority !== 0) return byPriority;

  // Stable final tiebreak so the list never reshuffles between renders.
  return a.ticketNumber.localeCompare(b.ticketNumber);
}

/** Sorted copy, most urgent first. */
export function sortByUrgency(
  tickets: ServiceTicketView[],
): ServiceTicketView[] {
  return [...tickets].sort(compareTicketUrgency);
}
