import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type AgencyDomainDocument = HydratedDocument<AgencyDomain>;

/** How the hostname reaches us. */
export type AgencyDomainKind = 'subdomain' | 'custom';

/**
 * `pending` — created, DNS not proven yet. Serves nothing.
 * `active`  — proven; resolves to this agency and Caddy may issue a cert for it.
 * `failed`  — a verification attempt was made and did not pass. Still serves
 *             nothing; kept (rather than deleted) so the owner sees *why*.
 */
export type AgencyDomainStatus = 'pending' | 'active' | 'failed';

/**
 * One hostname an agency's app answers on.
 *
 * The single source of truth for "which agency owns this host". Three things
 * read it and they must never disagree: `HostTenantResolver` (which tenant a
 * request belongs to), the public `domains/allow` endpoint (whether Caddy may
 * obtain a certificate), and `TenantUrlService` (which host outbound links and
 * emails point at).
 *
 * ## Not a `TenantRecord`
 * Every other agency-scoped collection extends `TenantRecord`, and this
 * deliberately does not. `TenantRecord` requires a `branchId` and is filtered by
 * `buildScopeFilter` for `own`/`branch`/`agency` data scopes — both of which are
 * meaningless here. A domain belongs to the *platform's* routing table and is
 * merely keyed by agency, exactly like `Agency` itself.
 */
@Schema({ timestamps: true, collection: 'agencyDomains' })
export class AgencyDomain {
  @Prop({ type: Types.ObjectId, ref: 'Agency', required: true, index: true })
  agencyId: Types.ObjectId;

  /**
   * The fully-qualified hostname, normalised: lowercase, no port, no trailing
   * dot. Normalisation happens in `normalizeHostname` and must be applied on
   * both sides — a stored `Texas.com` would never match an inbound `texas.com`
   * and the tenant would simply be invisible on its own domain.
   */
  @Prop({ required: true, lowercase: true, trim: true })
  hostname: string;

  @Prop({ type: String, required: true, enum: ['subdomain', 'custom'] })
  kind: AgencyDomainKind;

  @Prop({
    type: String,
    required: true,
    default: 'pending',
    enum: ['pending', 'active', 'failed'],
  })
  status: AgencyDomainStatus;

  /**
   * The host used to build this agency's outbound links (invites, share links,
   * the logo URL in emails). Exactly one per agency — see the partial unique
   * index below.
   */
  @Prop({ default: false })
  isPrimary: boolean;

  /**
   * Random token the owner publishes as a TXT record to prove they control the
   * domain. Custom domains only; a platform subdomain needs no proof because we
   * already control the parent zone.
   *
   * ⚠ Verification is not a formality. `hostname` is unique platform-wide, so
   * without it the first agency to type `competitor.com` would permanently deny
   * that hostname to the agency that actually owns it.
   */
  @Prop({ trim: true })
  verificationToken?: string;

  @Prop({ type: Date, default: null })
  verifiedAt: Date | null;

  /** When verification was last attempted — drives "checked N minutes ago". */
  @Prop({ type: Date, default: null })
  lastCheckedAt: Date | null;

  /** Why the last attempt failed, shown verbatim to the owner. */
  @Prop({ type: String, trim: true, default: null })
  lastError: string | null;
}

export const AgencyDomainSchema = SchemaFactory.createForClass(AgencyDomain);

/**
 * One agency per hostname, platform-wide.
 *
 * Unconditionally unique rather than a partial filter (unlike
 * `AgencySchema.index({ ticker: 1 })`): `hostname` is `required`, so there are
 * no nulls to collide on, and two agencies claiming one host is the exact
 * ambiguity `HostTenantResolver` must never have to resolve.
 */
AgencyDomainSchema.index({ hostname: 1 }, { unique: true });

/**
 * At most one primary per agency.
 *
 * A partial filter on `isPrimary: true` — the whole point is that the *many*
 * non-primary rows must be free to collide. `sparse` would not work here: the
 * field is `false`, not missing, so a sparse index would still index every row.
 * (Compare the `ticker` index, which uses a partial filter for a different
 * reason — see `AgencySchema` and the AGENTS.md note on changing index options.)
 */
AgencyDomainSchema.index(
  { agencyId: 1, isPrimary: 1 },
  { unique: true, partialFilterExpression: { isPrimary: true } },
);
