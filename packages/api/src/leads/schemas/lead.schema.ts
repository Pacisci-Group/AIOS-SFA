import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { LeadTemperature, NormalizedLeadSource } from '@sfa/shared';
import { HydratedDocument, Types } from 'mongoose';
import {
  LEGACY_DEDUPE_INDEX_OPTIONS,
  TenantRecord,
} from '../../common/schemas/tenant-record.schema';

export type LeadDocument = HydratedDocument<Lead>;

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

  // `type: String` is explicit because `LeadTemperature` is now an
  // indexed-access type (`(typeof LEAD_TEMPERATURES)[number]`), which
  // `emitDecoratorMetadata` reports as `Object` — Mongoose can't infer from it.
  @Prop({ type: String, default: 'Unknown', index: true })
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
  LEGACY_DEDUPE_INDEX_OPTIONS,
);
LeadSchema.index({ agencyId: 1, producerId: 1, temperature: 1, status: 1 });
// Default Leads-list query (PAC-36): scope clamp + the `lastActivityAt` sort.
LeadSchema.index({ agencyId: 1, producerId: 1, lastActivityAt: -1 });
