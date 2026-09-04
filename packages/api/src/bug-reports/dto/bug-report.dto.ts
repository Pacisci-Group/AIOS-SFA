import {
  ALLOWED_BUG_SCREENSHOT_CONTENT_TYPES,
  BUG_REPORT_STATUSES,
  BUG_SEVERITIES,
  MAX_BUG_DESCRIPTION_LENGTH,
  MAX_BUG_INTERNAL_NOTES_LENGTH,
  MAX_BUG_SCREENSHOTS,
  MAX_BUG_SCREENSHOT_BYTES,
  MIN_BUG_DESCRIPTION_LENGTH,
} from '@sfa/shared';
import { z } from 'zod';

/** 24-character hex Mongo ObjectId. */
const objectId = z
  .string()
  .trim()
  .regex(/^[0-9a-f]{24}$/, 'expected a 24-hex ObjectId');

/**
 * `POST /bug-reports/screenshots/presign`.
 *
 * `contentType` is narrow here — unlike the mailer CSV rule, which has to
 * tolerate whatever the OS claims about a `.csv`. Every source of a screenshot
 * (a file picker, a drag, a clipboard paste) reports a real `image/*` type, so
 * widening this would only let non-images through.
 */
export const presignBugScreenshotSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  contentType: z.enum(ALLOWED_BUG_SCREENSHOT_CONTENT_TYPES),
  size: z.coerce.number().int().positive().max(MAX_BUG_SCREENSHOT_BYTES),
});
export type PresignBugScreenshotDto = z.infer<
  typeof presignBugScreenshotSchema
>;

/**
 * Metadata for an already-uploaded screenshot.
 *
 * `contentType` and `size` are validated as a fast mirror of the client check,
 * but they are **not** what gets stored — the service re-reads both from
 * `HeadObject`, because a declared size proves nothing about the stored object.
 */
const bugScreenshotSchema = z.object({
  key: z.string().trim().min(1).max(512),
  filename: z.string().trim().min(1).max(255),
  contentType: z.enum(ALLOWED_BUG_SCREENSHOT_CONTENT_TYPES),
  size: z.coerce.number().int().positive().max(MAX_BUG_SCREENSHOT_BYTES),
});

/**
 * The captured browser context.
 *
 * Every field is optional and every field is `.catch`-free on purpose: this is
 * a best-effort snapshot, and a report must never be rejected because a browser
 * would not tell us its viewport. Length caps are there because a `userAgent`
 * is client-controlled text that goes straight into a document.
 */
const bugContextSchema = z.object({
  url: z.string().trim().max(2_048).optional(),
  route: z.string().trim().max(512).optional(),
  userAgent: z.string().trim().max(512).optional(),
  viewport: z
    .object({
      width: z.coerce.number().int().nonnegative().max(100_000),
      height: z.coerce.number().int().nonnegative().max(100_000),
    })
    .optional(),
  theme: z.string().trim().max(32).optional(),
});

/** `POST /bug-reports` — what the widget submits. */
export const createBugReportSchema = z.object({
  description: z
    .string()
    .trim()
    .min(
      MIN_BUG_DESCRIPTION_LENGTH,
      `Please describe the problem in at least ${MIN_BUG_DESCRIPTION_LENGTH} characters.`,
    )
    .max(MAX_BUG_DESCRIPTION_LENGTH),
  severity: z.enum(BUG_SEVERITIES).default('normal'),
  /** Keys returned by presign. Ownership is re-checked server-side. */
  screenshots: z
    .array(bugScreenshotSchema)
    .max(MAX_BUG_SCREENSHOTS)
    .default([]),
  context: bugContextSchema.default({}),
});
export type CreateBugReportDto = z.infer<typeof createBugReportSchema>;

/**
 * `GET /platform/bug-reports` — the queue's filters.
 *
 * `status` accepts a comma-separated list so the default view ("everything
 * still open") is one request rather than three.
 */
export const listBugReportsSchema = z.object({
  status: z
    .string()
    .trim()
    .optional()
    .transform((value) =>
      value
        ? value
            .split(',')
            .map((part) => part.trim())
            .filter(Boolean)
        : undefined,
    )
    .pipe(z.array(z.enum(BUG_REPORT_STATUSES)).min(1).optional()),
  severity: z.enum(BUG_SEVERITIES).optional(),
  agencyId: objectId.optional(),
  /** Free text, matched against the description via the text index. */
  search: z.string().trim().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  skip: z.coerce.number().int().min(0).default(0),
});
export type ListBugReportsDto = z.infer<typeof listBugReportsSchema>;

/**
 * `PATCH /platform/bug-reports/:id` — triage.
 *
 * Both fields optional, at least one required: a PATCH that says nothing is a
 * client bug, and silently returning the unchanged record hides it.
 * `internalNotes` accepts an empty string, which clears the note — distinct
 * from omitting the field, which leaves it alone.
 */
export const updateBugReportSchema = z
  .object({
    status: z.enum(BUG_REPORT_STATUSES).optional(),
    internalNotes: z
      .string()
      .trim()
      .max(MAX_BUG_INTERNAL_NOTES_LENGTH)
      .optional(),
  })
  .refine(
    (body) => body.status !== undefined || body.internalNotes !== undefined,
    { message: 'Provide a status or internal notes to update.' },
  );
export type UpdateBugReportDto = z.infer<typeof updateBugReportSchema>;
