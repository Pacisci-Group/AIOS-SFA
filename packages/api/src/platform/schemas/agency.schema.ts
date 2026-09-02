import type { AgencySetupStatus, ModuleEntitlements } from '@sfa/shared';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

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
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
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
   * The Allstate agency id as printed in a mailer file's `agencyid` column
   * (`A0B9049`). Uppercase (PAC-73).
   *
   * ⚠ Distinct from {@link ticker} and used for a different job: this is only
   * ever **cross-checked** against an upload so the operator is warned when the
   * file's own agency disagrees with the one they picked. It never selects an
   * agency. Keeping it here is what makes that check a data lookup rather than
   * a hard-coded map.
   */
  @Prop({ trim: true, uppercase: true })
  allstateAgencyId?: string;
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
