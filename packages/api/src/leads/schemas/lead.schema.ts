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
