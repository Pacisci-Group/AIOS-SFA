import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  LEGACY_DEDUPE_INDEX_OPTIONS,
  TenantRecord,
} from '../../common/schemas/tenant-record.schema';

export type DealDocument = HydratedDocument<Deal>;

export type DealType = 'Auto' | 'Home' | 'Bundle' | 'Other';
export type PremiumSource = 'rollup' | 'snapshot' | 'none';

export interface NormalizedLeadSource {
  code: string | null;
  label: string;
}

/**
 * Migrated from SmartSuite "The Deals (Sold Log) Table" (6941fdb2dc9a6d024fd8c3a1).
 * Backs the Sold scorecard + Leaderboard.
 */
@Schema({ timestamps: true, collection: 'deals' })
export class Deal extends TenantRecord {
  @Prop({ trim: true })
  title?: string;

  @Prop()
  dealAutoNumber?: number;

  @Prop({ type: Date, index: true })
  soldDate?: Date;

  /** YYYYMMDD integer, mirrors legacy sold_yyyymmdd_num for fast range filters. */
  @Prop({ index: true })
  soldDateYmd?: number;

  /** Effective premium: rollup (s0675d21ce) with total_premium_snapshot fallback. */
  @Prop({ default: 0 })
  premium: number;

  @Prop({ default: 'none' })
  premiumSource: PremiumSource;

  @Prop({ default: 0 })
  itemCount: number;

  @Prop({ default: 0 })
  policyCount: number;

  @Prop({ default: 'Other', index: true })
  dealType: DealType;

  @Prop({ default: false })
  isBundle: boolean;

  @Prop({ type: [String], default: [] })
  policyTypes: string[];

  @Prop({ type: Object, default: { code: null, label: '' } })
  leadSource: NormalizedLeadSource;

  @Prop({ trim: true })
  clientName?: string;

  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  producerId?: Types.ObjectId;

  @Prop({ index: true })
  legacyProducerId?: string;

  @Prop()
  legacyLeadId?: string;

  @Prop()
  legacyHouseholdId?: string;

  @Prop()
  legacyQuoteRecapId?: string;

  @Prop()
  dealAuditStatus?: string;

  @Prop()
  status?: string;

  @Prop({ default: false, index: true })
  isTestRecord: boolean;
}

export const DealSchema = SchemaFactory.createForClass(Deal);
DealSchema.index(
  { agencyId: 1, legacySmartSuiteId: 1 },
  LEGACY_DEDUPE_INDEX_OPTIONS,
);
DealSchema.index({ agencyId: 1, producerId: 1, soldDate: -1 });
