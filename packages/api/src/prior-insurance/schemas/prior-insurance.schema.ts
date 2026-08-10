import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  LEGACY_DEDUPE_INDEX_OPTIONS,
  TenantRecord,
} from '../../common/schemas/tenant-record.schema';

export type PriorInsuranceDocument = HydratedDocument<PriorInsurance>;

/**
 * Migrated from SmartSuite "The Prior Insurance Table" (69423c25d4f749d1e15c017a).
 */
@Schema({ timestamps: true, collection: 'priorInsurance' })
export class PriorInsurance extends TenantRecord {
  @Prop({ trim: true })
  title?: string;

  @Prop()
  cancellationResponsibility?: string;

  @Prop()
  cancelledPreviousInsurance?: string;

  @Prop({ type: Date })
  cancellationDate?: Date;

  @Prop()
  autoHomeSameCarrier?: string;

  @Prop()
  previousCarrierAuto?: string;

  @Prop()
  previousCarrierHome?: string;

  @Prop()
  previousAgentName?: string;

  @Prop({ type: Types.ObjectId, ref: 'Deal', index: true })
  dealId?: Types.ObjectId;

  @Prop()
  legacyDealId?: string;

  @Prop({ type: Types.ObjectId, ref: 'Household', index: true })
  householdId?: Types.ObjectId;

  @Prop()
  legacyHouseholdId?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  producerId?: Types.ObjectId;

  @Prop()
  legacyProducerId?: string;

  @Prop({ default: false, index: true })
  isTestRecord: boolean;
}

export const PriorInsuranceSchema =
  SchemaFactory.createForClass(PriorInsurance);
PriorInsuranceSchema.index(
  { agencyId: 1, legacySmartSuiteId: 1 },
  LEGACY_DEDUPE_INDEX_OPTIONS,
);
/**
 * The Lead Detail Prior Insurance block (PAC-38): lead → deal → prior
 * insurance, with the household as the fallback for records the Sold form did
 * not write.
 */
PriorInsuranceSchema.index({ agencyId: 1, dealId: 1 });
PriorInsuranceSchema.index({ agencyId: 1, householdId: 1 });
