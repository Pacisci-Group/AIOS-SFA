import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  LEGACY_DEDUPE_INDEX_OPTIONS,
  TenantRecord,
} from '../../common/schemas/tenant-record.schema';

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
  LEGACY_DEDUPE_INDEX_OPTIONS,
);
PolicySchema.index({ agencyId: 1, householdId: 1 });
