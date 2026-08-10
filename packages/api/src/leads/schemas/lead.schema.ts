import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type {
  IntakeChannel,
  LeadTemperature,
  NormalizedLeadSource,
} from '@sfa/shared';
import { HydratedDocument, Types } from 'mongoose';
import {
  LEGACY_DEDUPE_INDEX_OPTIONS,
  TenantRecord,
} from '../../common/schemas/tenant-record.schema';

export type LeadDocument = HydratedDocument<Lead>;

/**
 * The household's living address as submitted at intake (PAC-37). Every part is
 * optional: a partial public submission must still create a lead rather than
 * 400 and lose it.
 */
export interface LeadAddress {
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
}

/**
 * One policy the submitter asked to have quoted (PAC-56 #2).
 *
 * A real sub-schema rather than `type: Object`, so the item count is stored as a
 * number and a malformed row fails on write instead of surfacing as `NaN` on a
 * dashboard later.
 */
@Schema({ _id: false })
export class LeadPolicyOfInterest {
  @Prop({ required: true, trim: true })
  policyType: string;

  @Prop({ required: true, min: 1, max: 99 })
  itemCount: number;

  /**
   * The dwelling **this row** is about (PAC-56 #14) — **already resolved**:
   * a row the submitter marked "same as household" holds a copy of the living
   * address, so nothing downstream has to re-apply the flag.
   *
   * Set only on property-type rows. It lives here rather than on the lead
   * because a prospect can ask about the home they live in *and* a rental they
   * let out in one submission, and a single lead-level address describes only
   * one of them.
   */
  @Prop({ type: Object })
  propertyAddress?: LeadAddress;

  /**
   * What the submitter chose, kept alongside the resolved address purely so an
   * edit form can round-trip the toggle rather than having to guess it back
   * from an address comparison.
   */
  @Prop({ default: false })
  sameAsHousehold: boolean;
}

const LeadPolicyOfInterestSchema =
  SchemaFactory.createForClass(LeadPolicyOfInterest);

/**
 * Provenance — how this lead entered the platform (PAC-37). A producer needs to
 * tell an externally-submitted record from one they typed in themselves, and a
 * misbehaving share link has to be traceable back to the leads it produced.
 */
export interface LeadIntakeSource {
  channel: IntakeChannel;
  shareLinkId?: Types.ObjectId;
  submittedAt?: Date;
}

/**
 * Migrated from SmartSuite "The Leads Table" (6941fdb1dc9a6d024fd8b505).
 * Backs the Hot Leads / Priority Contact List.
 */
@Schema({ timestamps: true, collection: 'leads' })
export class Lead extends TenantRecord {
  @Prop({ trim: true })
  firstName?: string;

  @Prop({ trim: true })
  lastName?: string;

  @Prop({ type: [String], default: [] })
  emails: string[];

  @Prop({ type: [String], default: [] })
  phones: string[];

  @Prop({ index: true })
  status?: string;

  // `type: String` is explicit because `LeadTemperature` is now an
  // indexed-access type (`(typeof LEAD_TEMPERATURES)[number]`), which
  // `emitDecoratorMetadata` reports as `Object` — Mongoose can't infer from it.
  @Prop({ type: String, default: 'Unknown', index: true })
  temperature: LeadTemperature;

  @Prop({ type: Object, default: { code: null, label: '' } })
  leadSource: NormalizedLeadSource;

  /** Days since created_date; derived at migration time (recompute in API for live aging). */
  @Prop({ default: 0 })
  agingDays: number;

  @Prop({ type: Date })
  createdDate?: Date;

  @Prop({ type: Date, index: true })
  lastActivityAt?: Date;

  /**
   * What the submitter asked to be quoted, captured at intake (PAC-56 #2).
   * Canonical `POLICY_TYPES` labels plus an item count, mirroring the Quote
   * Recap's policy rows minus premium.
   *
   * Empty on every migrated lead: SmartSuite's Leads table has no equivalent
   * field, and the legacy Fillout intake forms never asked. Treat it as a
   * hint for the producer, never as a precondition for anything downstream.
   */
  @Prop({ type: [LeadPolicyOfInterestSchema], default: [] })
  policiesOfInterest: LeadPolicyOfInterest[];

  /**
   * The **lead-level** insured dwelling. Legacy stored exactly this on the lead
   * (`Property Address`, `sfd5ba053e`) and the migration carries it over, so the
   * field stays for those records.
   *
   * **No longer written by intake.** PAC-56 #14 moved the address onto
   * `policiesOfInterest[].propertyAddress`, because one address per lead cannot
   * represent a household insuring a home and a rental. Read paths prefer the
   * per-row addresses and fall back to this.
   */
  @Prop({ type: Object })
  propertyAddress?: LeadAddress;

