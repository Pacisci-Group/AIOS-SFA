import type {
  BugReportDetail,
  BugReportListResponse,
  BugReportStatus,
  BugSeverity,
} from '@sfa/shared';
import { apiFetch } from '@/lib/api-client';

/**
 * The Super Admin bug queue — read and triage.
 *
 * Everything here is behind `platform:bugs:read` / `platform:bugs:write` and
 * reads across every tenant, because a platform operator has no agency of their
 * own. The reporter-facing half lives in `bug-reports-api.ts` and needs no
 * permission at all.
 */

export type { BugReportDetail, BugReportListResponse };

export interface BugReportFilters {
  /** Omit for every status; the queue's default is the three open ones. */
  status?: BugReportStatus[];
  severity?: BugSeverity;
  agencyId?: string;
  search?: string;
  limit?: number;
  skip?: number;
}

export function listBugReports(filters: BugReportFilters = {}) {
  const params = new URLSearchParams();
  // Comma-separated so "everything still open" is one request, not three.
  if (filters.status?.length) params.set('status', filters.status.join(','));
  if (filters.severity) params.set('severity', filters.severity);
  if (filters.agencyId) params.set('agencyId', filters.agencyId);
  if (filters.search) params.set('search', filters.search);
  if (filters.limit !== undefined) params.set('limit', String(filters.limit));
  if (filters.skip !== undefined) params.set('skip', String(filters.skip));

  const query = params.toString();
  return apiFetch<BugReportListResponse>(
    `/platform/bug-reports${query ? `?${query}` : ''}`,
  );
}

export function getBugReport(id: string) {
  return apiFetch<BugReportDetail>(`/platform/bug-reports/${id}`);
}

/**
 * Set the status and/or the internal notes.
 *
 * An empty `internalNotes` string clears the note; omitting the field leaves it
 * alone. The API rejects a body that carries neither field.
 */
export function updateBugReport(
  id: string,
  patch: { status?: BugReportStatus; internalNotes?: string },
) {
  return apiFetch<BugReportDetail>(`/platform/bug-reports/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}
