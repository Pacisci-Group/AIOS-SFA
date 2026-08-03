import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { PolicyType } from '@sfa/shared';
import { HydratedDocument, Types } from 'mongoose';
import {
  LEGACY_DEDUPE_INDEX_OPTIONS,
  TenantRecord,
} from '../../common/schemas/tenant-record.schema';

export type QuoteRecapDocument = HydratedDocument<QuoteRecap>;

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

/** The insured property address. Free-form for the `Lead.address` reason. */
export interface QuoteRecapAddress {
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
}

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

  /** Derived server-side: the sum of `policies[].premium`, rounded to cents. */
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

  /** Captured only when a property-type policy was quoted. */
  @Prop({ type: Object })
  propertyAddress?: QuoteRecapAddress;

  /** True when `propertyAddress` was copied from the household's own address. */
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
 * `{ agencyId, leadId }` is a prefix of this, so lead-detail lookups are served
 * by it; the trailing `createdAt` also orders "newest recap is the current one",
 * which is how a requote supersedes its predecessor.
 */
QuoteRecapSchema.index({ agencyId: 1, leadId: 1, createdAt: -1 });
QuoteRecapSchema.index({ agencyId: 1, householdId: 1, createdAt: -1 });

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
