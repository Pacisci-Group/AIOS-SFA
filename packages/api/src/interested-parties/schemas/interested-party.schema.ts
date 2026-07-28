import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  LEGACY_DEDUPE_INDEX_OPTIONS,
  TenantRecord,
} from '../../common/schemas/tenant-record.schema';

export type InterestedPartyDocument = HydratedDocument<InterestedParty>;

/**
 * Migrated from SmartSuite "The Interested Parties Table" (694240c03d897b7099d73340).
 * Mortgagees / lienholders attached to a policy.
 */
@Schema({ timestamps: true, collection: 'interestedParties' })
export class InterestedParty extends TenantRecord {
  @Prop({ trim: true })
  title?: string;

  @Prop()
  status?: string;

  @Prop()
  priority?: string;

  @Prop()
  mortgagee?: string;

  @Prop()
  loanNumber?: string;

  @Prop({ type: Object })
  address?: Record<string, unknown>;

  @Prop()
  notes?: string;

  @Prop({ type: Types.ObjectId, ref: 'Policy', index: true })
  policyId?: Types.ObjectId;

  @Prop()
  legacyPolicyId?: string;

  @Prop({ type: Types.ObjectId, ref: 'Household', index: true })
  householdId?: Types.ObjectId;

  @Prop()
  legacyHouseholdId?: string;

  @Prop({ default: false, index: true })
  isTestRecord: boolean;
}

export const InterestedPartySchema =
  SchemaFactory.createForClass(InterestedParty);
InterestedPartySchema.index(
  { agencyId: 1, legacySmartSuiteId: 1 },
  LEGACY_DEDUPE_INDEX_OPTIONS,
);
