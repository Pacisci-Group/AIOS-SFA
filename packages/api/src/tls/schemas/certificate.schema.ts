import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type CertificateDocument = HydratedDocument<Certificate>;

/**
 * `pending` — an order is queued or in flight. No usable material yet.
 * `active`  — `certPem` and `keyPemEncrypted` are a usable pair.
 * `failed`  — the last attempt failed. Kept, with `lastError`, so an operator
 *             can see why rather than finding an absent row.
 *
 * A row can move `active` → `failed` when a *renewal* fails, and it keeps
 * serving the old certificate while it does. That is deliberate: an expiring
 * certificate is still a working one, and dropping it because a renewal failed
 * would turn a recoverable problem into an outage.
 */
export type CertificateStatus = 'pending' | 'active' | 'failed';

/**
 * One TLS certificate, for one hostname.
 *
 * ## Why certificates live in MongoDB
 * This collection is the reason the app tier can autoscale at all. Every node
 * has to be able to complete a TLS handshake for every hostname the platform
 * serves — including agency custom domains added minutes ago — and a node that
 * joined the pool thirty seconds ago has no local state. Shared storage makes
 * nodes interchangeable; a filesystem certificate store (Caddy's default) makes
 * them emphatically not, because each one would run its own ACME client and
 * race the others for the same names.
 *
 * ## Not an `AgencyDomain` field
 * Tempting, since most rows correspond to one. But the platform host itself
 * needs a certificate and is not an agency domain, and the lifecycles differ:
 * a domain is verified once and then static, while a certificate is re-issued
 * every couple of months and carries its own failure and backoff state. Folding
 * the second into the first would mean renewal churn writing to the routing
 * table that `HostTenantResolver` reads on every request.
 *
 * ## Not a `TenantRecord`
 * Same reasoning as {@link AgencyDomain}: `TenantRecord` requires a `branchId`
 * and is filtered by `buildScopeFilter`, neither of which means anything for a
 * platform-wide routing concern. There is deliberately no `agencyId` here
 * either — the edge looks this up by hostname before it knows, or needs to know,
 * which tenant it belongs to.
 */
@Schema({ timestamps: true, collection: 'certificates' })
export class Certificate {
  /**
   * Fully-qualified hostname, normalised the same way `AgencyDomain.hostname`
   * is: lowercase, no port, no trailing dot.
   *
   * ⚠ Normalisation has to match on both sides. The edge looks this up with the
   * SNI servername from the TLS handshake, and a stored `Texas.com` would never
   * match an inbound `texas.com` — the symptom being a handshake failure on a
   * domain that looks perfectly configured everywhere else.
   */
  @Prop({ required: true, lowercase: true, trim: true })
  hostname: string;

  /**
   * The full chain, leaf first, PEM.
   *
   * Not encrypted, and should not be: a certificate is public by construction —
   * every client that connects is handed it, and it is published to Certificate
   * Transparency logs regardless. Encrypting it would add a decryption step to
   * every cold handshake to protect nothing.
   */
  @Prop({ type: String, default: null })
  certPem: string | null;

  /**
   * The private key, encrypted with `CERT_ENCRYPTION_KEY` (see
   * `common/crypto/at-rest-cipher.ts`).
   *
   * ⚠ Never log this, never return it from an endpoint, and never add it to a
   * projection that feeds an API response. The only legitimate reader is the
   * edge building a `SecureContext`.
   */
  @Prop({ type: String, default: null })
  keyPemEncrypted: string | null;

  @Prop({
    type: String,
    required: true,
    default: 'pending',
    enum: ['pending', 'active', 'failed'],
  })
  status: CertificateStatus;

  /** From the issued certificate, not from when we stored it. */
  @Prop({ type: Date, default: null })
  issuedAt: Date | null;

  /** The leaf's `notAfter`. What the renewal sweep measures against. */
  @Prop({ type: Date, default: null })
  expiresAt: Date | null;

  /**
   * When this row next becomes eligible for an issuance attempt.
   *
   * Serves two jobs deliberately fused into one field, because both answer the
   * same question — "should the sweep pick this up?":
   *
   *  - On `active`, it is the renewal point (a third of the lifetime before
   *    expiry, so a fortnight of failures is survivable).
   *  - On `failed`, it is the exponential-backoff point. A domain whose DNS was
   *    taken down must not be retried every five minutes forever; Let's Encrypt
   *    counts failed validations against a rate limit that would then be spent
   *    on a domain nobody is waiting for.
   */
  @Prop({ type: Date, required: true, default: () => new Date() })
  renewAfter: Date;

  /**
   * Consecutive failures, reset to zero on success. Drives the backoff above.
   */
  @Prop({ type: Number, required: true, default: 0 })
  failureCount: number;

  /** Why the last attempt failed. Safe to show an operator; never a secret. */
  @Prop({ type: String, trim: true, default: null })
  lastError: string | null;

  /**
   * Set while a worker holds this row for an issuance attempt.
   *
   * ⚠ This is the guard against duplicate ACME orders, and it is not optional.
   * Let's Encrypt limits identical certificates to five per week; two workers
   * ordering the same hostname concurrently — an event retry overlapping its
   * original, say — burns that allowance on nothing. The claim is a conditional
   * `findOneAndUpdate`, so the lock and the read are one atomic operation.
   *
   * Reaped after a timeout rather than held forever, on the same reasoning as
   * `migrations_lock`: a worker killed mid-order leaves this set, and a row that
   * can never be claimed again is a certificate that silently stops renewing.
   */
  @Prop({ type: Date, default: null })
  lockedAt: Date | null;
}

export const CertificateSchema = SchemaFactory.createForClass(Certificate);

/**
 * One certificate per hostname, platform-wide.
 *
 * Unconditionally unique — `hostname` is required, so there are no nulls to
 * collide on. Two rows for one hostname would mean the edge picking arbitrarily
 * between two key pairs, which fails intermittently and only for whichever
 * clients land on the node that cached the wrong one.
 */
CertificateSchema.index({ hostname: 1 }, { unique: true });

/**
 * The renewal sweep's query: everything due, oldest first.
 *
 * Compound on `renewAfter` alone would do today, at a few hundred rows. It is
 * indexed anyway because the sweep runs on a schedule forever and an unindexed
 * collection scan is the kind of thing that is free until it is not.
 */
CertificateSchema.index({ renewAfter: 1 });
