import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { PolicyType } from '@sfa/shared';
import { HydratedDocument, Types } from 'mongoose';
import {
  LEGACY_DEDUPE_INDEX_OPTIONS,
  TenantRecord,
} from '../../common/schemas/tenant-record.schema';

export type QuoteRecapDocument = HydratedDocument<QuoteRecap>;

/** The insured property address. Free-form for the `Lead.address` reason. */
export interface QuoteRecapAddress {
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
}

/**
 * One row of the quoted proposal. Legacy stored only the aggregates (Fillout
 * pre-computed them); keeping the rows preserves what the producer actually
 * entered and is what any future per-policy display needs.
 */
@Schema({ _id: false })
export class QuotedPolicy {
  /**
   * `type: String` is explicit because `PolicyType` is an indexed-access type
   * (`(typeof POLICY_TYPES)[number]`), which `emitDecoratorMetadata` reports as
   * `Object` — the same trap documented on `Lead.temperature`.
   */
  @Prop({ type: String, required: true, trim: true })
  policyType: PolicyType;

  @Prop({ required: true, min: 0 })
  premium: number;

  @Prop({ required: true, min: 1 })
  itemCount: number;

  /**
   * The dwelling **this row** insures (PAC-56 #14) — **already resolved**: a
   * row the producer marked "same as household" holds a copy of the household
   * address, so nothing downstream has to re-apply the flag.
   *
   * Set only on property-type rows. It lives here rather than on the recap
   * because a single recap routinely covers a home *and* a landlord policy on a
   * different building.
   *
   * Optional for the reason given on the class below: migrated and seeded
   * recaps predate the field entirely.
   */
  @Prop({ type: Object })
  propertyAddress?: QuoteRecapAddress;

  /** Round-trips the producer's choice for the edit form (PAC-56 #11). */
  @Prop({ default: false })
  sameAsHousehold: boolean;
}

export const QuotedPolicySchema = SchemaFactory.createForClass(QuotedPolicy);

/** The carrier quote, uploaded via presigned PUT. Mirrors `DealAuditAttachment`. */
@Schema({ _id: false })
export class QuoteDocument {
  /** Object storage key (agency-namespaced, server-generated). */
  @Prop({ required: true })
  key: string;

  @Prop({ required: true })
  filename: string;

  /** Read back from `HeadObject`, not taken from the client's claim. */
  @Prop({ required: true })
  contentType: string;

  /** Read back from `HeadObject`, not taken from the client's claim. */
  @Prop({ required: true })
  size: number;

  @Prop({ type: Date, default: Date.now })
  uploadedAt: Date;
}

export const QuoteDocumentSchema = SchemaFactory.createForClass(QuoteDocument);

/**
 * Migrated from SmartSuite "The Quote Recaps Table" (6941fdb2dc9a6d024fd8bc53).
 * Backs the Quoted scorecard, and since PAC-39 is also written live by
 * `POST /quote-recaps`.
 *
 * Every field the form adds is **optional**: thousands of migrated and seeded
 * recaps predate all of them, so `required: true` would assert something false
 * about existing documents and break the migration under `runValidators`.
 * Requiredness lives in `dto/create-quote-recap.dto.ts` instead.
 */
@Schema({ timestamps: true, collection: 'quoteRecaps' })
export class QuoteRecap extends TenantRecord {
  @Prop({ trim: true })
  title?: string;

  @Prop()
  quoteRecapAutoNumber?: number;

  @Prop({ type: Date, index: true })
  quoteDate?: Date;

  /**
   * Derived server-side: the sum of `policies[].premium`, rounded to cents.
   *
   * ⚠ **Mixes terms.** Auto is quoted on a 6-month term and everything else
   * annually (see `premiumTermSuffix`), so this sum has no single unit — never
   * render it with `/yr`. It is the quoted figure, which is also the basis
   * producers are paid on.
   */
  @Prop({ default: 0 })
  premium: number;

  /** Derived server-side: the sum of `policies[].itemCount`. */
  @Prop({ default: 0 })
  itemCount: number;

  /**
   * Derived server-side: the distinct `policies[].policyType`.
   *
   * Migrated documents hold **raw SmartSuite codes** here while the app writes
   * canonical labels — normalize with `normalizePolicyType` on every read.
   */
  @Prop({ type: [String], default: [] })
  productsQuoted: string[];

  @Prop()
  recapStatus?: string;

  /**
   * When the client's current insurance renews — a month label (PAC-56 #16).
   *
   * Legacy's `Insurance X Month` (`s69d7c3f64`), re-ported. Optional here even
   * though the create DTO requires it, per the class docblock: every migrated
   * recap predates it.
   *
   * Stored as the **label**, not SmartSuite's choice UUID. The migration maps
   * at write and every read path runs `normalizeInsuranceMonth`, so a database
   * migrated before this landed still renders month names.
   */
  @Prop({ trim: true })
  insuranceRenewalMonth?: string;

  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  producerId?: Types.ObjectId;

  /**
   * The lead this recap belongs to. Legacy requires a lead and rejects a recap
   * without one; migrated documents carry only `legacyLeadId`, so this is unset
   * on everything that predates PAC-39.
   */
  @Prop({ type: Types.ObjectId, ref: 'Lead', index: true })
  leadId?: Types.ObjectId;

