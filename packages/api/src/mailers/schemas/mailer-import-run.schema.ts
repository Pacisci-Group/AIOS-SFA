import type {
  MailerImportDetected,
  MailerImportRejection,
  MailerImportRunStatus,
} from '@sfa/shared';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type MailerImportRunDocument = HydratedDocument<MailerImportRun>;

/** Row tallies. See `MailerImportCounts` in `@sfa/shared`. */
@Schema({ _id: false })
export class MailerImportRunCounts {
  @Prop({ default: 0 }) read: number;
  @Prop({ default: 0 }) mapped: number;
  @Prop({ default: 0 }) created: number;
  @Prop({ default: 0 }) updated: number;
  @Prop({ default: 0 }) skipped: number;
}
export const MailerImportRunCountsSchema = SchemaFactory.createForClass(
  MailerImportRunCounts,
);

/**
 * A record of one **import run** — not a campaign (PAC-73).
 *
 * ⚠ This is deliberately a run log and must stay one. `mailerCampaigns` — the
 * first-class campaign entity, its history, and append-vs-overwrite semantics —
 * is PAC-71's to design, and extending this into it would produce a campaign
 * model derived from whatever the uploader happened to need. When PAC-71 lands
 * and Add Mailers is deleted, this collection is what tells you what the
 * interim uploads did.
 *
 * ## Why it exists at all
 *
 * The import runs as an Inngest job rather than inside the request, so the
 * operator's browser needs something to poll and the report needs somewhere to
 * live once the request that started it is long gone. It is also the gate for
 * the agency cross-check: `agencyMismatch` is written during the preview parse
 * and read by the commit endpoint, so the confirmation cannot be bypassed by a
 * client that simply omits it.
 */
@Schema({ timestamps: true, collection: 'mailerImportRuns' })
export class MailerImportRun {
  @Prop({ required: true, index: true })
  agencyId: string;

  /** Object-storage key of the raw upload. Retained after the run. */
  @Prop({ required: true, trim: true })
  storageKey: string;

  /** The name the operator's browser sent. */
  @Prop({ required: true, trim: true })
  uploadedFilename: string;

  @Prop({ trim: true })
  contentType?: string;

  /**
   * Size as reported by `HeadObject`, not as declared by the client.
   *
   * A presigned PUT signs only `Content-Type`, so a caller holding a valid URL
   * can upload a file of any size; the declared value would validate the
   * client's claim rather than the object.
   */
  @Prop({ default: 0 })
  sizeBytes: number;

  /** `type: String` is required: a union reflects as `Object` and throws. */
  @Prop({
    required: true,
    type: String,
    default: 'previewing',
    enum: ['previewing', 'previewed', 'importing', 'completed', 'failed'],
    index: true,
  })
  status: MailerImportRunStatus;

  /** What the file said about itself. Written by the preview parse. */
  @Prop({ type: Object })
  detected?: MailerImportDetected;

  /**
   * The file's own `agencyid` disagrees with the agency the operator chose.
   *
   * Committing anyway requires an explicit confirmation — filing one agency's
   * prospects under another is the failure that matters here.
   */
  @Prop({ default: false })
  agencyMismatch: boolean;

  /** Set when the operator confirmed a mismatched commit, so it is auditable. */
  @Prop({ default: false })
  mismatchConfirmed: boolean;

  @Prop({ type: MailerImportRunCountsSchema })
  counts?: MailerImportRunCounts;

  /**
   * A capped sample — `counts.skipped` is the authoritative total.
   *
   * A file can in principle reject every row, and 20,405 rejection objects
   * belong neither in a document nor in a response.
   */
  @Prop({ type: [Object], default: [] })
  rejections: MailerImportRejection[];

  /** Present only when `status` is `failed`. */
  @Prop({ trim: true })
  error?: string;

  /** User id of the operator who started the run. */
  @Prop({ required: true, trim: true })
  requestedBy: string;

  @Prop({ type: Date })
  finishedAt?: Date;

  createdAt?: Date;
  updatedAt?: Date;
}

export const MailerImportRunSchema =
  SchemaFactory.createForClass(MailerImportRun);

/** Backs the panel's "recent imports" read, newest first. */
MailerImportRunSchema.index({ agencyId: 1, createdAt: -1 });