  @Prop()
  quoteControlNumber?: string;

  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  producerId?: Types.ObjectId;

  @Prop({ index: true })
  legacyProducerId?: string;

  @Prop()
  legacyHouseholdId?: string;

  @Prop({ default: false, index: true })
  isTestRecord: boolean;

  /**
   * The real Household link. Migrated leads carry only `legacyHouseholdId` (the
   * SmartSuite id); intake backfills this on first touch.
   */
  @Prop({ type: Types.ObjectId, ref: 'Household', index: true })
  householdId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Contact', index: true })
  primaryContactId?: Types.ObjectId;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Contact' }], default: [] })
  memberContactIds: Types.ObjectId[];

  /**
   * Client-generated per-form-session idempotency key, namespaced by channel
   * (`WEB|<uuid>` / `SHARE|<linkId>|<uuid>`). Unique per agency — see the index
   * below. Absent on every migrated lead.
   */
  @Prop({ trim: true })
  submissionToken?: string;

  // `type: Object` is explicit for the same reason `leadSource` needs it: an
  // interface type emits as `Object` under `emitDecoratorMetadata`, so Mongoose
  // can't infer a schema from it.
  @Prop({ type: Object })
  address?: LeadAddress;

  /** `"<street>|<zip>"`, both lowercased + trimmed. Null unless both are present. */
  @Prop({ trim: true, lowercase: true })
  addressKey?: string;

  @Prop({ type: Object })
  intakeSource?: LeadIntakeSource;
}

export const LeadSchema = SchemaFactory.createForClass(Lead);
LeadSchema.index(
  { agencyId: 1, legacySmartSuiteId: 1 },
  LEGACY_DEDUPE_INDEX_OPTIONS,
);
LeadSchema.index({ agencyId: 1, producerId: 1, temperature: 1, status: 1 });
// Default Leads-list query (PAC-36): scope clamp + the `lastActivityAt` sort.
LeadSchema.index({ agencyId: 1, producerId: 1, lastActivityAt: -1 });

/**
 * The Hot Leads / Priority Contact List (PAC-15): equality on `temperature`,
 * then **ascending** `lastActivityAt` — stalest first, which is the inverse of
 * the Leads-list sort above and the actual definition of "needs a touch".
 *
 * Neither existing index serves it. The first can equality-match `temperature`
 * but has no ordering field after it; the second orders correctly but cannot
 * filter by temperature without a scan. A single index whose leading fields are
 * equality predicates and whose last field is the sort key is what makes the
 * panel an index-only read.
 */
LeadSchema.index({
  agencyId: 1,
  producerId: 1,
  temperature: 1,
  lastActivityAt: 1,
});

// Every one of these is a PARTIAL filter, never `sparse: true` — the same trap
// documented on LEGACY_DEDUPE_INDEX_OPTIONS. On a compound index MongoDB only
// omits a document when *every* indexed field is missing, and `agencyId` is
// always present, so on a `sparse` unique index the second token-less lead in
// an agency (i.e. every migrated one) would fail with E11000.

/** Idempotency: a replayed submission resolves to the existing lead. */
LeadSchema.index(
  { agencyId: 1, submissionToken: 1 },
  {
    unique: true,
    partialFilterExpression: { submissionToken: { $type: 'string' } },
  },
);

/** Dedupe signal 2. */
LeadSchema.index(
  { agencyId: 1, quoteControlNumber: 1 },
  { partialFilterExpression: { quoteControlNumber: { $type: 'string' } } },
);

/** Dedupe signal 3 — address+zip, newest first (the lookup applies a recency window). */
LeadSchema.index(
  { agencyId: 1, addressKey: 1, createdAt: -1 },
  { partialFilterExpression: { addressKey: { $type: 'string' } } },
);

LeadSchema.index({ agencyId: 1, householdId: 1 });

/**
 * The `ContactAccessService` reachability probe (PAC-38).
 *
 * `Contact` carries no `producerId`, so a producer's right to edit one is
 * derived by asking "does this caller own a lead that reaches this contact?".
 * These two serve that question; the household leg of it is served by the
 * `{ agencyId, householdId }` index above.
 */
LeadSchema.index({ agencyId: 1, primaryContactId: 1 });
LeadSchema.index({ agencyId: 1, memberContactIds: 1 });
