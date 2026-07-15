import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { TenantRecord } from '../../common/schemas/tenant-record.schema';
import type { NormalizedLeadSource } from '../../deals/schemas/deal.schema';

export type LeadDocument = HydratedDocument<Lead>;

export type LeadTemperature = 'Hot' | 'Warm' | 'Cold' | 'Unknown';

/**
 * Migrated from SmartSuite "The Leads Table" (6941fdb1dc9a6d024fd8b505).
 * Backs the Hot Leads / Priority Contact List.
 */
@Schema({ timestamps: true, collection: 'leads' })
export class Lead extends TenantRecord {
  @Prop({ trim: true })
  firstName?: string;

  @Prop({ trim: true })
  lastName?: string;

  @Prop({ type: [String], default: [] })
  emails: string[];

  @Prop({ type: [String], default: [] })
  phones: string[];

  @Prop({ index: true })
  status?: string;

  @Prop({ default: 'Unknown', index: true })
  temperature: LeadTemperature;

  @Prop({ type: Object, default: { code: null, label: '' } })
  leadSource: NormalizedLeadSource;

  /** Days since created_date; derived at migration time (recompute in API for live aging). */
  @Prop({ default: 0 })
  agingDays: number;

  @Prop({ type: Date })
  createdDate?: Date;

  @Prop({ type: Date, index: true })
  lastActivityAt?: Date;

  @Prop()
  quoteControlNumber?: string;

  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  producerId?: Types.ObjectId;

  @Prop({ index: true })
  legacyProducerId?: string;

  @Prop()
  legacyHouseholdId?: string;

  @Prop({ default: false, index: true })
  isTestRecord: boolean;
}

export const LeadSchema = SchemaFactory.createForClass(Lead);
LeadSchema.index(
  { agencyId: 1, legacySmartSuiteId: 1 },
  { unique: true, sparse: true },
);
LeadSchema.index({ agencyId: 1, producerId: 1, temperature: 1, status: 1 });
