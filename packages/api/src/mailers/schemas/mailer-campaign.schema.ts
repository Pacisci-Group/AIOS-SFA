import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type {
  MailerAssignmentMode,
  MailerCampaignImportCounts,
  MailerCampaignPreview,
  MailerCampaignSource,
  MailerCampaignStats,
  MailerCampaignStatus,
  MailerCommitMode,
  MailerDiscountRules,
  MailerImportRejection,
} from '@sfa/shared';
import { HydratedDocument, Types } from 'mongoose';
import { ObjectIdType } from '../../common/mongo/object-id';

export type MailerCampaignDocument = HydratedDocument<MailerCampaign>;

/**
 * The audience rule, stored rather than expanded (PAC-71).
 *
 * `mode: 'all'` must never be flattened into a list of agency ids: it means
 * "every agency, **including ones onboarded later**", and an expanded list
 * silently stops meaning that the day the next tenant is created.
 */
@Schema({ _id: false })
export class MailerCampaignAssignmentDoc {
  /** ⚠ `type: String` — a union reflects as `Object` and throws at construction. */
  @Prop({
    required: true,
    type: String,
    enum: ['carrier_agency_id', 'agencies', 'all'],
  })
  mode: MailerAssignmentMode;

  /** Meaningful only for `agencies`; empty in the other two modes. */
  @Prop({ type: [String], default: [] })
  agencyIds: string[];
}
export const MailerCampaignAssignmentDocSchema = SchemaFactory.createForClass(
  MailerCampaignAssignmentDoc,
);

/**
 * The settings snapshot the run actually used.
 *
 * ⚠ **This is what makes a campaign reproducible.** The previous run's values
 * only *prefill* the next one; a rule edited afterwards must not retroactively
 * change what a completed run means. There is deliberately no settings
 * collection to fall back to.
 *
 * ⚠ `minimize: false` is load-bearing. Mongoose's default **strips empty
 * objects on save**, so a run with no ZIP fixes stored `settings` with no
 * `zipResolutions` key at all — and `MailerCampaignSettings` declares it
 * required, so every reader that trusted the type got `undefined` where it
 * expected `{}`. That is a crash on the campaign detail page rather than a
 * missing row, because the failure is a broken contract and not absent data.
 */
@Schema({ _id: false, minimize: false })
export class MailerCampaignSettingsDoc {
  @Prop({ required: true, min: 0 })
  premiumFloor: number;

  @Prop({ required: true, trim: true })
  fileName: string;

  @Prop({ required: true, trim: true })
  defaultMarket: string;

  /** Market → local-presence phone. Free-form keys, so `type: Object`. */
  @Prop({ type: Object, default: {} })
  marketPhones: Record<string, string>;

  @Prop({ required: true, trim: true })
  defaultPhone: string;

  /**
   * ⚠ The year the run priced against, not "now". The home-age discount reads
   * it, so a re-run of a past campaign carrying today's year ages every home.
   */
  @Prop({ required: true })
  runYear: number;

  @Prop({ type: Object, required: true })
  discounts: MailerDiscountRules;

  /** ZIP → market fixes made in the preview. Also written back to the table. */
  @Prop({ type: Object, default: {} })
  zipResolutions: Record<string, string>;

  @Prop({ type: [String], default: [] })
  outputRecipients: string[];
}
export const MailerCampaignSettingsDocSchema = SchemaFactory.createForClass(
  MailerCampaignSettingsDoc,
);

/** A file held in object storage. The key never leaves the server. */
@Schema({ _id: false })
export class MailerCampaignFileDoc {
  /**
   * ⚠ A capability, not an identifier. It must never reach a DTO — the download
   * endpoint mints a short-lived presigned URL on click instead.
   */
  @Prop({ required: true, trim: true })
  storageKey: string;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true })
  size: number;

  @Prop({ trim: true })
  sha256?: string;

  @Prop({ trim: true })
  contentType?: string;
}
export const MailerCampaignFileDocSchema = SchemaFactory.createForClass(
  MailerCampaignFileDoc,
);

