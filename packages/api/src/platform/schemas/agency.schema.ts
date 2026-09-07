import type { AgencySetupStatus, ModuleEntitlements } from '@sfa/shared';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, IndexOptions, Types } from 'mongoose';
import { ObjectIdType } from '../../common/mongo/object-id';

export type AgencyDocument = HydratedDocument<Agency>;

/**
 * Per-agency white-label identity: what the agency is *called* and what it
 * *looks* like, wherever we speak to their people — the app shell, the login
 * page, and every outbound email.
 *
 * ## Images are stored as object keys, not URLs
 * A key survives a bucket move, a CDN in front, and a change of signing scheme;
 * a stored URL does none of those and goes stale silently. The API turns a key
 * into bytes at `GET /public/tenant/logo`.
 *
 * ## Colours are not here yet, on purpose
 * The first phase is deliberately logo + name only. A `theme` field will land
 * beside these, which is why this is a sub-document rather than four loose
 * fields on `Agency` — adding it later then costs nothing. The reason it was
 * deferred: `theme.css` defines a light and a navy dark palette, and a single
 * owner-picked hex has to produce a readable value in *both*. That is a real
 * piece of colour work (see the contrast notes in AGENTS.md), not a form field.
 */
@Schema({ _id: false })
export class AgencyBranding {
  /** Wordmark. Falls back to {@link Agency.name} when unset. */
  @Prop({ trim: true })
  displayName?: string;

  /** Replaces "Operations Platform" under the wordmark on the login page. */
  @Prop({ trim: true })
  tagline?: string;

  /** Object key of the logo shown on light surfaces and in email. */
  @Prop({ trim: true })
  logoKey?: string;

  /**
   * Optional logo for the dark theme. Falls back to {@link logoKey}.
   *
   * Worth having as its own field: a dark-ink logo on the navy sidebar is
   * invisible, and the usual fix from an agency is a second file rather than a
   * transparent-PNG redraw.
   */
  @Prop({ trim: true })
  logoDarkKey?: string;

  @Prop({ trim: true })
  faviconKey?: string;
}
export const AgencyBrandingSchema =
  SchemaFactory.createForClass(AgencyBranding);

/**
 * How an agency's outbound email is addressed.
 *
 * Two paths, and the default one requires nothing from the agency:
 * - **platform** (default) — we send from our own verified domain under the
 *   agency's display name. Zero DNS work, no deliverability risk.
 * - **verified** — the agency proved a sending domain with the provider and we
 *   send from their address.
 *
 * ⚠ `sendingStatus` is what `SenderIdentityService.resolve` keys off, and it
 * must never optimistically report `verified`. Sending from an unverified
 * domain gets `invalid_from_address` back from Resend, which is a
 * **non-retriable** error there — the invite is not delayed, it is lost.
 */
@Schema({ _id: false })
export class AgencyEmailSettings {
  /** Display name in the `From:` header. Falls back to the branding name. */
  @Prop({ trim: true })
  fromName?: string;

  /** Local part of the address, e.g. `hello` in `hello@texasholdings.com`. */
  @Prop({ trim: true, lowercase: true })
  fromLocalPart?: string;

  /**
   * Where replies go. Free-form and unverified by design — `Reply-To` carries
   * no authentication requirement, so this is the one-field way for an agency
   * to get replies into their own inbox with no DNS at all.
   */
  @Prop({ trim: true, lowercase: true })
  replyTo?: string;

  /** The domain being sent from, once verified. Null means "use ours". */
  @Prop({ trim: true, lowercase: true })
  sendingDomain?: string;

  /** The provider's id for that domain, for re-checking verification. */
  @Prop({ trim: true })
  providerDomainId?: string;

  @Prop({
    type: String,
    default: 'platform',
    enum: ['platform', 'pending', 'verified', 'failed'],
  })
  sendingStatus: 'platform' | 'pending' | 'verified' | 'failed';

  @Prop({ type: Date, default: null })
  verifiedAt: Date | null;

  @Prop({ type: String, trim: true, default: null })
  lastError: string | null;
}
export const AgencyEmailSettingsSchema =
  SchemaFactory.createForClass(AgencyEmailSettings);

