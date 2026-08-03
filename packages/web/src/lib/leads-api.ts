import type { LeadTemperature } from '@sfa/shared';
import { apiFetch } from '@/lib/api-client';

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
