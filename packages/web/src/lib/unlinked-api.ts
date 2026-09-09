import type {
  UnlinkedCounts,
  UnlinkedRecordKind,
  UnlinkedRecordsResponse,
} from '@sfa/shared';
import { apiFetch } from '@/lib/api-client';

export type {
  UnlinkedContactRow,
  UnlinkedCounts,
  UnlinkedHouseholdRow,
  UnlinkedPolicyRow,
  UnlinkedRecordKind,
  UnlinkedRecordsResponse,
} from '@sfa/shared';
export { UNLINKED_RECORD_KINDS } from '@sfa/shared';

const BASE = '/clients/unlinked';

export interface ListUnlinkedParams {
  kind: UnlinkedRecordKind;
  page?: number;
  pageSize?: number;
}

/**
 * `GET /clients/unlinked` — one page of one kind of unlinked record
 * (PAC-91 §10). `clients:read`.
 *
 * The response repeats `kind` as a discriminant, so narrow on
 * `response.kind` rather than on the argument that was sent: it is the row
 * shape actually in hand.
 */
export function listUnlinked({
  kind,
  page = 1,
  pageSize = 50,
}: ListUnlinkedParams) {
  const params = new URLSearchParams({
    kind,
    page: String(page),
    pageSize: String(pageSize),
  });
  return apiFetch<UnlinkedRecordsResponse>(`${BASE}?${params}`);
}

/**
 * `GET /clients/unlinked/counts` — the three numbers on the filter chips.
 *
 * Its own request because the page shows all three counts whichever list is
 * open, so they cache and refetch independently of the page being read.
 */
export function getUnlinkedCounts() {
  return apiFetch<UnlinkedCounts>(`${BASE}/counts`);
}
