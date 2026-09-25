import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type {
  ServiceTicketCategory,
  ServiceTicketListResponse,
  ServiceTicketScope,
  ServiceTicketView,
} from '@sfa/shared';
import { SERVICE_TICKET_CATEGORIES, SERVICE_TICKET_SCOPES } from '@sfa/shared';
import { useUrlState } from '@/hooks/useUrlState';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { SEARCH_DEBOUNCE_MS } from '@/components/common/TableSearchInput';
import { listServiceTickets } from '@/lib/service-tickets-api';
import {
  DEFAULT_TICKET_QUEUE_SORT,
  TICKET_QUEUE_TABS,
  TICKET_QUEUE_URL_ALLOWED,
  TICKET_QUEUE_URL_DEFAULTS,
  ticketQueueTabStatuses,
  type TicketQueueSort,
  type TicketQueueTab,
} from '@/lib/ticket-queue';

/**
 * Rows per page of the ticket feed (Ticket Workspace and Archived Tickets).
 *
 * Larger than the dashboard queue's 8: this is a full-height list rather than
 * a card, and the server caps every caller at 100 regardless.
 */
export const FEED_PAGE_SIZE = 25;

/**
 * `q` and `page` on top of the shared three (`tab`, `type`, `sort`) — the feed
 * is the only queue with a search box, and its page size is its own. Frozen at
 * module scope so `useUrlState`'s memo dependencies stay stable across renders.
 * `page: ''` is the default, so `?page=1` never appears.
 *
 * `scope` is the Mine / Everyone toggle (PAC-109). Mine by default — a rep
 * opens the workspace to work their own plate, the opposite default to the
 * Leads list. It is not one of the shared params, so `ticketQueueLink` does not
 * carry the dashboard's `own` / `others` split across.
 */
const URL_DEFAULTS = {
  ...TICKET_QUEUE_URL_DEFAULTS,
  q: '',
  page: '',
  scope: 'own' as string,
};

interface UseTicketQueueOptions {
  /** The Archived Tickets view: the other side of the archive window. */
  archived?: boolean;
  /**
   * Status tabs to offer; the whole vocabulary by default. `[]` hides the strip
   * and filters no status at all — what the Archived Tickets page wants, where
   * every ticket is resolved and a strip would be four tabs of which one
   * matches.
   */
  tabs?: readonly TicketQueueTab[];
}

export interface TicketQueue {
  tab: TicketQueueTab;
  /** `''` means every category. */
  type: string;
  sort: TicketQueueSort;
  /** Mine / Everyone (PAC-109). */
  scope: ServiceTicketScope;
  /** What is in the search box — ahead of the request by the debounce. */
  query: string;
  setTab: (tab: TicketQueueTab) => void;
  setType: (type: string) => void;
  setSort: (sort: TicketQueueSort) => void;
  setScope: (scope: ServiceTicketScope) => void;
  setQuery: (query: string) => void;
  setPage: (page: number) => void;
  clearFilters: () => void;
  /** Status tabs to render; empty when this queue has none. */
  tabs: readonly TicketQueueTab[];
  /** The whole category vocabulary — see the note on the hook. */
  categoryOptions: readonly string[];
  /** One page of rows, narrowed and ranked by the server. Render as given. */
  rows: ServiceTicketView[];
  /** The page envelope, for pagination and the header count. */
  page: ServiceTicketListResponse | undefined;
  /** The page the URL asks for, before the response confirms it. */
  requestedPage: number;
  pageSize: number;
  /** Whether anything is currently narrowing the list. */
  isFiltered: boolean;
  isLoading: boolean;
  isError: boolean;
  /** A page is in flight — the search box and the pager say so. */
  isFetching: boolean;
  refetch: () => void;
}

/**
 * The ticket workspace queue — its filters, search, ranking and page, held in
 * the URL and served by the API.
 *
 * The state is in the URL and the vocabulary is in `lib/ticket-queue.ts`
 * precisely so this queue and the Service Dashboard's are the same queue: the
 * dashboard's "Open" link carries `?tab=&type=&sort=` across
 * (`ticketQueueLink`), and this hook reads them straight back. Before that the
 * filters were `useState` here, so arriving from a filtered dashboard showed an
 * unfiltered list of different tickets in a different order.
 *
 * Since PAC-98 every one of them is a request parameter: the list is paged by
 * the server, so a filter applied here would only ever narrow the page in
 * front of you. Changing any of them returns to page 1 — page 3 of an
 * unfiltered list is not page 3 of a filtered one.
 *
 * The category options are the whole vocabulary rather than the categories on
 * screen: derived from one page, they would change under the rep as they
 * paged, and a category would vanish from the picker while its tickets sat on
 * page two.
 */
