import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { NormalizedLeadSource } from '@sfa/shared';
import { HydratedDocument, Types } from 'mongoose';
import {
  LEGACY_DEDUPE_INDEX_OPTIONS,
  TenantRecord,
} from '../../common/schemas/tenant-record.schema';

export type DealDocument = HydratedDocument<Deal>;

export type DealType = 'Auto' | 'Home' | 'Bundle' | 'Other';
export type PremiumSource = 'rollup' | 'snapshot' | 'none';

/**
 * The discount selections that drive audit-item generation, OR-ed across every
 * policy on the deal.
 *
 * Named for the **audit template titles** they resolve to rather than for the
 * form controls that set them, because that is what the generator matches on:
 * `roofReceipt` produces `Home/Landlord Hail Resistant Roof`, and
 * `studentDiscount` produces `Good Student`.
 */
export interface DealAuditTriggers {
  defensiveDriver: boolean;
  goodStudent: boolean;
  drivewise: boolean;
  fireSubscription: boolean;
  actualCashValue: boolean;
  hailResistantRoof: boolean;
  /** One audit item is generated per name, so N drivers give N certificates. */
  defensiveDriverNames: string[];
}

/**
 * A factory, not a shared constant: `{ ...CONST }` copies
 * `defensiveDriverNames` **by reference**, so every deal defaulted from one
 * object would share a single array instance and one `push` would leak across
 * documents.
 */
export function emptyAuditTriggers(): DealAuditTriggers {
  return {
    defensiveDriver: false,
    goodStudent: false,
    drivewise: false,
    fireSubscription: false,
    actualCashValue: false,
    hailResistantRoof: false,
    defensiveDriverNames: [],
  };
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

  /*
   * Real ObjectId refs (PAC-40).
   *
   * Until these existed the only links to a deal were the `legacy*` strings
   * above, which the migration writes and nothing else does — so an
   * app-created deal was unreachable from its lead, and audit generation and
   * CRM assignment had no way to resolve the client.
   *
   * All optional: thousands of migrated deals predate them. `required: true`
   * would assert something false about existing documents and break the
   * migration the moment anyone passed `runValidators`. Requiredness belongs
   * in the create DTO, not the collection.
   */

  @Prop({ type: Types.ObjectId, ref: 'Lead', index: true })
  leadId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Household', index: true })
  householdId?: Types.ObjectId;

  /** Optional by design — not every sale has a recorded quote. */
  @Prop({ type: Types.ObjectId, ref: 'QuoteRecap' })
  quoteRecapId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Contact' })
  primaryContactId?: Types.ObjectId;

  /** Per-wizard-session idempotency key; see the partial unique index below. */
  @Prop({ trim: true })
  submissionToken?: string;

  /**
   * Set when any policy claimed escrow. Legacy tracked this as a separate
   * "Escrow Payment" flag on the deal and gated the `Home/Landlord Mortgagee`
   * audit items on it.
   */
  @Prop({ default: false })
  mortgagee: boolean;

  /**
   * The deal-level union of every policy's discount selections — what audit
   * generation reads. Legacy kept the equivalent booleans directly on the Deal
   * record and its generator re-read them from there, so this preserves the
   * shape the ported algorithm expects.
   */
  @Prop({ type: Object, default: emptyAuditTriggers })
  auditTriggers: DealAuditTriggers;

  // --- CRM assignment (PAC-40), mirrored from the household ---

  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  assignedCrmId?: Types.ObjectId;

  @Prop({ type: Date })
  crmAssignedAt?: Date;

  /** `assigned | skipped_existing | no_pool | missing_input | failed`. */
  @Prop()
  crmAssignmentStatus?: string;

  @Prop()
  crmAssignmentError?: string;

  // --- Post-sale audit generation (PAC-40) ---

  /*
   * Generation runs post-commit and best-effort, so it cannot fail the request.
   * Without this telemetry a generation that produced nothing is completely
   * invisible: the deal looks fine and the service team simply never receives
   * a hand-off.
   */

  @Prop({ type: Date })
  auditGeneratedAt?: Date;

  /** `generated | no_templates | failed`. */
  @Prop()
  auditGenerationStatus?: string;

  @Prop()
  auditGenerationError?: string;

  @Prop({ default: 0 })
  auditItemCount: number;

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
DealSchema.index({ agencyId: 1, householdId: 1, soldDate: -1 });

/**
 * The Sold scorecard's own-scope aggregation (PAC-11). The `soldDate` index
 * above is on the **Date**; it cannot serve a range over the `YYYYMMDD`
 * integer the dashboard buckets by, so this is a separate index rather than a
 * reordering. Do not reorder.
 */
DealSchema.index({ agencyId: 1, producerId: 1, soldDateYmd: -1 });

/**
 * The Leaderboard (PAC-13), which groups by producer across the whole agency
 * and so cannot use the producer-prefixed index above. Also serves the Sold
 * scorecard for an agency-scoped caller. `soldDateYmd` carries only a
 * single-field index on its own, which leaves `agencyId` unindexed for this
 * query shape.
 */
DealSchema.index({ agencyId: 1, soldDateYmd: -1 });

/**
 * The Lead Detail deal lookup (PAC-38) — "the sale this lead became". Only a
 * single-field `leadId` index existed, which cannot order the result.
 */
DealSchema.index({ agencyId: 1, leadId: 1, soldDate: -1 });

/**
 * Its legacy fallback. `backfill-deal-refs` populates `leadId` on migrated
 * deals, but only for agencies where it has actually been run, so the read path
 * must still be able to find a deal by the lead's SmartSuite id.
 *
 * Partial, never `sparse` — see the `submissionToken` index below.
 */
DealSchema.index(
  { agencyId: 1, legacyLeadId: 1 },
  { partialFilterExpression: { legacyLeadId: { $type: 'string' } } },
);

/**
 * Idempotency for `POST /sold-deals`.
 *
 * `partialFilterExpression`, **never `sparse: true`**: on a compound index
 * MongoDB only omits a document when *every* indexed field is missing, and
 * `agencyId` is always present — so under `sparse` the second token-less deal
 * in an agency (i.e. every migrated one) fails with E11000. Same trap as
 * `LEGACY_DEDUPE_INDEX_OPTIONS` and `QuoteRecap.submissionToken`.
 */
DealSchema.index(
  { agencyId: 1, submissionToken: 1 },
  {
    unique: true,
    partialFilterExpression: { submissionToken: { $type: 'string' } },
  },
);