/**
 * One run of a mail campaign (PAC-71).
 *
 * ## Why this does not extend `TenantRecord`
 *
 * `TenantRecord` requires both `agencyId` and `branchId`, and a campaign has
 * neither: it is a platform-level operation that can serve many agencies at
 * once, or all of them. `Carrier` is the precedent — a plain, non-tenant
 * collection whose audience is expressed in its own fields.
 *
 * ## Statuses are a gate, not a label
 *
 * `PATCH` and re-preview are only legal in `uploaded | previewed | failed`;
 * `commit` only from `previewed`, and it moves the record to `processing`
 * through a **compare-and-set** so two operators cannot both start one. The
 * `previewAttempt` / `commitAttempt` counters are what let a worker recognise
 * its own dispatch and no-op on a stale one — the alternative is a retried job
 * overwriting a newer preview with an older one's results.
 *
 * ## What the preview is for
 *
 * `preview` is stored, not merely returned, because commit re-verifies against
 * it: the delete count an overwrite states, the assignment resolution, and the
 * set of campaigns being replaced are all checked against the numbers the
 * operator actually saw. A count that moved in between is a 409 they must look
 * at, never a silent proceed.
 */
@Schema({ timestamps: true, collection: 'mailerCampaigns' })
export class MailerCampaign {
  /**
   * The carrier whose quote file this is — Allstate for every file seen so far.
   *
   * It scopes the `carrier_agency_id` assignment lookup (a code only means
   * anything inside its own carrier, PAC-93) and, later, per-carrier column
   * contracts.
   */
  @Prop({ type: ObjectIdType, ref: 'Carrier', required: true, index: true })
  carrierId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name: string;

  /** Normalized `Week_Number-NN`. Kept for the print file and legacy joins. */
  @Prop({ trim: true })
  campaignNumber?: string;

  /** Derived from {@link campaignNumber}. Null when it carries no number. */
  @Prop({ type: Number, default: null })
  weekNumber: number | null;

  /** From the settings' `runYear`, or the file's `quotedate`. */
  @Prop({ type: Number, default: null })
  year: number | null;

  /** ⚠ `type: String` — see the note on `MailerSource.system`. */
  @Prop({
    required: true,
    type: String,
    index: true,
    enum: [
      'uploaded',
      'previewed',
      'processing',
      'imported',
      'failed',
      'superseded',
    ],
  })
  status: MailerCampaignStatus;

  @Prop({
    required: true,
    type: String,
    enum: ['vendor', 'processed', 'migration', 'demo'],
  })
  source: MailerCampaignSource;

  @Prop({ type: MailerCampaignAssignmentDocSchema, required: true })
  assignment: MailerCampaignAssignmentDoc;

  /** Distinct `agencyid` values seen in the file. Provenance in every mode. */
  @Prop({ type: [String], default: [] })
  carrierAgencyIds: string[];

  /** Distinct `agencyname` values, for display beside the codes. */
  @Prop({ type: [String], default: [] })
  carrierAgencyNames: string[];

  /** `null` on a `processed` campaign — nothing was transformed. */
  @Prop({ type: MailerCampaignSettingsDocSchema, default: null })
  settings: MailerCampaignSettingsDoc | null;

  @Prop({ type: MailerCampaignFileDocSchema, default: null })
  vendorFile: MailerCampaignFileDoc | null;

  /** The 132-column print CSV. Same object as the vendor file on `processed`. */
  @Prop({ type: MailerCampaignFileDocSchema, default: null })
  outputFile: MailerCampaignFileDoc | null;

  @Prop({ type: Object, default: null })
  stats: MailerCampaignStats | null;

  /**
   * `type: Object` on purpose: the preview is a deep, evolving report read as a
   * whole and never queried into. A sub-schema per nested shape would be five
   * classes that buy nothing.
   */
  @Prop({ type: Object, default: null })
  preview: MailerCampaignPreview | null;

  @Prop({ type: Object, default: null })
  importCounts: MailerCampaignImportCounts | null;

  /** A capped sample. `importCounts.skipped` is the authoritative total. */
  @Prop({ type: [Object], default: [] })
  rejections: MailerImportRejection[];

