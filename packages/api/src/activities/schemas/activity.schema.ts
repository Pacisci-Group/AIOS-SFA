import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { TenantRecord } from '../../common/schemas/tenant-record.schema';

export type ActivityDocument = HydratedDocument<Activity>;

export type ActivityType =
  'lead_created' | 'quoted' | 'sold' | 'call' | 'text' | 'email' | 'note';

export type ActivitySubjectType = 'lead' | 'deal' | 'quoteRecap';

/**
 * Derived activity/timeline collection. Seeded from lead/quote/deal lifecycle events
 * during migration; extended going forward by lead quick actions (PAC-16).
 * `legacySmartSuiteId` holds a synthetic dedupe key (e.g. "sold:<dealLegacyId>").
 */
@Schema({ timestamps: true, collection: 'activities' })
export class Activity extends TenantRecord {
  @Prop({ required: true, index: true })
  type: ActivityType;

  @Prop({ required: true })
  subjectType: ActivitySubjectType;

  @Prop({ index: true })
  legacySubjectId?: string;

  @Prop({ type: Types.ObjectId, ref: 'Lead' })
  leadId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Deal' })
  dealId?: Types.ObjectId;

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
  { unique: true, sparse: true },
);
ActivitySchema.index({ agencyId: 1, producerId: 1, occurredAt: -1 });
