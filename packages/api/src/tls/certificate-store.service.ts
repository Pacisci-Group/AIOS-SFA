import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SecureContext, createSecureContext } from 'tls';
import {
  decryptSecret,
  readEncryptionKey,
} from '../common/crypto/at-rest-cipher';
import { normalizeHostname } from '../common/tenancy/hostname';
import { Certificate, CertificateDocument } from './schemas/certificate.schema';

/**
 * How long a built `SecureContext` is reused before the row is re-read.
 *
 * This is the knob that decides how quickly a renewed certificate reaches a
 * running node, and how long a node survives an unreachable database. Five
 * minutes is short enough that a renewal is picked up well inside the renewal
 * window, and long enough that a handshake almost never waits on Mongo.
 */
const CACHE_TTL_MS = 5 * 60_000;

/**
 * How long a "this hostname has no certificate" answer is remembered.
 *
 * Much shorter than a hit, because the interesting transition is a domain that
 * has *just* been issued one — a tenant watching their own domain come alive
 * should not wait five minutes for a node to stop believing it is absent.
 *
 * Cached at all because without it, an unknown hostname is an unauthenticated
 * database query per TLS handshake, which is a trivially cheap way for anyone
 * to make us do work.
 */
const NEGATIVE_CACHE_TTL_MS = 30_000;

interface CacheEntry {
  /** Null means "known to have no usable certificate". */
  context: SecureContext | null;
  expiresAt: number;
}

/**
 * Serves TLS certificates to the edge, from MongoDB.
 *
 * ## Why this is what makes the tier scale
 * A node that joined the autoscale pool thirty seconds ago must be able to
 * complete a handshake for a tenant domain added minutes ago, having never seen
 * either. It can, because the certificate is not node state — it is a row, and
 * this service turns that row into a `SecureContext` on demand.
 *
 * Nothing here issues anything. Issuance is the worker's job (`src/worker/acme/`)
 * and is deliberately nowhere near the request path: a CA is a slow, rate-limited
 * third party, and putting it behind a TLS handshake would make certificate
 * problems into latency problems.
 */
@Injectable()
export class CertificateStoreService {
  private readonly logger = new Logger(CertificateStoreService.name);

  private readonly cache = new Map<string, CacheEntry>();

  /**
   * Read once. A missing or malformed key is fatal at construction rather than
   * on the first handshake — a node that cannot decrypt anything should fail
   * to start, not join the load balancer and then refuse every connection.
   */
  private readonly encryptionKey: Buffer;

  constructor(
    @InjectModel(Certificate.name)
    private readonly certificates: Model<CertificateDocument>,
    config: ConfigService,
  ) {
    this.encryptionKey = readEncryptionKey(
      config.get<string>('CERT_ENCRYPTION_KEY'),
    );
  }

  /**
   * The `SecureContext` for a hostname, or null if we hold no usable
   * certificate for it.
   *
   * Null is the signal for the edge to refuse the connection. That refusal is
   * the equivalent of Caddy's `ask` gate returning non-200 — except the decision
   * is made from a row this process already trusts, rather than over HTTP to
   * another process that might be unreachable.
   */
  async contextFor(servername: string): Promise<SecureContext | null> {
    const hostname = normalizeHostname(servername);
    if (!hostname) return null;

    const cached = this.cache.get(hostname);
    if (cached && cached.expiresAt > Date.now()) return cached.context;

    try {
      return await this.load(hostname);
    } catch (error) {
      // A database blip must not drop TLS for hostnames we have already served.
      // Serving a stale-but-valid certificate is strictly better than refusing
      // the connection: the certificate is still within its validity window, and
      // the alternative is an outage caused by a transient read failure.
      if (cached?.context) {
        this.logger.warn(
          `Could not refresh ${hostname}; serving the cached certificate. ${String(error)}`,
        );
        cached.expiresAt = Date.now() + NEGATIVE_CACHE_TTL_MS;
        return cached.context;
      }
      this.logger.error(
        `Could not load a certificate for ${hostname}: ${String(error)}`,
      );
      return null;
    }
  }

  private async load(hostname: string): Promise<SecureContext | null> {
    const row = await this.certificates
      .findOne({ hostname, status: 'active' })
      .select('certPem keyPemEncrypted')
      .lean();

    if (!row?.certPem || !row.keyPemEncrypted) {
      this.remember(hostname, null, NEGATIVE_CACHE_TTL_MS);
      return null;
    }

    const context = createSecureContext({
      cert: row.certPem,
      key: decryptSecret(row.keyPemEncrypted, this.encryptionKey),
    });

    this.remember(hostname, context, CACHE_TTL_MS);
    return context;
  }

  private remember(
    hostname: string,
    context: SecureContext | null,
    ttlMs: number,
  ): void {
    this.cache.set(hostname, { context, expiresAt: Date.now() + ttlMs });
  }

  /**
   * Drop a cached entry, so the next handshake re-reads.
   *
   * Not wired to anything yet. It exists because the obvious next improvement —
   * having a node notice a renewal immediately rather than within the cache TTL
   * — needs exactly this, and a cache with no way to invalidate it is the kind
   * of thing that gets worked around rather than fixed.
   */
  invalidate(hostname: string): void {
    const key = normalizeHostname(hostname);
    if (key) this.cache.delete(key);
  }
}
