import type {
  ServiceTicketNoteType,
  ServiceTicketStats,
  ServiceTicketStatus,
  ServiceTicketView,
} from '@sfa/shared';
import { apiFetch } from '@/lib/api-client';

export type {
  ServiceTicketNoteType,
  ServiceTicketStats,
  ServiceTicketStatus,
  ServiceTicketView,
} from '@sfa/shared';

const BASE = '/crm/service-tickets';

export function listServiceTickets(status?: ServiceTicketStatus) {
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  return apiFetch<ServiceTicketView[]>(`${BASE}${qs}`);
}

export function getServiceTicketStats() {
  return apiFetch<ServiceTicketStats>(`${BASE}/stats`);
}

export function getServiceTicket(id: string) {
  return apiFetch<ServiceTicketView>(`${BASE}/${id}`);
}

export function updateServiceTicketStatus(
  id: string,
  status: ServiceTicketStatus,
) {
  return apiFetch<ServiceTicketView>(`${BASE}/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export function addServiceTicketNote(
  id: string,
  content: string,
  type?: ServiceTicketNoteType,
) {
  return apiFetch<ServiceTicketView>(`${BASE}/${id}/notes`, {
    method: 'POST',
    body: JSON.stringify(type ? { content, type } : { content }),
  });
}
