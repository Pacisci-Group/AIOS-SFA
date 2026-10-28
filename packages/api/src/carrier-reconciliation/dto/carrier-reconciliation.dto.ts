import {
  DATA_EXPORT_FORMATS,
  MAX_RECONCILIATION_FILE_BYTES,
  RECONCILIATION_PRODUCER_KEY_PATTERN,
  RECONCILIATION_RESOLUTIONS,
  RECONCILIATION_REVIEW_STATUSES,
  RECONCILIATION_TABS,
} from '@sfa/shared';
import { z } from 'zod';
import { objectId } from '../../common/dashboard/dashboard-filter-query.dto';

/** `:id`, `:rowId`. */
export const reconciliationIdSchema = objectId;

export const presignRunSchema = z.object({
  filename: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .refine((name) => /\.xlsx$/i.test(name), 'Upload the Dash report as .xlsx'),
  size: z.number().int().min(1).max(MAX_RECONCILIATION_FILE_BYTES),
});
export type PresignRunDto = z.infer<typeof presignRunSchema>;

export const createRunSchema = z.object({
  storageKey: z.string().trim().min(1).max(512),
  uploadedFilename: z.string().trim().min(1).max(255),
  size: z.number().int().min(1),
});
export type CreateRunDto = z.infer<typeof createRunSchema>;

export const listRunsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  includeSuperseded: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});
export type ListRunsDto = z.infer<typeof listRunsSchema>;

export const rowsQuerySchema = z.object({
  tab: z.enum(RECONCILIATION_TABS).optional(),
  /** A `producerKey`: `user:<id>`, `code:<sub-producer>`, `bind:<Bind ID>` or `none`. */
  producer: z
    .string()
    .trim()
    .regex(RECONCILIATION_PRODUCER_KEY_PATTERN)
    .optional(),
  reviewStatus: z.enum(RECONCILIATION_REVIEW_STATUSES).optional(),
  q: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type RowsQueryDto = z.infer<typeof rowsQuerySchema>;

export const reviewRowSchema = z
  .object({
    status: z.enum(RECONCILIATION_REVIEW_STATUSES),
    resolution: z.enum(RECONCILIATION_RESOLUTIONS).nullable().optional(),
    note: z.string().trim().max(2000).nullable().optional(),
  })
  .superRefine((body, ctx) => {
    if (body.status === 'resolved' && !body.resolution) {
      ctx.addIssue({
        code: 'custom',
        path: ['resolution'],
        message: 'say how it was resolved',
      });
    }
  });
export type ReviewRowDto = z.infer<typeof reviewRowSchema>;

export const exportQuerySchema = z.object({
  format: z.enum(DATA_EXPORT_FORMATS).default('xlsx'),
  /** One tab; omitted means every exception tab. */
  tab: z.enum(RECONCILIATION_TABS).optional(),
});
export type ExportQueryDto = z.infer<typeof exportQuerySchema>;