  @Prop({ type: String, default: null, enum: ['append', 'overwrite', null] })
  commitMode: MailerCommitMode | null;

  /** Overwrite only: the campaigns this run replaces. */
  @Prop({ type: [String], default: [] })
  replaceCampaignIds: string[];

  /** The delete count the operator confirmed. Re-asserted in the delete step. */
  @Prop({ type: Number, default: null })
  expectedDeleteCount: number | null;

  /**
   * Bumped on every preview dispatch, and carried in the event.
   *
   * A worker whose `attempt` no longer matches is looking at a superseded
   * dispatch and no-ops. Without it, a retried preview can land after a newer
   * one and overwrite its result with stale numbers the operator then commits
   * against.
   */
  @Prop({ default: 0 })
  previewAttempt: number;

  /** Same contract as {@link previewAttempt}, for the commit chain. */
  @Prop({ default: 0 })
  commitAttempt: number;

  /** Present only when `status` is `failed`. */
  @Prop({ type: String, default: null })
  error: string | null;

  /** Null on an implicit campaign — nobody requested those. */
  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  requestedBy: Types.ObjectId | null;

  /** Minimum `quotedate` across the file. */
  @Prop({ type: Date, default: null })
  quoteDate: Date | null;

  @Prop({ type: Date, default: null })
  finishedAt: Date | null;

  /** Set on the campaign an overwrite replaced, alongside `superseded`. */
  @Prop({ type: String, default: null })
  supersededByCampaignId: string | null;

  /**
   * Marker for rows written by something other than a real run.
   *
   * The demo seed writes `demo:seed` and purges on it — the same exception
   * `Mailer` and `ProducerGoal` already make, for the same reason: no
   * `legacySmartSuiteId` to key the usual `demo:*` purge on.
   */
  @Prop({ trim: true })
  recordSource?: string;

  /**
   * Dedupe key for the **implicit** campaigns the migration and the demo seed
   * mint: `` `${agencyId}|${weekNumber}|${year}` ``.
   *
   * Absent on every campaign created through the API, which is why the index
   * below is partial rather than plain-unique.
   */
  @Prop({ trim: true })
  migrationKey?: string;

  createdAt?: Date;
  updatedAt?: Date;
}

export const MailerCampaignSchema =
  SchemaFactory.createForClass(MailerCampaign);

/**
 * The campaign-exists check: "has this week's file already been run?"
 *
 * Platform-wide with the carrier as the only extra key — the same vendor file
 * for the same week is one campaign no matter which agencies it routes to. The
 * status is in the key because only `imported` and `processing` campaigns count
 * as existing; an abandoned `uploaded` one is not a conflict.
 */
MailerCampaignSchema.index({
  carrierId: 1,
  campaignNumber: 1,
  year: 1,
  status: 1,
});

/** The list's default read: filter by status, newest first. */
MailerCampaignSchema.index({ status: 1, createdAt: -1 });

/** The list filtered by agency, in `agencies` mode. */
MailerCampaignSchema.index({ 'assignment.agencyIds': 1, createdAt: -1 });

/**
 * One implicit campaign per `(agency, week, year)`.
 *
 * `partialFilterExpression`, never `sparse` — every API-created campaign has no
 * `migrationKey`, and without the filter they would all collide on `null`. Same
 * trap documented on `LEGACY_DEDUPE_INDEX_OPTIONS`.
 *
 * Exported so the backfill can build a byte-identical spec; a drifted copy
 * would make `autoIndex` throw `IndexOptionsConflict` at the next boot.
 */
export const MAILER_CAMPAIGN_MIGRATION_INDEX_KEY = { migrationKey: 1 } as const;
export const MAILER_CAMPAIGN_MIGRATION_INDEX_OPTIONS = {
  unique: true,
  partialFilterExpression: { migrationKey: { $type: 'string' } },
} as const;

MailerCampaignSchema.index(
  MAILER_CAMPAIGN_MIGRATION_INDEX_KEY,
  MAILER_CAMPAIGN_MIGRATION_INDEX_OPTIONS,
);
