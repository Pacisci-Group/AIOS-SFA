import { z } from 'zod';
import {
  ALLOWED_MAILER_CONTENT_TYPES,
  MAX_MAILER_FILE_BYTES,
} from '../../common/mailers/mailer-file-types';

/**
 * Request shapes for the mailer campaign API (PAC-71).
 *
 * Same style as the Add Mailers DTO this replaces: zod schemas fed to
 * `ZodValidationPipe`, with the inferred type as the single source of truth for
 * the parsed body.
 *
 * ⚠ Unlike the *event* schemas in `inngest/events/`, transforms and defaults are
 * welcome here. A DTO is parsed once at the edge; an event is JSON on the wire
 * that both sides must agree on, which is why `eventType` rejects any schema
 * whose input and output types differ.
 */

const objectId = z
  .string()
  .trim()
  .regex(/^[0-9a-f]{24}$/, 'expected a 24-hex ObjectId');

const zip5Key = z.string().regex(/^\d{5}$/, 'ZIP keys must be 5 digits');

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

/**
 * `POST /platform/mailer-campaigns/presign`.
 *
 * `contentType` is accepted but **not** what the URL is signed with — see
 * `canonicalMailerContentType`. The browser reports wildly different types for
 * the same `.csv` and frequently the empty string, so the signature is derived
 * from the extension and echoed back in `requiredHeaders`.
 */
export const presignCampaignFileSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  contentType: z.enum(ALLOWED_MAILER_CONTENT_TYPES).optional(),
  size: z.coerce.number().int().positive().max(MAX_MAILER_FILE_BYTES),
});
export type PresignCampaignFileDto = z.infer<typeof presignCampaignFileSchema>;

// ---------------------------------------------------------------------------
// Assignment
// ---------------------------------------------------------------------------

/**
 * Who the rows are visible to.
 *
 * A discriminated union rather than `{mode, agencyIds}` with a runtime check:
 * `agencies` is the only mode where the list means anything, and it is the only
 * mode where an *empty* list is a mistake rather than the norm. Expressed in
 * the type, that is a `400` naming the field instead of a campaign that
 * silently reaches nobody.
 */
export const assignmentSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('carrier_agency_id'),
    agencyIds: z.array(objectId).max(0).default([]),
  }),
  z.object({
    mode: z.literal('agencies'),
    agencyIds: z.array(objectId).min(1).max(200),
  }),
  z.object({
    mode: z.literal('all'),
    agencyIds: z.array(objectId).max(0).default([]),
  }),
]);
export type AssignmentDto = z.infer<typeof assignmentSchema>;

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const discountRulesSchema = z.object({
  squareFootage: z
    .array(
      z.object({
        minSquareFeet: z.coerce.number().int().min(0).max(100_000),
        /** A fraction, not a percentage: `0.44`, never `44`. */
        rate: z.coerce.number().min(0).max(1),
      }),
    )
    .min(1)
    .max(20),
  homeAge: z.object({
    maxNewYears: z.coerce.number().int().min(0).max(200),
    newRate: z.coerce.number().min(0).max(1),
    oldRate: z.coerce.number().min(0).max(1),
  }),
});

/**
 * The settings snapshot the run is performed with, and stored against.
 *
 * Every transform field is **required**, with no defaults. A defaulted
 * `premiumFloor` of 0 would be a run with no floor at all, priced from the
 * discount table alone — and since ~95% of rows normally land on the floor,
 * that is 20,000 mail pieces carrying the wrong offer, with nothing about the
 * request to say so. The `defaults` endpoint exists precisely so the client
 * always has real values to send.
 *
 * ⚠ On a `processed` campaign the transform fields are inert — nothing is
 * transformed, so nothing reads them. They are still stored, because the wizard
 * prefills them and a stored value is easier to explain than a half-empty
 * record. `stats: null` is what says the transform did not run.
 */