/**
 * Where this agency is in its own first-run setup (PAC-69).
 *
 * ## Why the default is `complete`
 * Backwards, until you notice who the exceptions are. Every agency that exists
 * today was created by the SmartSuite migration, the demo seed or a test
 * fixture — none of which has an owner waiting to be walked through anything,
 * and all of which would otherwise be marked `pending` and start redirecting
 * their owners into a wizard the day this deployed. Only
 * `AgencyProvisioningService` writes `pending`, and it does so explicitly.
 *
 * That also means **no migration script**: an existing document with no `setup`
 * sub-document reads as complete. ⚠ Readers must null-guard rather than lean on
 * the default — `.lean()` does not apply schema defaults, so a lean read of an
 * older agency yields `undefined`, not `{ status: 'complete' }`.
 */
@Schema({ _id: false })
export class AgencySetup {
  @Prop({
    type: String,
    default: 'complete',
    enum: ['pending', 'complete'],
  })
  status: AgencySetupStatus;

  @Prop({ type: Date, default: null })
  completedAt: Date | null;

  /** Who finished it — the owner, not the operator who created the agency. */
  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  completedByUserId: Types.ObjectId | null;

  /**
   * Whether the white-label step was skipped rather than filled in.
   *
   * Kept because "completed" and "actually branded" are different questions,
   * and the second one is the one worth a nudge later.
   */
  @Prop({ default: false })
  brandingSkipped: boolean;
}
export const AgencySetupSchema = SchemaFactory.createForClass(AgencySetup);

/**
 * One carrier's appointment of this agency, and the code it issued (PAC-93).
 *
 * ## Why this is a list and not a field
 *
 * A **captive** agency sells one carrier — Smith Family Agency is an Allstate
 * exclusive agent, and Allstate issued it `A0B9049`. An **independent** agency
 * is appointed by several carriers, and *each one issues its own code*. So an
 * agency has one code per carrier, and this replaced `allstateAgencyId`, which
 * could only ever hold the first case.
 *
 * ## A code is meaningless outside its carrier
 *
 * Two carriers can hand out the same string to different agencies. That is why
 * {@link carrierId} is part of every key, every lookup and the uniqueness rule
 * below — never the code alone.
 */
@Schema({ _id: false })
export class CarrierAppointment {
  /**
   * The appointing carrier. Must be a **global** catalog row (`carriers` with
   * `agencyId: null`).
   *
   * An agency-scoped custom carrier is not a valid appointment target:
   * appointments are unique *across* tenants, and a carrier only one agency can
   * see makes "the same carrier" undecidable. Enforced in
   * `AgencyCarrierAppointmentsService` — a Mongoose `ref` validates nothing.
   *
   * ⚠ This is the first place in the codebase that stores a carrier `_id` as a
   * foreign key. Policies store the display *name* (see `carrier.ts`), and that
   * stays true — the two are answering different questions.
   */
  // ⚠ `ObjectIdType`, never `Types.ObjectId` — the latter compiles and silently
  // produces a **Mixed** path, so a string id would store verbatim and this
  // appointment would never match the `$elemMatch` that decides which tenant a
  // mailer row belongs to. See `common/mongo/object-id.ts`.
  @Prop({ type: ObjectIdType, ref: 'Carrier', required: true })
  carrierId: Types.ObjectId;

  /**
   * The code exactly as the carrier issued it, e.g. `A0B9049`.
   *
   * **Formats are deliberately not normalized across carriers.** Allstate's is
   * 7 alphanumerics; others are numeric, longer, or punctuated. We do not know
   * each carrier's rule, and inventing one fails closed — the same reasoning
   * behind `CoreCarrierSpec.policyNumberPattern` being per-carrier and
   * optional. Matching is what {@link codeKey} is for.
   */
  @Prop({ required: true, trim: true })
  carrierAgencyCode: string;

  /**
   * {@link carrierAgencyCode} trimmed and upper-cased, for matching.
   *
   * ⚠ The `trim`/`uppercase` options here are a **backstop setter, not the
   * rule**. The value is derived by `appointmentCodeKey()` in
   * `AgencyCarrierAppointmentsService`, which is also what the mailer pipeline
   * calls on a file's `agencyid`. These options only stop a hand-written `$set`
   * on a dotted path from storing a lower-case key; they are not the
   * definition, and a writer that bypasses Mongoose (`bulkWrite`, a raw driver
   * update, the backfill script) gets no help from them at all.
   */
  @Prop({ required: true, trim: true, uppercase: true })
  codeKey: string;

