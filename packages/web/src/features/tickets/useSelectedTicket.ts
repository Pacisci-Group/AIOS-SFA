import { useQuery } from '@tanstack/react-query';
import type { ServiceTicketView } from '@sfa/shared';
import { getServiceTicket } from '@/lib/service-tickets-api';

/**
 * The ticket the workspace pane shows — from the page in hand when it is on
 * it, otherwise fetched by id.
 *
 * The feed holds one page since PAC-98, so "find it in the list" stopped being
 * enough: a `?ticket=` link from the household activity feed to a ticket
 * resolved last week, or to one on page four, would otherwise open an empty
 * pane. The ticket stays open whatever the filters or the page say; the list
 * beside it is still the page the filters produced.
 *
 * Keyed under `service-tickets` so every mutation that refreshes the queue
 * refreshes this too.
 */
export function useSelectedTicket(
  id: string | null,
  rows: ServiceTicketView[],
): ServiceTicketView | null {
  const onPage = id ? rows.find((t) => t.id === id) : undefined;

  const detailQuery = useQuery({
    queryKey: ['service-tickets', 'detail', id],
    queryFn: () => getServiceTicket(id as string),
    enabled: Boolean(id) && !onPage,
  });

  return onPage ?? (id ? detailQuery.data ?? null : null);
}
