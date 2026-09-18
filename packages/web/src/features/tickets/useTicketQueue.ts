import { useCallback, useMemo } from 'react';
import type { ServiceTicketView } from '@sfa/shared';
import { useUrlState } from '@/hooks/useUrlState';
import {
  DEFAULT_TICKET_QUEUE_SORT,
  TICKET_QUEUE_TABS,
  TICKET_QUEUE_URL_ALLOWED,
  TICKET_QUEUE_URL_DEFAULTS,
  matchesTicketQueueSearch,
  matchesTicketQueueTab,
  sortTicketQueue,
  ticketQueueCategoryOptions,
  type TicketQueueSort,
  type TicketQueueTab,
} from '@/lib/ticket-queue';

/**
 * `q` on top of the shared three (`tab`, `type`, `sort`) — the feed is the only
 * queue with a search box. Frozen at module scope so `useUrlState`'s memo
 * dependencies stay stable across renders.
 */
const URL_DEFAULTS = { ...TICKET_QUEUE_URL_DEFAULTS, q: '' };

interface UseTicketQueueOptions {
  /** Everything this page loaded — the set the filters narrow. */
  tickets: ServiceTicketView[];
  /**
   * Status tabs to offer; the whole vocabulary by default. `[]` hides the strip
   * and filters no status at all — what the Archived Tickets page wants, where
   * every ticket is resolved and a strip would be four tabs of which one
   * matches.
   */
  tabs?: readonly TicketQueueTab[];
  /**
   * The ticket the workspace pane is showing. Kept in the list whatever the
   * filters say — see `rows`.
   */
  selectedId?: string | null;
}

export interface TicketQueue {
  tab: TicketQueueTab;
  /** `''` means every category. */
  type: string;
  sort: TicketQueueSort;
  query: string;
  setTab: (tab: TicketQueueTab) => void;
  setType: (type: string) => void;
  setSort: (sort: TicketQueueSort) => void;
  setQuery: (query: string) => void;
  clearFilters: () => void;
  /** Status tabs to render; empty when this queue has none. */
  tabs: readonly TicketQueueTab[];
  /** Categories to offer: those present in the data, plus the selected one. */
  categoryOptions: string[];
  /** Rows to render — filtered, sorted, selected ticket kept visible. */
  rows: ServiceTicketView[];
  /** First matching ticket, for a page choosing a default selection. */
  firstMatchId: string | null;
  /** Whether anything is currently narrowing the list. */
  isFiltered: boolean;
}

/**
 * The ticket workspace queue's filters, search and ranking — held in the URL.
 *
 * The state is in the URL and the vocabulary is in `lib/ticket-queue.ts`
 * precisely so this queue and the Service Dashboard's are the same queue: the
 * dashboard's "Open" link carries `?tab=&type=&sort=` across
 * (`ticketQueueLink`), and this hook reads them straight back. Before that the
 * filters were `useState` here, so arriving from a filtered dashboard showed an
 * unfiltered list of different tickets in a different order.
 *
 * Lives in the page rather than inside `TicketFeed` because the page has to
 * choose which ticket the workspace pane opens on, and "the first one" has to
 * mean the first *row the rep can see* (`firstMatchId`) — it used to mean
 * `tickets[0]`, the API's own order, which is not the order the list renders.
 */
export function useTicketQueue({
  tickets,
  tabs = TICKET_QUEUE_TABS,
  selectedId = null,
}: UseTicketQueueOptions): TicketQueue {
  /*
   * `tab` is guarded against the tabs this queue actually shows, so a stale or
   * hand-edited value (or one carried from a queue with a different strip)
   * falls back to `all` rather than filtering the list with no active chip to
   * explain it.
   */
  const allowed = useMemo(
    () => ({ ...TICKET_QUEUE_URL_ALLOWED, tab: tabs }),
    [tabs],
  );
  const [urlState, setUrlState] = useUrlState({
    defaults: URL_DEFAULTS,
    allowed,
  });

  const tab = (tabs.length ? urlState.tab : 'all') as TicketQueueTab;
  const type = urlState.type;
  const sort = (urlState.sort || DEFAULT_TICKET_QUEUE_SORT) as TicketQueueSort;
  const query = urlState.q;

  const matches = useMemo(() => {
    const hits = tickets.filter(
      (ticket) =>
        (!tabs.length || matchesTicketQueueTab(ticket.status, tab)) &&
        (!type || ticket.category === type) &&
        matchesTicketQueueSearch(ticket, query),
    );
    return sortTicketQueue(hits, sort);
  }, [tickets, tabs, tab, type, query, sort]);

  /**
   * The open ticket stays in the list even when the filters exclude it.
   *
   * Without this, following a link to a resolved ticket (the household
   * activity feed, an onboarding chain row) lands on a queue whose default tab
   * is the active work — the workspace shows the ticket while the list beside
   * it has no row for it, which reads as the wrong ticket having opened. It
   * sorts into its natural band rather than being pinned to the top, and it
   * counts towards the total, which is "what you can see" and not "what
   * matches" — a count of 0 above a visible row is the same class of lie this
   * whole change is about.
   */
  const rows = useMemo(() => {
    if (!selectedId || matches.some((t) => t.id === selectedId)) return matches;
    const selected = tickets.find((t) => t.id === selectedId);
    if (!selected) return matches;
    return sortTicketQueue([...matches, selected], sort);
  }, [matches, tickets, selectedId, sort]);

  const categoryOptions = useMemo(
    () => ticketQueueCategoryOptions(tickets, type),
    [tickets, type],
  );

  const setTab = useCallback(
    (next: TicketQueueTab) => setUrlState({ tab: next }),
    [setUrlState],
  );
  const setType = useCallback(
    (next: string) => setUrlState({ type: next }),
    [setUrlState],
  );
  const setSort = useCallback(
    (next: TicketQueueSort) =>
      setUrlState({ sort: next === DEFAULT_TICKET_QUEUE_SORT ? '' : next }),
    [setUrlState],
  );
  const setQuery = useCallback(
    (next: string) => setUrlState({ q: next }),
    [setUrlState],
  );
  /** One write, not four — see `useUrlState` on why a group updates together. */
  const clearFilters = useCallback(
    () => setUrlState({ tab: 'all', type: '', sort: '', q: '' }),
    [setUrlState],
  );

  return {
    tab,
    type,
    sort,
    query,
    setTab,
    setType,
    setSort,
    setQuery,
    clearFilters,
    tabs,
    categoryOptions,
    rows,
    firstMatchId: matches[0]?.id ?? null,
    isFiltered: tab !== 'all' || Boolean(type) || Boolean(query.trim()),
  };
}