export const campaignSettingsSchema = z.object({
  premiumFloor: z.coerce.number().min(0).max(1_000_000),
  fileName: z.string().trim().min(1).max(120),
  defaultMarket: z.string().trim().min(1).max(60),
  marketPhones: z.record(z.string().trim().max(60), z.string().trim().max(40)),
  defaultPhone: z.string().trim().min(1).max(40),
  /**
   * ⚠ The year the run prices against, not "now". The home-age discount reads
   * it, so re-running a past campaign with today's year ages every home.
   */
  runYear: z.coerce.number().int().min(2000).max(2100),
  discounts: discountRulesSchema,
  zipResolutions: z.record(zip5Key, z.string().trim().min(1).max(60)),
  outputRecipients: z.array(z.email()).max(20),
});
export type CampaignSettingsDto = z.infer<typeof campaignSettingsSchema>;

// ---------------------------------------------------------------------------
// Create / update
// ---------------------------------------------------------------------------

export const createCampaignSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  /** Defaults to the global Allstate carrier when omitted. */
  carrierId: objectId.optional(),
  /**
   * `vendor` runs the transform; `processed` imports the file as it stands —
   * the old Add Mailers flow, kept as the recovery path.
   */
  source: z.enum(['vendor', 'processed']),
  /** The key `presign` returned. Ownership is re-checked server-side. */
  storageKey: z.string().trim().min(1).max(512),
  uploadedFilename: z.string().trim().min(1).max(255),
  size: z.coerce.number().int().positive().max(MAX_MAILER_FILE_BYTES),
  contentType: z.enum(ALLOWED_MAILER_CONTENT_TYPES).optional(),
  /** `Week_Number-NN`; normalized server-side. Defaults to the current week. */
  campaignNumber: z.string().trim().max(40).optional(),
  assignment: assignmentSchema,
  settings: campaignSettingsSchema,
});
export type CreateCampaignDto = z.infer<typeof createCampaignSchema>;

/**
 * What may still be changed before a commit.
 *
 * Deliberately **not** `source` or the uploaded file: those describe the object
 * in storage, and changing either would leave the campaign describing a file it
 * no longer points at. A different file is a different campaign.
 */
export const updateCampaignSchema = createCampaignSchema
  .pick({
    name: true,
    carrierId: true,
    campaignNumber: true,
    assignment: true,
    settings: true,
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'Nothing to update.',
  });
export type UpdateCampaignDto = z.infer<typeof updateCampaignSchema>;

// ---------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------

/**
 * `POST /platform/mailer-campaigns/:id/commit`.
 *
 * `expectedDeleteCount` is the operator's acknowledgement of the number the
 * preview showed them, echoed back rather than recomputed. If the real count
 * moved in between — another campaign committed, someone deleted rows — the
 * server answers `409` with the fresh number instead of deleting a quantity
 * nobody agreed to.
 */
export const commitCampaignSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('append') }),
  z.object({
    mode: z.literal('overwrite'),
    /** Must be a subset of what the preview reported. */
    replaceCampaignIds: z.array(objectId).min(1).max(50),
    expectedDeleteCount: z.coerce.number().int().min(0),
  }),
]);
export type CommitCampaignDto = z.infer<typeof commitCampaignSchema>;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export const listCampaignsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  /** Free text over the campaign name and its `Week_Number-NN`. */
  q: z.string().trim().max(120).optional(),
  status: z
    .enum([
      'uploaded',
      'previewed',
      'processing',
      'imported',
      'failed',
      'superseded',
    ])
    .optional(),
  /** Campaigns explicitly assigned to this agency. `all` campaigns match too. */
  agencyId: objectId.optional(),
  carrierId: objectId.optional(),
});
export type ListCampaignsDto = z.infer<typeof listCampaignsSchema>;

export const campaignRecordsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  /** Either printed control-number form, or a name prefix. */
  q: z.string().trim().max(120).optional(),
});
export type CampaignRecordsDto = z.infer<typeof campaignRecordsSchema>;

/**
 * `POST /platform/mailer-campaigns/:id/email` — resend the completion notice.
 *
 * Recipients default to the campaign's stored `outputRecipients`, so the common
 * case is an empty body.
 */
export const emailOutputSchema = z.object({
  recipients: z.array(z.email()).min(1).max(20).optional(),
});
export type EmailOutputDto = z.infer<typeof emailOutputSchema>;