  /**
   * The agency's main appointment. **Exactly one per agency**, enforced in the
   * service — the schema cannot express it. The first appointment added becomes
   * primary, and a primary is always {@link active}.
   */
  @Prop({ default: false })
  isPrimary: boolean;

  /**
   * Whether the appointment is current.
   *
   * ⚠ **Deactivating does not release the code to another agency.** `active` is
   * not part of the unique key, so the pair stays claimed. Handing a code over
   * to the agency that now holds it means **deleting** the appointment, not
   * switching it off. That is the right default — an agency that lapsed and
   * re-appointed should not find its own code taken — but it surprises people,
   * so the UI says so next to the toggle.
   */
  @Prop({ default: true })
  active: boolean;

  /** When the carrier appointed this agency. Reserved; nothing collects it yet. */
  @Prop({ type: Date })
  appointedAt?: Date;
}
export const CarrierAppointmentSchema =
  SchemaFactory.createForClass(CarrierAppointment);

@Schema({ timestamps: true, collection: 'agencies' })
export class Agency {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  slug: string;

  @Prop({ default: 'active', enum: ['active', 'inactive', 'suspended'] })
  status: string;

  @Prop({ type: Object, default: {} })
  modules: ModuleEntitlements;

  @Prop({ type: Object, default: {} })
  settings: Record<string, unknown>;

  /**
   * White-label identity. Absent on every agency that has not set one, and
   * every reader must fall back to the platform default rather than assume it
   * is there — an agency created before this feature has no branding at all.
   */
  @Prop({ type: AgencyBrandingSchema, default: () => ({}) })
  branding: AgencyBranding;

  /** Sender identity for outbound email. See {@link AgencyEmailSettings}. */
  @Prop({ type: AgencyEmailSettingsSchema, default: () => ({}) })
  email: AgencyEmailSettings;

  /** First-run setup state. See {@link AgencySetup} for why it defaults to done. */
  @Prop({ type: AgencySetupSchema, default: () => ({}) })
  setup: AgencySetup;

  /**
   * The three-letter ticker that prefixes this agency's mailer `FileName`
   * (`SFA-20P` -> `SFA`). Uppercase (PAC-73).
   *
   * This is how the BigQuery mailer backfill attributes a row to a tenant —
   * nothing in that table carries an agency reference we own. Rows whose ticker
   * matches no `Agency` are skipped and counted, never guessed: filing one
   * agency's prospects under another is worse than leaving them out, and a
   * later re-run picks them up once the agency exists.
   */
  @Prop({ trim: true, uppercase: true })
  ticker?: string;

  /**
   * Which carriers have appointed this agency, and under what code (PAC-93).
   *
   * Replaced `allstateAgencyId`, which could only describe a captive Allstate
   * agency. Read today by the mailer upload's cross-check (`import-mailers.fn`)
   * and, from PAC-71, by the routing that decides which tenant a vendor file's
   * row belongs to.
   *
   * ⚠ **`.lean()` does not apply schema defaults**, so a lean read of an agency
   * created before this field yields `undefined`, not `[]`. Every reader must
   * `?? []`. Same trap already annotated on {@link AgencySetup}.
   *
   * Every element is complete: a carrier picked with no code produces no
   * element at all (the code is optional at every point it can be entered, but
   * an appointment without one is not an appointment, and a code-less element
   * would break the uniqueness index below).
   */
  @Prop({ type: [CarrierAppointmentSchema], default: [] })
  carrierAppointments: CarrierAppointment[];

  /**
   * National Producer Number — the one carrier-independent identifier an
   * agency has, issued by NIPR to business entities as well as individuals.
   *
   * Captured because onboarding is the only place anyone will type it.
   * **Nothing reads it yet**, and it is deliberately neither unique nor
   * indexed: NPNs are unique in NIPR, but we hold no NPN data and cannot verify
   * one, and an index added speculatively takes a migration to remove. State
   * licence numbers are per state and per producer — a different feature.
   */
  @Prop({ trim: true })
  npn?: string;
}

export const AgencySchema = SchemaFactory.createForClass(Agency);

