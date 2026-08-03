import { LEAD_TEMPERATURES } from '@sfa/shared';
import { z } from 'zod';

/**
 * Query params for `GET /leads`. Values arrive as strings, so numbers and dates
 * are coerced, then bounded + defaulted. `page` is 1-based; `pageSize` defaults
 * to the legacy Leads page size (50) and is capped so a client can't ask for the
 * whole collection.
 *
 * `scope` is a *request*, not an authorization: the service clamps it down to
 * whatever the caller's `DataScope` actually permits (see `leads.service.ts`).
 */
export const listLeadsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  /** Free-text query; interpreted by shape (phone / email / name+source+QCN). */
  search: z.string().trim().max(120).optional(),
  /** Canonical status label, e.g. `Requote` — matched against raw codes too. */
  status: z.string().trim().max(60).optional(),
  temperature: z.enum(LEAD_TEMPERATURES).optional(),
  /**
   * Canonical lead-source label, e.g. `Mailer` — or the `LEAD_SOURCE_NONE`
   * sentinel (`__none__`) to isolate leads with no source recorded, which is
   * how share-link submissions arrive (PAC-37). An empty string can't be a
   * meaningful query-param value, hence the sentinel.
   */
  leadSource: z.string().trim().max(80).optional(),
  /** Narrow to one producer. Ignored for `own` scope; clamped otherwise. */
  producerId: z.string().trim().optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  scope: z.enum(['own', 'agency']).optional(),
});

/** Inferred TypeScript type — single source of truth for the parsed query. */
export type ListLeadsDto = z.infer<typeof listLeadsSchema>;
