import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { SoldPolicyDiscounts } from '@sfa/shared';
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

  /**
   * `policyNumber` uppercased with non-alphanumerics stripped — the match key
   * behind `GET /policies/check` (PAC-40).
   *
   * Stored rather than computed at query time so the lookup is index-backed:
   * a producer typing `abc-123 ` must match a stored `ABC123`, and normalizing
   * in the query would force a collection scan on every keystroke.
   */
  @Prop({ trim: true })
  policyNumberKey?: string;

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

  /**
   * The Card 5 selections this specific policy carried (PAC-40).
   *
   * The deal's `auditTriggers` is the OR-union across policies and is what
   * generation reads; keeping the per-policy record is what makes "which
   * policy triggered this audit item?" answerable — on a bundled Auto + Home
   * sale the union alone cannot say.
   */
  @Prop({ type: Object })
  discounts?: SoldPolicyDiscounts;

  @Prop({ default: false, index: true })
  isTestRecord: boolean;
}

export const PolicySchema = SchemaFactory.createForClass(Policy);
PolicySchema.index(
  { agencyId: 1, legacySmartSuiteId: 1 },
  LEGACY_DEDUPE_INDEX_OPTIONS,
);
PolicySchema.index({ agencyId: 1, householdId: 1 });

/**
 * Backs `GET /policies/check`.
 *
 * **Non-unique on purpose.** Migrated data may already contain duplicate
 * numbers, and different carriers legitimately reuse them, so a unique index
 * would fail to build at boot and would also reject legitimate writes. The
 * endpoint warns the producer and offers to link; it never blocks.
 */
PolicySchema.index(
  { agencyId: 1, policyNumberKey: 1 },
  { partialFilterExpression: { policyNumberKey: { $type: 'string' } } },
);
