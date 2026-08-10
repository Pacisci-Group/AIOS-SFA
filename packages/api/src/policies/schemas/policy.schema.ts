import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { SoldPolicyDiscounts } from '@sfa/shared';
import { HydratedDocument, Types } from 'mongoose';
import {
  LEGACY_DEDUPE_INDEX_OPTIONS,
  TenantRecord,
} from '../../common/schemas/tenant-record.schema';

export type PolicyDocument = HydratedDocument<Policy>;

/**
 * The signed new business application (PAC-56 #23).
 *
 * Its own sub-schema rather than a bare object, mirroring `QuoteDocument`, so
 * `uploadedAt` is stamped server-side — "when did we receive this?" is the
 * first question asked of a compliance document, and a client-supplied answer
 * is not one.
 */
@Schema({ _id: false })
export class NewBusinessApplication {
  /** Object storage key, agency- and lead-namespaced. Never sent to the web. */
  @Prop({ required: true })
  key: string;

  @Prop({ required: true })
  filename: string;

  /** Re-derived from storage, never the client's claim. Always a PDF. */
  @Prop({ required: true })
  contentType: string;

  @Prop({ required: true })
  size: number;

  @Prop({ type: Date, default: Date.now })
  uploadedAt: Date;
}

export const NewBusinessApplicationSchema = SchemaFactory.createForClass(
  NewBusinessApplication,
);

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
   * The discount selections this specific policy carried (PAC-40).
   *
   * The deal's `auditTriggers` is the OR-union across policies and is what
   * generation reads; keeping the per-policy record is what makes "which
   * policy triggered this audit item?" answerable — on a bundled Auto + Home
   * sale the union alone cannot say.
   *
   * ⚠ **Two historical shapes live in here**, and there is no backfill:
   *   - `drivewise` is a bare `true`/`false` on deals booked before PAC-56 #21,
   *     and `{ selected, attachment? }` after it.
   *   - `hasProof` is present on the proof-backed discounts before #21 and
   *     absent after; it is deprecated and no longer read anywhere.
   *
   * Nothing reads either today (the field is provenance, not a read path). The
   * first thing that does must handle both — hence `type: Object` staying
   * untyped at the schema layer.
   */
  @Prop({ type: Object })
  discounts?: SoldPolicyDiscounts;

  /**
   * The signed new business application for this policy (PAC-56 #23).
   *
   * Required on the write path and PDF-only; **optional here**, because every
   * migrated and pre-#23 policy predates it and `required: true` would assert
   * something false about them.
   *
   * ⚠ The migration deliberately does **not** port legacy's copies. SmartSuite
   * held them as `file[]` — five type-keyed columns on Deals plus
   * `sd61f05a5f` on Policies — behind opaque Filestack handles; moving those
   * binaries out is a separate exercise, not an oversight.
   */
  @Prop({ type: NewBusinessApplicationSchema })
  newBusinessApplication?: NewBusinessApplication;

  @Prop({ default: false, index: true })
  isTestRecord: boolean;
}

export const PolicySchema = SchemaFactory.createForClass(Policy);
PolicySchema.index(
  { agencyId: 1, legacySmartSuiteId: 1 },
  LEGACY_DEDUPE_INDEX_OPTIONS,
);
PolicySchema.index({ agencyId: 1, householdId: 1 });

// Renewal outreach scans the book by renewal window on every desk read.
// Without this the scan is a full collection scan — `renewalDate` had no index
// at all before proactive renewals existed.
PolicySchema.index({ agencyId: 1, active: 1, renewalDate: 1 });

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
