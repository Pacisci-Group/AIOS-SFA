import { LEAD_STATUSES, LEAD_TEMPERATURES } from '@sfa/shared';
import { z } from 'zod';
import { multiValue } from './multi-value';

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
  /**
   * Canonical status labels, e.g. `Requote` — matched against raw codes too.
   * Multi-select: several values are ORed. Bounded by the size of the
   * vocabulary, since selecting every status is the same as selecting none.
   */
  status: z.preprocess(
    multiValue,
    z.array(z.string().max(60)).max(LEAD_STATUSES.length).optional(),
  ),
  /** Multi-select: several values are ORed. */
  temperature: z.preprocess(
    multiValue,
    z.array(z.enum(LEAD_TEMPERATURES)).max(LEAD_TEMPERATURES.length).optional(),
  ),
  /** Canonical lead-source label, e.g. `Mailer`. */
  leadSource: z.string().trim().max(80).optional(),
  /** Narrow to one producer. Ignored for `own` scope; clamped otherwise. */
  producerId: z.string().trim().optional(),
  /**
   * Narrow to one household — the Household page's "Start Quote" lead picker.
   *
   * Shape-checked here rather than in the service so a malformed id is a `400`
   * instead of a Mongoose `CastError` surfacing as a 500. It narrows *within*
   * the scope clamp and never widens it: a producer still sees only their own
   * leads for that household.
   */
  householdId: z
    .string()
    .trim()
    .regex(/^[a-f0-9]{24}$/i, 'householdId must be a record id')
    .optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  scope: z.enum(['own', 'agency']).optional(),
});

/** Inferred TypeScript type — single source of truth for the parsed query. */
export type ListLeadsDto = z.infer<typeof listLeadsSchema>;
