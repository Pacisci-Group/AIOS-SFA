import type { LeadTemperature } from '@sfa/shared';

/**
 * A single row of the Leads list. Deliberately flat and display-ready: the table
 * renders exactly these fields.
 *
 * What is *not* here matters as much as what is. The legacy endpoint shipped the
 * entire SmartSuite `rawRecord` for every row; we return no `legacy*` ids, no
 * `isTestRecord`, no `agencyId`/`branchId`, and no raw select codes — `status`
 * and `leadSource` are always normalized labels.
 */
export interface LeadRow {
  /** Record id — the only identifier exposed; the detail route needs it. */
  id: string;
  /** `firstName lastName`, or `Unknown Lead` when both are empty. */
  name: string;
  /** Normalized lead-source label, never a raw choice code. */
  leadSource: string;
  /** Canonical status label — `arW7O` is normalized to `Requote`. */
  status: string;
  temperature: LeadTemperature;
  /** First phone as stored; the client formats it for display. */
  phone: string | null;
  email: string | null;
  /** ISO timestamp of last activity — drives the default sort. */
  updatedAt: string | null;
}

/** Paginated envelope returned by `GET /leads`. */
export interface LeadListResponse {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  items: LeadRow[];
}
