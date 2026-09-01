import type {
  BugReportStatus,
  BugSeverity,
  BugScreenshotContentType,
} from '@sfa/shared';
import {
  ALLOWED_BUG_SCREENSHOT_CONTENT_TYPES,
  BUG_REPORT_STATUSES,
  BUG_SEVERITIES,
} from '@sfa/shared';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type BugReportDocument = HydratedDocument<BugReport>;

/** One uploaded screenshot. Keeps its own `_id`, which is the client-facing id. */
@Schema()
export class BugReportScreenshotSubdoc {
  /** Object-storage key. **Never** serialized to a client — see the schema note. */
  @Prop({ required: true, trim: true })
  key: string;

  @Prop({ required: true, trim: true })
  filename: string;

  /**
   * As reported by `HeadObject`, not as declared by the browser.
   *
   * A presigned PUT signs only `Content-Type`, so a caller holding a valid URL
   * can upload anything of any size; the declared values would record the
   * client's claim rather than the object.
   */
  @Prop({
    required: true,
    type: String,
    enum: ALLOWED_BUG_SCREENSHOT_CONTENT_TYPES,
  })
  contentType: BugScreenshotContentType;

  @Prop({ required: true })
  size: number;

  @Prop({ type: Date, default: Date.now })
  uploadedAt: Date;

  _id?: Types.ObjectId;
}

export const BugReportScreenshotSchema = SchemaFactory.createForClass(
  BugReportScreenshotSubdoc,
);

/** Browser context captured at submit time. Displayed only, never trusted. */
@Schema({ _id: false })
export class BugReportContextSubdoc {
  @Prop({ trim: true })
  url?: string;

  @Prop({ trim: true })
  route?: string;

  @Prop({ trim: true })
  userAgent?: string;

  @Prop({ type: Object })
  viewport?: { width: number; height: number };

  @Prop({ trim: true })
  theme?: string;
}

export const BugReportContextSchema = SchemaFactory.createForClass(
  BugReportContextSubdoc,
);

/**
 * An in-app bug report.
 *
 * ## Why this does not extend `TenantRecord`
 *
 * `TenantRecord` requires both `agencyId` and `branchId`. A platform operator
 * has neither and is exactly the kind of person who hits a bug in the Super
 * Admin panel, so requiring them would make the widget unusable on the one
 * surface its authors use most. Here they are **context** — which tenant was
 * this person in when it broke — and nullable.
 *
 * The consequence to keep in mind: nothing about this collection is
 * tenant-isolated, and `authorshipPlugin` does not stamp it (it keys off the
 * `createdBy`/`updatedBy` paths `TenantRecord` declares). The reporter is
 * recorded explicitly in {@link reportedBy} instead, at the one place that
 * writes a report.
 */
@Schema({ timestamps: true, collection: 'bugReports' })
export class BugReport {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  reportedBy: Types.ObjectId;

  /**
   * The reporter's email and name at the time of filing.
   *
   * Denormalized on purpose. The queue has to stay readable after a user is
   * deactivated and removed from an agency, and a report whose author renders
   * as a dangling ObjectId is a report nobody can follow up on.
   */
  @Prop({ required: true, trim: true, lowercase: true })
  reporterEmail: string;

  /**
   * `type: String` is required, like every other nullable field here: a
   * `string | null` union reflects as `Object` and `@nestjs/mongoose` throws
   * `CannotDetermineTypeError` **at boot**, not at first write.
   */
  @Prop({ type: String, trim: true, default: null })
  reporterName: string | null;

  /** Null for a platform operator, who has no agency of their own. */
  @Prop({ type: Types.ObjectId, ref: 'Agency', default: null, index: true })
  agencyId: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'Branch', default: null })
  branchId: Types.ObjectId | null;

  @Prop({ required: true, trim: true })
  description: string;

  @Prop({
    required: true,
    type: String,
    enum: BUG_SEVERITIES,
    default: 'normal',
  })
  severity: BugSeverity;

  @Prop({ type: [BugReportScreenshotSchema], default: [] })
  screenshots: BugReportScreenshotSubdoc[];

  @Prop({ type: BugReportContextSchema, default: {} })
  context: BugReportContextSubdoc;

  @Prop({
    required: true,
    type: String,
    enum: BUG_REPORT_STATUSES,
    default: 'new',
    index: true,
  })
  status: BugReportStatus;

  /** Platform-side triage notes. Never shown to the reporter. */
  @Prop({ type: String, trim: true, default: null })
  internalNotes: string | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  statusUpdatedBy: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  statusUpdatedAt: Date | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export const BugReportSchema = SchemaFactory.createForClass(BugReport);

/** Backs the queue's default read: open reports, newest first. */
BugReportSchema.index({ status: 1, createdAt: -1 });

/** Backs the per-agency filter, and the "what has this tenant reported" question. */
BugReportSchema.index({ agencyId: 1, createdAt: -1 });

/**
 * Full-text search over the description for the queue's search box.
 *
 * A text index rather than a regex scan: the queue is cross-tenant and grows
 * without bound, and `$regex` over an unindexed string field is a collection
 * scan on every keystroke.
 */
BugReportSchema.index({ description: 'text' });
