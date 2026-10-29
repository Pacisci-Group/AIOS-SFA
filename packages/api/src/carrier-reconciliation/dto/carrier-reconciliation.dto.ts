import {
  DATA_EXPORT_FORMATS,
  MAX_RECONCILIATION_ASSIGNMENT_NOTE_LENGTH,
  MAX_RECONCILIATION_FILE_BYTES,
  MAX_RECONCILIATION_OUTCOME_NOTE_LENGTH,
  RECONCILIATION_ASSIGNEE_FILTER_PATTERN,
  RECONCILIATION_OUTCOME_FILTERS,
  RECONCILIATION_OUTCOME_KINDS,
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
  /** A `producerKey`: `user:<id>`, `bind:<Bind ID>` or `none` (`code:` on older runs). */
  producer: z
    .string()
    .trim()
    .regex(RECONCILIATION_PRODUCER_KEY_PATTERN)
    .optional(),
  reviewStatus: z.enum(RECONCILIATION_REVIEW_STATUSES).optional(),
  /** A user id, `me`, or `unassigned`. */
  assignee: z
    .string()
    .trim()
    .regex(RECONCILIATION_ASSIGNEE_FILTER_PATTERN)
    .transform((value) => value.toLowerCase())
    .optional(),
  /** `in_progress` / `done`, or an outcome kind (PAC-173 PR 4). */
  outcome: z.enum(RECONCILIATION_OUTCOME_FILTERS).optional(),
  q: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type RowsQueryDto = z.infer<typeof rowsQuerySchema>;

/**
 * The owner's decision. `resolution` is limited to `RECONCILIATION_RESOLUTIONS`,
 * which leaves out the outcome resolutions (`sold_recorded`, …): only an
 * assignee's finished outcome writes those.
 */
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

/**
 * Hand a row to a Producer or CSR (`userId`), or take it back (`null`).
 * Ids are lower-cased: rows store them as strings and compare them exactly.
 */
export const assignRowSchema = z.object({
  userId: objectId.transform((value) => value.toLowerCase()).nullable(),
  note: z
    .string()
    .trim()
    .max(MAX_RECONCILIATION_ASSIGNMENT_NOTE_LENGTH)
    .nullable()
    .optional(),
});
export type AssignRowDto = z.infer<typeof assignRowSchema>;

/**
 * What the assignee records on their row (PAC-173 PR 4). `other` is the note
 * itself, so it needs one; a sale kind may carry one for the owner.
 */
export const recordOutcomeSchema = z
  .object({
    kind: z.enum(RECONCILIATION_OUTCOME_KINDS),
    note: z
      .string()
      .trim()
      .max(MAX_RECONCILIATION_OUTCOME_NOTE_LENGTH)
      .nullable()
      .optional(),
  })
  .superRefine((body, ctx) => {
    if (body.kind === 'other' && !body.note) {
      ctx.addIssue({
        code: 'custom',
        path: ['note'],
        message: 'say what became of it',
      });
    }
  });
export type RecordOutcomeDto = z.infer<typeof recordOutcomeSchema>;

/** The assignee's list: their own rows, or — with `:read` — someone else's. */
export const assignedQuerySchema = z.object({
  userId: objectId.transform((value) => value.toLowerCase()).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type AssignedQueryDto = z.infer<typeof assignedQuerySchema>;

export const exportQuerySchema = z.object({
  format: z.enum(DATA_EXPORT_FORMATS).default('xlsx'),
  /** One tab; omitted means every exception tab. */
  tab: z.enum(RECONCILIATION_TABS).optional(),
});
export type ExportQueryDto = z.infer<typeof exportQuerySchema>;
