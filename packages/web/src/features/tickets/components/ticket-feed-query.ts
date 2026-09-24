import type { ServiceTicketStatus } from "@sfa/shared";
import type { TicketFeedFilters } from "./TicketFeed";

/**
 * Rows per page of the ticket feed (Ticket Workspace and Archived Tickets).
 *
 * Larger than the dashboard queue's 8: this is a full-height list rather than
 * a card, and the server caps every caller at 100 regardless.
 */
export const FEED_PAGE_SIZE = 25;

/**
 * The feed's status tabs, as the API's `?status=`.
 *
 * `open` covers overdue too — an overdue ticket is an open one that is late,
 * and the tab has always shown both. That is why this maps to a *list*: with a
 * single status the Open tab could only send nothing, which made it identical
 * to All. `undefined` is "no status filter".
 */
const FEED_TAB_STATUSES: Record<
  TicketFeedFilters["filter"],
  readonly ServiceTicketStatus[] | undefined
> = {
  all: undefined,
  open: ["open", "overdue"],
  waiting: ["waiting"],
  resolved: ["resolved"],
};

/**
 * The feed's controls as request parameters, given the already-debounced
 * search text. Both pages build their query key and their request from this,
 * so the two cannot disagree about what a tab means.
 */
export function feedRequestFilters(
  filters: TicketFeedFilters,
  debouncedQuery: string,
) {
  return {
    search: debouncedQuery.trim() || undefined,
    category: filters.category === "all" ? undefined : filters.category,
    status: FEED_TAB_STATUSES[filters.filter],
  };
}