  /** Resolved from the lead server-side, never sent by the client. */
  @Prop({ type: Types.ObjectId, ref: 'Household', index: true })
  householdId?: Types.ObjectId;

  @Prop({ type: [QuotedPolicySchema], default: [] })
  policies: QuotedPolicy[];

  /**
   * The **recap-level** property address, and the flag that produced it.
   *
   * **No longer written.** PAC-56 #14 moved the address onto
   * `policies[].propertyAddress`, because one address per recap cannot describe
   * a home and a landlord policy at once. Both fields stay for the recaps
   * written before that; read paths prefer the per-row addresses and fall back
   * here.
   */
  @Prop({ type: Object })
  propertyAddress?: QuoteRecapAddress;

  @Prop({ default: false })
  sameAsHousehold: boolean;

  @Prop({ trim: true })
  notes?: string;

  @Prop({ type: QuoteDocumentSchema })
  quoteDocument?: QuoteDocument;

  /**
   * Client-generated per-form-session idempotency key, namespaced by channel
   * (`WEB|<uuid>`). Unique per agency — see the index below. Absent on every
   * migrated recap.
   */
  @Prop({ trim: true })
  submissionToken?: string;

  @Prop({ index: true })
  legacyProducerId?: string;

  @Prop()
  legacyLeadId?: string;

  @Prop()
  legacyHouseholdId?: string;

  /**
   * `YYYYMMDD` calendar-day label, the counterpart to `Deal.soldDateYmd`.
   *
   * Lets the Quoted scorecard (PAC-10) run the same indexed integer range
   * comparison the Sold scorecard uses, rather than a second `Date`-bounded
   * code path with its own timezone edge cases. Derived by `quoteDateYmd` in
   * `../quote.normalize`, which reads Chicago or UTC parts depending on the
   * recap's provenance — see that docblock.
   *
   * Optional only for recaps written before PAC-9; the migration has set it
   * on every import since.
   */
  @Prop({ index: true })
  quoteDateYmd?: number;

  @Prop({ default: false, index: true })
  isTestRecord: boolean;
}

export const QuoteRecapSchema = SchemaFactory.createForClass(QuoteRecap);
QuoteRecapSchema.index(
  { agencyId: 1, legacySmartSuiteId: 1 },
  LEGACY_DEDUPE_INDEX_OPTIONS,
);
/** Exactly the Quoted-scorecard query. Do not reorder. */
QuoteRecapSchema.index({ agencyId: 1, producerId: 1, quoteDate: -1 });

/**
 * The Quoted scorecard's own-scope aggregation (PAC-10). The `quoteDate` index
 * above is on the **Date**; it cannot serve a range over the `YYYYMMDD`
 * integer, so this is a separate index rather than a reordering. Mirrors
 * `{ agencyId, producerId, soldDateYmd }` on `deals` exactly. Do not reorder.
 */
QuoteRecapSchema.index({ agencyId: 1, producerId: 1, quoteDateYmd: -1 });

/** Its agency-scope counterpart, for a caller reading beyond their own rows. */
QuoteRecapSchema.index({ agencyId: 1, quoteDateYmd: -1 });

/**
 * `{ agencyId, leadId }` is a prefix of this, so lead-detail lookups are served
 * by it; the trailing `createdAt` also orders "newest recap is the current one",
 * which is how a requote supersedes its predecessor.
 */
QuoteRecapSchema.index({ agencyId: 1, leadId: 1, createdAt: -1 });
QuoteRecapSchema.index({ agencyId: 1, householdId: 1, createdAt: -1 });

/**
 * The Lead Detail quote block (PAC-38), which orders by `quoteDate` — the date
 * the producer says the quote was given — rather than by insertion time. The
 * `createdAt` index above cannot serve that sort.
 */
QuoteRecapSchema.index({ agencyId: 1, leadId: 1, quoteDate: -1 });

/**
 * The lead-detail legacy fallback (PAC-38). A recap imported before the
 * migration resolved `leadId` carries only `legacyLeadId`, so without this
 * lookup the quote block is empty for every such lead.
 *
 * Partial, **never** `sparse`, for the reason spelled out on the
 * `submissionToken` index below.
 */
QuoteRecapSchema.index(
  { agencyId: 1, legacyLeadId: 1 },
  { partialFilterExpression: { legacyLeadId: { $type: 'string' } } },
);

/**
 * Idempotency: a replayed submission resolves to the existing recap.
 *
 * Must be a partial filter, **never** `sparse: true`. MongoDB only omits a
 * document from a *compound* sparse index when **every** indexed field is
 * missing — `agencyId` is always present, so under `sparse` the second
 * token-less recap in an agency (i.e. every migrated one) would fail with
 * E11000. Same trap as `LEGACY_DEDUPE_INDEX_OPTIONS`.
 */
QuoteRecapSchema.index(
  { agencyId: 1, submissionToken: 1 },
  {
    unique: true,
    partialFilterExpression: { submissionToken: { $type: 'string' } },
  },
);
