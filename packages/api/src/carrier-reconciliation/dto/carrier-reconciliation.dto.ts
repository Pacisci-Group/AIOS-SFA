import {
  DATA_EXPORT_FORMATS,
  MAX_POLICY_ITEM_COUNT,
  MAX_RECONCILIATION_DOCUMENT_BYTES,
  POLICY_TYPES,
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
import { ymd } from '../../common/dto/business-date.dto';
import {
  intakeAddressSchema,
  intakeMemberSchema,
  intakePersonSchema,
} from '../../leads/dto/create-lead.dto';
import {
  OTHER_NEEDS_NOTE,
  cancelPolicyFields,
  cancellationNote,
  otherHasNote,
} from '../../policies/dto/cancel-policy.dto';

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

/**
 * `POST assigned/:rowId/documents/presign` — the signed application a 1-800
 * service intake attaches (PAC-173 PR 5). PDF only, as for every new business
 * application.
 */
export const presignRowDocumentSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  contentType: z.literal('application/pdf', {
    error: 'The new business application must be a PDF.',
  }),
  size: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_RECONCILIATION_DOCUMENT_BYTES, 'A document is larger than 10MB.'),
});
export type PresignRowDocumentDto = z.infer<typeof presignRowDocumentSchema>;

/**
 * `POST assigned/:rowId/service-intake` — a 1-800 row set up for service. The
 * client is captured as a lead's household is (the lead DTO's own shapes: DOB,
 * phone and email required on the primary), or pinned to an existing
 * household; the policy's carrier is the run's, never the client's to say.
 */
export const serviceIntakeSchema = z.object({
  householdId: objectId.nullable().optional(),
  primaryContact: intakePersonSchema,
  address: intakeAddressSchema.optional(),
  members: z.array(intakeMemberSchema).max(10).default([]),
  policy: z.object({
    policyNumber: z.string().trim().min(1, 'Enter the policy number').max(60),
    policyType: z.enum(POLICY_TYPES),
    premium: z.coerce
      .number()
      .nonnegative('Premium must be 0 or greater')
      .max(1_000_000, 'Too large'),
    itemCount: z.coerce
      .number()
      .int('Whole numbers only')
      .min(1, 'At least 1 item')
      .max(MAX_POLICY_ITEM_COUNT, 'Too many'),
    effectiveDate: ymd,
    newBusinessApplication: z.object({
      key: z.string().trim().min(1).max(512),
      filename: z.string().trim().min(1).max(255),
      contentType: z.string().trim().min(1).max(120),
      size: z.coerce.number().int().nonnegative(),
    }),
  }),
  assignedCsrId: objectId.transform((value) => value.toLowerCase()),
  openingNote: z
    .string()
    .trim()
    .max(MAX_RECONCILIATION_OUTCOME_NOTE_LENGTH)
    .nullable()
    .optional(),
});
export type ServiceIntakeDto = z.infer<typeof serviceIntakeSchema>;

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

/**
 * `POST assigned/:rowId/cancel-policy` — a Chargeback outcome's second step
 * (PAC-173 PR 6): the household page's Cancel dialog, asked the same — the
 * reason, with free text for `other` — plus **the carrier's** cancellation
 * date, which a chargeback always needs: it decides the one-month clawback
 * window.
 */
export const cancelRowPolicySchema = cancelPolicyFields
  .extend({ cancelledOn: ymd })
  .refine(otherHasNote, OTHER_NEEDS_NOTE)
  .transform((value) => ({
    reason: value.reason,
    note: cancellationNote(value),
    cancelledOn: value.cancelledOn,
  }));
export type CancelRowPolicyDto = z.infer<typeof cancelRowPolicySchema>;
