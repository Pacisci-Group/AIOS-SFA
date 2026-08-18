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

  /**
   * Who cancelled the prior policy.
   *
   * ⚠ **Two vocabularies live in this column.** The SmartSuite migration writes
   * legacy's `Agent` / `Client`; the sold form writes PAC-65's `SFA staff` /
   * `Customer`. Normalized on read in `LeadDetailService` rather than migrated,
   * so an import keeps its own bytes and there is no backfill to get wrong.
   */
  @Prop()
  cancellationResponsibility?: string;

  /**
   * The staff member who cancelled it, when the answer was `SFA staff`
   * (PAC-65 #11).
   *
   * ⚠ Verified against the caller's agency before it is written — see
   * `SoldDealsService.assertCancelledByOwned`. The id arrives from the client.
   */
  @Prop({ type: Types.ObjectId, ref: 'User' })
  cancellationHandledByUserId?: Types.ObjectId;

  /**
   * That person's display name, denormalized at write time so Lead Detail
   * renders without a join — the same shape `producerName` takes on audit items.
   */
  @Prop({ trim: true })
  cancellationHandledByName?: string;

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