/**
 * One agency per ticker.
 *
 * A partial filter rather than `sparse` so the many agencies with no ticker do
 * not all collide on `null` — the same trap written up on
 * `LEGACY_DEDUPE_INDEX_OPTIONS`. (`sparse` would in fact work here because the
 * index is single-field, but every other unique index in this codebase is a
 * partial filter and a reader should not have to re-derive why this one is
 * different.)
 */
AgencySchema.index(
  { ticker: 1 },
  { unique: true, partialFilterExpression: { ticker: { $type: 'string' } } },
);

/**
 * One agency per `(carrier, code)`, platform-wide (PAC-93).
 *
 * Legal as a compound multikey index because **both paths traverse the same
 * array** — the illegal case is two *different* array fields in one key. Index
 * entries are generated one per element, so the pair is enforced per
 * appointment rather than as a cross product.
 *
 * ## Why `partialFilterExpression` and not bare `unique`
 *
 * A multikey index over an empty array still emits one entry, keyed
 * `undefined`. Without the filter, every agency with no appointments would
 * index as `(undefined, undefined)` and the **second** such agency onboarded
 * would die with E11000 — the exact trap written up on
 * `LEGACY_DEDUPE_INDEX_OPTIONS`. The filter is an ordinary document-level
 * predicate: a document with no element whose `codeKey` is a string does not
 * match, and is excluded from the index entirely rather than indexed as null.
 *
 * (`sparse: true` would in fact work here, since *every* indexed field is
 * absent for an empty array, which is what compound-sparse requires. It is
 * still not used, for the reason given on the `ticker` index above — a reader
 * should not have to re-derive why one index in this codebase is different.)
 *
 * ## What it cannot do
 *
 * MongoDB's unique constraint applies **across separate documents**; one
 * document may repeat index-key values inside an array. So this cannot stop a
 * single agency listing the same pair twice — `AgencyCarrierAppointmentsService`
 * dedupes. Nor is `active` part of the key: see {@link CarrierAppointment.active}.
 *
 * ⚠ Membership is decided per *document*, not per key. An agency that matches
 * the filter has **all** its element keys indexed, including any element
 * missing `codeKey`. `required: true` prevents that through Mongoose, but a raw
 * driver write can produce it — which is why the backfill script asserts a
 * non-empty `codeKey` before writing.
 *
 * Exported so the backfill script builds a byte-identical spec. A restated,
 * drifted copy would make `autoIndex` throw `IndexOptionsConflict` at the next
 * boot.
 */
export const CARRIER_APPOINTMENT_UNIQUE_KEY = {
  'carrierAppointments.carrierId': 1,
  'carrierAppointments.codeKey': 1,
} as const;

export const CARRIER_APPOINTMENT_UNIQUE_OPTIONS = {
  unique: true,
  partialFilterExpression: {
    'carrierAppointments.codeKey': { $type: 'string' },
  },
} satisfies IndexOptions;

AgencySchema.index(
  CARRIER_APPOINTMENT_UNIQUE_KEY,
  CARRIER_APPOINTMENT_UNIQUE_OPTIONS,
);

/**
 * The lookup index: "which agency holds this code under this carrier?"
 *
 * ⚠ **The reversed key order is not an accident and must not be tidied.**
 * MongoDB refuses two indexes with the same key pattern and different options
 * (`IndexOptionsConflict`), so this cannot simply restate the unique key.
 *
 * ## Why a second index at all
 *
 * The unique index above is *partial*, and a partial index is only used when
 * the query predicate provably implies its filter. That check runs over the
 * parsed match expression: `{ carrierAppointments: { $elemMatch: {...} } }`
 * parses to a node on path `carrierAppointments` whose children are on paths
 * relative to the element, while the filter's node is on
 * `carrierAppointments.codeKey`. The planner does not rewrite one into the
 * other, the implication is not proven, and the lookup falls back to a
 * collection scan. This index carries no filter, so it is always eligible, and
 * `$elemMatch` is precisely the construct that lets a compound multikey index
 * take bounds on two fields of the same element.
 *
 * `active` is deliberately not in the key: a low-cardinality boolean earns
 * nothing, and the FETCH stage re-applies the whole `$elemMatch` anyway, as it
 * must on any multikey index.
 */
export const CARRIER_APPOINTMENT_LOOKUP_KEY = {
  'carrierAppointments.codeKey': 1,
  'carrierAppointments.carrierId': 1,
} as const;

AgencySchema.index(CARRIER_APPOINTMENT_LOOKUP_KEY);
