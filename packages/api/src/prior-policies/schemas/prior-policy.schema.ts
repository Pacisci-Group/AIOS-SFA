import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  LEGACY_DEDUPE_INDEX_OPTIONS,
  TenantRecord,
} from '../../common/schemas/tenant-record.schema';

export type PriorPolicyDocument = HydratedDocument<PriorPolicy>;

/**
 * Migrated from SmartSuite "The Prior Policies Table" (69423e89ea5c9f2798e4bc00).
 */
@Schema({ timestamps: true, collection: 'priorPolicies' })
export class PriorPolicy extends TenantRecord {
  @Prop({ trim: true })
  title?: string;

  @Prop()
  cancellationStatus?: string;

  @Prop()
  policyType?: string;

  @Prop()
  needsCancellation?: string;

  @Prop({ type: Date })
  cancellationDate?: Date;

  @Prop()
  accordFormNeeded?: string;

  @Prop()
  previousCarrier?: string;

  @Prop()
  notes?: string;

  @Prop({ type: Date })
  completedDate?: Date;

  @Prop({ type: Types.ObjectId, ref: 'Deal', index: true })
  dealId?: Types.ObjectId;

  @Prop()
  legacyDealId?: string;

  @Prop({ type: Types.ObjectId, ref: 'Household', index: true })
  householdId?: Types.ObjectId;

  @Prop()
  legacyHouseholdId?: string;

  @Prop()
  legacyPriorInsuranceId?: string;

  @Prop({ default: false, index: true })
  isTestRecord: boolean;
}

export const PriorPolicySchema = SchemaFactory.createForClass(PriorPolicy);
PriorPolicySchema.index(
  { agencyId: 1, legacySmartSuiteId: 1 },
  LEGACY_DEDUPE_INDEX_OPTIONS,
);
