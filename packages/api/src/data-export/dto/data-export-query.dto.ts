import { DATA_EXPORT_DATASET_KEYS, DATA_EXPORT_FORMATS } from '@sfa/shared';
import { z } from 'zod';
import {
  dashboardFilterFields,
  objectId,
} from '../../common/dashboard/dashboard-filter-query.dto';
import { multiValue } from '../../leads/dto/multi-value';
import { isValidIsoDate } from '../../performance/performance.range';

const isoDate = z
  .string()
  .trim()
  .refine(isValidIsoDate, 'must be a real calendar date (YYYY-MM-DD)');

/** `:dataset` — an unknown key is a 400, not a 404, like every other zod param. */
export const datasetKeySchema = z.enum(DATA_EXPORT_DATASET_KEYS);

/**
 * `POST /data-export/:dataset/exports` — the JSON body.
 *
 * Deliberately **not** `dashboardFilterQuerySchema`: that carries a `range`
 * that defaults to `mtd` and `refineCustomRange`'s 366-day cap, and an export
 * is most often "everything". Here both dates are optional — omitted means
 * open-ended — and the row cap, not the span, bounds the work.
 *
 * The multi-selects reuse the dashboards' fields (whose `multiValue` takes a
 * JSON array as readily as a comma list) so the vocabulary (comma or
 * repeated form, `LEAD_SOURCE_NONE`, the 50-item bound) cannot drift. Which of
 * them a dataset honours, and which `status` / `dateField` values it accepts,
 * is checked by the service against the dataset — a filter the dataset cannot
 * apply is a 400, never silently ignored.
 */
export const dataExportRequestSchema = z
  .object({
    format: z.enum(DATA_EXPORT_FORMATS).default('csv'),
    /** Inclusive calendar dates, cut on the agency's timezone. */
    from: isoDate.optional(),
    to: isoDate.optional(),
    /** One of the dataset's date fields; its default when omitted. */
    dateField: z.string().trim().min(1).max(40).optional(),
    /**
     * Narrows an **agency-scope** caller to one branch. The scope clamps
     * ignore `X-Branch-Id` at agency scope, so without this an owner could not
     * export one branch. Ignored under branch/own scope, which are already
     * pinned.
     */
    branchId: objectId.optional(),
    producerIds: dashboardFilterFields.producerIds,
    leadSourceIds: dashboardFilterFields.leadSourceIds,
    policyTypes: dashboardFilterFields.policyTypes,
    status: z.preprocess(
      multiValue,
      z.array(z.string().trim().min(1).max(60)).max(50).optional(),
    ),
  })
  .superRefine((query, ctx) => {
    if (query.from && query.to && query.from > query.to) {
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: 'to must not be before from',
      });
    }
  });

export type DataExportRequestDto = z.infer<typeof dataExportRequestSchema>;

/** `:id` on `GET /data-export/exports/:id/url` and `POST …/:id/rerun`. */
export const dataExportIdSchema = objectId;

export const dataExportHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type DataExportHistoryQueryDto = z.infer<
  typeof dataExportHistoryQuerySchema
>;