export function useTicketQueue({
  archived = false,
  tabs = TICKET_QUEUE_TABS,
}: UseTicketQueueOptions = {}): TicketQueue {
  /*
   * `tab` is guarded against the tabs this queue actually shows, so a stale or
   * hand-edited value (or one carried from a queue with a different strip)
   * falls back to `all` rather than filtering the list with no active chip to
   * explain it.
   */
  const allowed = useMemo(
    () => ({
      ...TICKET_QUEUE_URL_ALLOWED,
      tab: tabs,
      scope: SERVICE_TICKET_SCOPES,
      page: (value: string) => /^[1-9]\d*$/.test(value),
    }),
    [tabs],
  );
  const [urlState, setUrlState] = useUrlState({
    defaults: URL_DEFAULTS,
    allowed,
  });

  const tab = (tabs.length ? urlState.tab : 'all') as TicketQueueTab;
  const type = urlState.type;
  const sort = (urlState.sort || DEFAULT_TICKET_QUEUE_SORT) as TicketQueueSort;
  const scope = urlState.scope as ServiceTicketScope;
  const query = urlState.q;
  const requestedPage = Number(urlState.page) || 1;

  // Typing should not fire a request per keystroke.
  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);

  const request = useMemo(
    () => ({
      archived,
      page: requestedPage,
      pageSize: FEED_PAGE_SIZE,
      search: debouncedQuery.trim() || undefined,
      category: (type || undefined) as ServiceTicketCategory | undefined,
      // No strip, no status filter — the archive lists whatever aged out.
      status: tabs.length ? ticketQueueTabStatuses(tab) : undefined,
      sort,
      scope,
    }),
    [archived, requestedPage, debouncedQuery, type, tabs, tab, sort, scope],
  );

  const ticketsQuery = useQuery({
    // Under the prefixes the pages' mutations invalidate.
    queryKey: archived
      ? ['service-tickets', 'archived', request]
      : ['service-tickets', request],
    queryFn: () => listServiceTickets(request),
    // Hold the previous page while the next loads, so paging does not blank
    // the feed and drop the selection out from under the workspace pane.
    placeholderData: (previous) => previous,
  });

  const setTab = useCallback(
    (next: TicketQueueTab) => setUrlState({ tab: next, page: '' }),
    [setUrlState],
  );
  const setType = useCallback(
    (next: string) => setUrlState({ type: next, page: '' }),
    [setUrlState],
  );
  const setSort = useCallback(
    (next: TicketQueueSort) =>
      setUrlState({
        sort: next === DEFAULT_TICKET_QUEUE_SORT ? '' : next,
        page: '',
      }),
    [setUrlState],
  );
  const setScope = useCallback(
    (next: ServiceTicketScope) => setUrlState({ scope: next, page: '' }),
    [setUrlState],
  );
  const setQuery = useCallback(
    (next: string) => setUrlState({ q: next, page: '' }),
    [setUrlState],
  );
  const setPage = useCallback(
    (next: number) => setUrlState({ page: next <= 1 ? '' : String(next) }),
    [setUrlState],
  );
  /** One write, not five — see `useUrlState` on why a group updates together. */
  const clearFilters = useCallback(
    () => setUrlState({ tab: 'all', type: '', sort: '', q: '', page: '' }),
    [setUrlState],
  );

  const { refetch } = ticketsQuery;
  const retry = useCallback(() => void refetch(), [refetch]);

  return {
    tab,
    type,
    sort,
    scope,
    query,
    setTab,
    setType,
    setSort,
    setScope,
    setQuery,
    setPage,
    clearFilters,
    tabs,
    categoryOptions: SERVICE_TICKET_CATEGORIES,
    rows: ticketsQuery.data?.items ?? EMPTY,
    page: ticketsQuery.data,
    requestedPage,
    pageSize: FEED_PAGE_SIZE,
    isFiltered: tab !== 'all' || Boolean(type) || Boolean(query.trim()),
    isLoading: ticketsQuery.isLoading,
    isError: ticketsQuery.isError,
    isFetching: ticketsQuery.isFetching,
    refetch: retry,
  };
}

/** Stable, so a page with no data does not hand consumers a new array each render. */
const EMPTY: ServiceTicketView[] = [];
