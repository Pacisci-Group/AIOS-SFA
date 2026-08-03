import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { TenantRecord } from '../../common/schemas/tenant-record.schema';

export type PolicyDocument = HydratedDocument<Policy>;

/**
 * Migrated from SmartSuite "The Policies Table" (6941fc5b08644a5fbf05a781).
 */
@Schema({ timestamps: true, collection: 'policies' })
export class Policy extends TenantRecord {
  @Prop({ trim: true })
  policyNumber?: string;

  @Prop()
  policyType?: string;

  @Prop()
  carrier?: string;

  @Prop({ default: false })
  active: boolean;

  @Prop({ type: Date })
  effectiveDate?: Date;

  @Prop({ type: Date })
  expirationDate?: Date;

  @Prop({ type: Date })
  renewalDate?: Date;

  @Prop({ default: 0 })
  premium: number;

  @Prop({ default: 0 })
  items: number;

  @Prop()
  policyStatus?: string;

  @Prop()
  notes?: string;

  @Prop({ type: Types.ObjectId, ref: 'Household', index: true })
  householdId?: Types.ObjectId;

  @Prop({ index: true })
  legacyHouseholdId?: string;

  @Prop({ type: Types.ObjectId, ref: 'Deal', index: true })
  dealId?: Types.ObjectId;

  @Prop()
  legacyDealId?: string;

  @Prop({ default: false, index: true })
  isTestRecord: boolean;
}

export const PolicySchema = SchemaFactory.createForClass(Policy);
PolicySchema.index(
  { agencyId: 1, legacySmartSuiteId: 1 },
  { unique: true, sparse: true },
);
PolicySchema.index({ agencyId: 1, householdId: 1 });

// Renewal outreach scans the book by renewal window on every desk read.
// Without this the scan is a full collection scan — `renewalDate` had no index
// at all before proactive renewals existed.
PolicySchema.index({ agencyId: 1, active: 1, renewalDate: 1 });
