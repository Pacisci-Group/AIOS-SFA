import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  LEGACY_DEDUPE_INDEX_OPTIONS,
  TenantRecord,
} from '../../common/schemas/tenant-record.schema';
import type { ActivitySubjectType, ActivityType } from '@sfa/shared';

export type ActivityDocument = HydratedDocument<Activity>;

// The unions moved to `@sfa/shared` (PAC-38): the Lead Detail timeline renders
// one icon and tone per type, and the web app cannot import from the API.
// Re-exported so existing API-side importers keep working.
export type { ActivitySubjectType, ActivityType };

/**
 * Derived activity/timeline collection. Seeded from lead/quote/deal lifecycle events
 * during migration; extended going forward by lead quick actions (PAC-16).
 * `legacySmartSuiteId` holds a synthetic dedupe key (e.g. "sold:<dealLegacyId>").
 */
@Schema({ timestamps: true, collection: 'activities' })
export class Activity extends TenantRecord {
  // `type: String` is explicit for both of these because the unions are now
  // indexed-access types (`(typeof ACTIVITY_TYPES)[number]`), which
  // `emitDecoratorMetadata` reports as `Object` — Mongoose can't infer from it.
  // Same trap as `Lead.temperature`.
  @Prop({ type: String, required: true, index: true })
  type: ActivityType;

  @Prop({ type: String, required: true })
  subjectType: ActivitySubjectType;

  @Prop({ index: true })
  legacySubjectId?: string;

  @Prop({ type: Types.ObjectId, ref: 'Lead' })
  leadId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Deal' })
  dealId?: Types.ObjectId;

  /**
   * Set by `POST /quote-recaps` (PAC-39). Unset on migrated `quoted` rows,
   * which identify their subject through `legacySubjectId` instead.
   */
  @Prop({ type: Types.ObjectId, ref: 'QuoteRecap' })
  quoteRecapId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  producerId?: Types.ObjectId;

  @Prop({ type: Date, index: true })
  occurredAt?: Date;

  @Prop({ trim: true })
  summary?: string;

  @Prop({ default: 'migration' })
  source: string;

  @Prop({ default: false })
  isTestRecord: boolean;
}

export const ActivitySchema = SchemaFactory.createForClass(Activity);
ActivitySchema.index(
  { agencyId: 1, legacySmartSuiteId: 1 },
  LEGACY_DEDUPE_INDEX_OPTIONS,
);
ActivitySchema.index({ agencyId: 1, producerId: 1, occurredAt: -1 });
// The Lead Detail timeline (PAC-38). The producer-scoped index above cannot
// serve it: a lead's timeline spans whatever producer wrote each row.
ActivitySchema.index({ agencyId: 1, leadId: 1, occurredAt: -1 });
