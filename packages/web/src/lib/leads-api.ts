import type {
  HotLeadListResponse,
  HotLeadRow,
  LeadDetail,
  LeadTemperature,
  ServiceTicketView,
  UpdateLeadInput,
  UpdateLeadResult,
} from '@sfa/shared';
import { apiFetch } from '@/lib/api-client';

export type { HotLeadListResponse, HotLeadRow };

/**
 * The detail contracts are **re-exported from `@sfa/shared`**, not redeclared.
 *
 * `LeadRow` below is a hand-kept copy of the API's own interface and has had to
 * be reconciled by eye ever since; `LeadDetail` is ten nested interfaces, so a
 * second copy would drift on the first change. PAC-38 put it in `shared` and
 * both sides import it.
 */
export type { LeadDetail, UpdateLeadInput, UpdateLeadResult };

/** One Leads-list row (mirrors the API `LeadRow`). */
export interface LeadRow {
  id: string;
  /** `Unknown Lead` when the record has no name. */
  name: string;
  /** Normalized label, never a raw SmartSuite choice code. */
  leadSource: string;
  /** Canonical status label — the API normalizes `arW7O` to `Requote`. */
  status: string;
  temperature: LeadTemperature;
  /** Raw as stored; format with `formatPhone` for display. */
  phone: string | null;
  email: string | null;
  updatedAt: string | null;
}

export interface LeadListResponse {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  items: LeadRow[];
}

export interface ListLeadsParams {
  page?: number;
  pageSize?: number;
  search?: string;
  /** Canonical status labels; several are ORed together. */
  status?: string[];
  /** Several are ORed together. */
  temperature?: string[];
  leadSource?: string;
  producerId?: string;
  /**
   * Every lead on one household — the Household page's "Start Quote" lead
   * picker. Narrows within the caller's data scope, so a producer still sees
   * only their own leads for that household.
   */
  householdId?: string;
  /** `YYYY-MM-DD` */
  dateFrom?: string;
  /** `YYYY-MM-DD` */
  dateTo?: string;
  /**
   * Requested scope for the My/Agency toggle. The API clamps this down to what
   * the caller's `DataScope` permits, so it is a convenience, never a grant.
   */
  scope?: 'own' | 'agency';
}

export function listLeads(params: ListLeadsParams = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '') continue;
    if (Array.isArray(value)) {
      // Repeated params (`?status=New&status=Sold`) — Express parses these into
      // an array, which is what the DTO expects for the multi-value filters.
      for (const item of value) {
        search.append(key, String(item));
      }
      continue;
    }
    search.set(key, String(value));
  }
  const qs = search.toString();
  return apiFetch<LeadListResponse>(`/leads${qs ? `?${qs}` : ''}`);
}

/** `GET /leads/:id` — the whole 360° view in one request (PAC-38). */
export function getLead(leadId: string) {
  return apiFetch<LeadDetail>(`/leads/${encodeURIComponent(leadId)}`);
}

/**
 * `PATCH /leads/:id` — the inline status / temperature / source edits.
 *
 * Returns only the fields the patch can change, so the caller writes those four
 * values into its cached `LeadDetail` rather than refetching the whole thing.
 */
export function updateLead(leadId: string, input: UpdateLeadInput) {
  return apiFetch<UpdateLeadResult>(`/leads/${encodeURIComponent(leadId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

/**
 * `POST /leads/:id/service-ticket` — open the CRM service ticket for a lead, or
 * return the one it already has.
 *
 * Called by the Start Quote dialog once a lead is chosen, for a freshly created
 * lead and for one picked off the list alike. **Idempotent**, so the caller does
 * not check first: the server arbitrates on a unique index, which is the only
 * thing that can settle two dialogs racing on the same lead.
 *
 * Gated on `leads:write`, not `crm_service:write` — see the handler's docblock
 * for why the endpoint hangs off `/leads`.
 */
export function openLeadServiceTicket(leadId: string) {
  return apiFetch<ServiceTicketView>(
    `/leads/${encodeURIComponent(leadId)}/service-ticket`,
    { method: "POST" },
  );
}

export interface ListHotLeadsParams {
  limit?: number;
  /** Temperatures to draw from, in priority order. Defaults to Hot then Warm. */
  temperature?: LeadTemperature[];
  scope?: 'own' | 'agency';
}

/**
 * `GET /leads/hot` — the Priority Contact List (PAC-15).
 *
 * Its own route rather than a filter on `GET /leads`: the ordering is inverted
 * (stalest first, not most-recently-touched), and each row carries the latest
 * activity summary that the Leads table has no use for. Not paginated — the
 * panel is a fixed-size card.
 */
export function listHotLeads(params: ListHotLeadsParams = {}) {
  const search = new URLSearchParams();
  if (params.limit != null) search.set('limit', String(params.limit));
  if (params.scope) search.set('scope', params.scope);
  for (const value of params.temperature ?? []) {
    search.append('temperature', value);
  }
  const qs = search.toString();

  return apiFetch<HotLeadListResponse>(`/leads/hot${qs ? `?${qs}` : ''}`);
}

/**
 * Display formatting for a stored phone number. The API returns whatever the
 * source system held, so only recognisable US numbers are reformatted —
 * anything else is shown as-is rather than mangled.
 */
export function formatPhone(raw: string | null): string {
  if (!raw) return '—';
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return raw;
}
