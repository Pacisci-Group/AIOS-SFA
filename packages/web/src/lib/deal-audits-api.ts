import { apiFetch } from '@/lib/api-client';

export type DealAuditType = 'Auto' | 'Home' | 'Bundle' | 'Other';

/** One pending hand-off row (mirrors the API `DealAuditRow`). */
export interface DealAuditRow {
  id: string;
  /** Human-readable masked label, e.g. `AUD-2026-0042`. */
  ref: string;
  client: string;
  type: DealAuditType;
  missing: string;
  daysOpen: number;
}

export interface DealAuditListResponse {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  items: DealAuditRow[];
}

export interface ListDealAuditsParams {
  page?: number;
  pageSize?: number;
}

export function listDealAudits(params: ListDealAuditsParams = {}) {
  const search = new URLSearchParams();
  if (params.page != null) search.set('page', String(params.page));
  if (params.pageSize != null) search.set('pageSize', String(params.pageSize));
  const qs = search.toString();
  return apiFetch<DealAuditListResponse>(
    `/deal-audits${qs ? `?${qs}` : ''}`,
  );
}
