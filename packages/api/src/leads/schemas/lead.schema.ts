import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type {
  IntakeChannel,
  LeadMailerMatchedBy,
  LeadTemperature,
  NormalizedLeadSource,
} from '@sfa/shared';
import { HydratedDocument, IndexOptions, Types } from 'mongoose';
import { ObjectIdType } from '../../common/mongo/object-id';
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
 * The mailer this lead came from, and how we know (PAC-71).
 *
 * ## Why a real link and not just the printed string
 *
 * `quoteControlNumber` stays, but it is a **display and search string**, not a
 * join key: a producer typing a control number into an intake form stores it
 * unnormalized, so "which campaign produced this lead" was a string join that
 * silently missed. This sub-document is the join, and `campaignId` is
 * denormalized off the mailer at link time so a campaign's attributed-lead
 * count is one indexed count rather than a two-hop lookup.
 *
 * ⚠ `campaignId` is stamped once and **never rewritten**. An append-mode commit
 * moves a mailer to a newer campaign; the lead stays attributed to the campaign
 * that actually produced it, which is the only reading of the number that means
 * anything.
 *
 * ## Three fields, three states
 *
 * - `mailerId` set — a real link. `matchedBy` says how strong it is.
 * - `mailerId` null with `controlNumberKey` set — the number is known but no
 *   mailer matched it yet, either because the campaign has not been imported or
 *   because another agency's lead already owns the mailer. The commit's
 *   reconcile step walks exactly these.
 * - the whole sub-document absent — no control number was ever supplied.
 */
@Schema({ _id: false })
export class LeadMailerLink {
  /**
   * ⚠ Unique **platform-wide** (see the index below): one lead per mailer, and
   * the first agency to log it owns it.
   *
   * Nullable rather than absent when unmatched, so the reconcile query can ask
   * for "has a pending key and no mailer" in one indexed predicate.
   */
  @Prop({ type: ObjectIdType, ref: 'Mailer', default: null })
  mailerId: Types.ObjectId | null;

  /** Denormalized from `Mailer.campaignId`. Null while `mailerId` is null. */
  @Prop({ type: String, default: null })
  campaignId: string | null;

  /** `mailerControlNumberKey(...)` — the normalized form every lookup keys on. */
  @Prop({ trim: true })
  controlNumberKey?: string;

  /** ⚠ `type: String` — a union reflects as `Object` and throws at construction. */
  @Prop({ type: String, enum: ['drawer', 'control_number', 'address'] })
  matchedBy?: LeadMailerMatchedBy;

  @Prop({ type: Date })
  linkedAt?: Date;

  /** Null when the link was made by a job rather than a person. */
  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  linkedBy: Types.ObjectId | null;
}

export const LeadMailerLinkSchema =
  SchemaFactory.createForClass(LeadMailerLink);

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

  /*
   * ⚠ No `emails` / `phones`, deliberately (PAC-91 §1–§3).
   *
   * The lead used to hold a denormalised copy of its primary contact's details,
   * and it is the reason most migrated leads rendered a blank Phone and Email
   * column: the importer filled the copy from the SmartSuite *Leads* table's
   * own columns, which are empty on legacy rows because the real values live on
   * the linked contact. Nothing kept the copy in step afterwards either — an
   * app-created lead only ever held what *its* submission supplied.
   *
   * Read the primary contact instead, through `primaryContactId` below (which
   * PAC-91 Phase 1 now fills on every migrated lead). `firstName` / `lastName`
   * stay: a lead can exist before anyone has decided which contact it belongs
   * to, and the list has to render *something*.
   */

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

  /**
   * The control number as printed, for display and for the Leads-list
   * contains-search. **Not the join key** — see {@link LeadMailerLink}.
   */
  @Prop()
  quoteControlNumber?: string;

  /** The mailer that produced this lead, if any. See {@link LeadMailerLink}. */
  @Prop({ type: LeadMailerLinkSchema })
  mailer?: LeadMailerLink;

  @Prop({ type: ObjectIdType, ref: 'User', index: true })
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
  @Prop({ type: ObjectIdType, ref: 'Household', index: true })
  householdId?: Types.ObjectId;

  @Prop({ type: ObjectIdType, ref: 'Contact', index: true })
  primaryContactId?: Types.ObjectId;

  @Prop({ type: [{ type: ObjectIdType, ref: 'Contact' }], default: [] })
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

// ---------------------------------------------------------------------------
// Mailer attribution (PAC-71). Exported because the backfill creates them
// itself, before the schema's `autoIndex` gets the chance — a restated,
// drifted spec there makes the next boot throw `IndexOptionsConflict`.
// ---------------------------------------------------------------------------

/**
 * **One lead per mailer, platform-wide.** This index is what enforces it; the
 * pre-checks in `logLead` and the intake pipeline only turn the violation into
 * a readable 409 instead of an E11000.
 *
 * Not agency-prefixed, and that is the whole point: a campaign visible to
 * several tenants must not produce one lead per tenant for the same prospect.
 * The first agency to log it owns it, and everyone else's drawer shows the
 * mailer as already logged with the action disabled.
 */
export const LEAD_MAILER_UNIQUE_INDEX_NAME = 'mailer.mailerId_1';
export const LEAD_MAILER_UNIQUE_INDEX_KEY = { 'mailer.mailerId': 1 } as const;
export const LEAD_MAILER_UNIQUE_INDEX_OPTIONS = {
  unique: true,
  // Partial, never sparse — and on `objectId` rather than "exists", because the
  // unmatched state stores an explicit `null` that every such lead would
  // otherwise collide on.
  partialFilterExpression: { 'mailer.mailerId': { $type: 'objectId' } },
} satisfies IndexOptions;

LeadSchema.index(LEAD_MAILER_UNIQUE_INDEX_KEY, {
  name: LEAD_MAILER_UNIQUE_INDEX_NAME,
  ...LEAD_MAILER_UNIQUE_INDEX_OPTIONS,
});

/**
 * Serves both readings of "leads from this campaign": the platform count on the
 * campaigns list (leading field alone) and an agency-scoped list.
 *
 * The agency-prefixed `{ agencyId, 'mailer.mailerId' }` the ticket originally
 * called for is redundant with the unique index above — that one already
 * resolves a mailer to at most one lead, from which the agency is a FETCH away.
 */
export const LEAD_MAILER_CAMPAIGN_INDEX_KEY = {
  'mailer.campaignId': 1,
  agencyId: 1,
} as const;
export const LEAD_MAILER_CAMPAIGN_INDEX_OPTIONS = {
  partialFilterExpression: { 'mailer.campaignId': { $type: 'string' } },
} satisfies IndexOptions;

LeadSchema.index(
  LEAD_MAILER_CAMPAIGN_INDEX_KEY,
  LEAD_MAILER_CAMPAIGN_INDEX_OPTIONS,
);

/**
 * The commit's reconcile pass: leads carrying a control-number key that has not
 * resolved to a mailer yet.
 */
export const LEAD_MAILER_KEY_INDEX_KEY = {
  'mailer.controlNumberKey': 1,
} as const;
export const LEAD_MAILER_KEY_INDEX_OPTIONS = {
  partialFilterExpression: { 'mailer.controlNumberKey': { $type: 'string' } },
} satisfies IndexOptions;

LeadSchema.index(LEAD_MAILER_KEY_INDEX_KEY, LEAD_MAILER_KEY_INDEX_OPTIONS);
