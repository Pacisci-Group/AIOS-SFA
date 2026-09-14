import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as acme from 'acme-client';
import {
  CHALLENGE_TTL_MS,
  ISSUANCE_LOCK_TTL_MS,
  ORDER_TIMEOUT_MS,
  acmeEnabled,
  backoffAfterFailure,
  renewalPoint,
} from '../../config/acme.config';
import {
  encryptSecret,
  readEncryptionKey,
} from '../../common/crypto/at-rest-cipher';
import { normalizeHostname } from '../../common/tenancy/hostname';
import {
  AgencyDomain,
  AgencyDomainDocument,
} from '../../platform/schemas/agency-domain.schema';
import {
  AcmeChallenge,
  AcmeChallengeDocument,
} from '../../tls/schemas/acme-challenge.schema';
import {
  Certificate,
  CertificateDocument,
} from '../../tls/schemas/certificate.schema';
import { AcmeAccountService } from './acme-account.service';

/** What one issuance attempt reports back to its caller. */
export type IssuanceOutcome =
  | { status: 'issued'; hostname: string; expiresAt: Date }
  | { status: 'skipped'; hostname: string; reason: string }
  | { status: 'failed'; hostname: string; error: string };

/**
 * Orders, renews and stores TLS certificates.
 *
 * Everything here runs inside an Inngest function, which is what supplies the
 * retries, the scheduling and the durability. This service owns the ACME
 * protocol interaction and the database state around it; it deliberately owns
 * no retry policy of its own, because two layers of retry over a rate-limited
 * third party is how an account gets locked out.
 */
@Injectable()
export class CertificateIssuerService {
  private readonly logger = new Logger(CertificateIssuerService.name);

  constructor(
    @InjectModel(Certificate.name)
    private readonly certificates: Model<CertificateDocument>,
    @InjectModel(AcmeChallenge.name)
    private readonly challenges: Model<AcmeChallengeDocument>,
    // A schema, which the worker boundary allows across. `WorkerModule` already
    // registers it for `TenantUrlService`.
    @InjectModel(AgencyDomain.name)
    private readonly domains: Model<AgencyDomainDocument>,
    private readonly account: AcmeAccountService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Obtain (or renew) the certificate for one hostname.
   *
   * Idempotent in the way that matters: a second concurrent call for the same
   * hostname claims nothing and returns `skipped`, rather than placing a second
   * ACME order. That is the guard against Let's Encrypt's duplicate-certificate
   * limit, which a retried Inngest event would otherwise walk straight into.
   */
  async issue(rawHostname: string): Promise<IssuanceOutcome> {
    if (!this.enabled()) {
      return {
        status: 'skipped',
        hostname: rawHostname,
        reason: 'ACME_ENABLED is not true in this environment.',
      };
    }

    const hostname = normalizeHostname(rawHostname);
    if (!hostname) {
      return {
        status: 'failed',
        hostname: rawHostname,
        error: 'Not a usable hostname.',
      };
    }

    // ⚠ The backoff binds EVERY caller, not just the sweep.
    //
    // `findDue` filters on `renewAfter`, so the sweep already honours it — but
    // `PlatformCertificateBootstrap` called `issue()` directly on every worker
    // boot, which meant a restart placed a fresh order however recently the last
    // one had failed. During a debugging session that is a restart every few
    // minutes, and each one spent an order against Let's Encrypt's limits until
    // the account was refused with a 429 and a Retry-After of sixteen hours.
    //
    // The backoff existed and was correct; it simply was not authoritative. It
    // is checked here now, where every path must pass, rather than in the one
    // caller that happened to look.
    const due = await this.isDue(hostname);
    if (!due) {
      return {
        status: 'skipped',
        hostname,
        reason:
          'Not due yet — a recent attempt set a backoff, or the certificate is current.',
      };
    }

    const claimed = await this.claim(hostname);
    if (!claimed) {
      return {
        status: 'skipped',
        hostname,
        reason: 'Another worker holds the issuance claim for this hostname.',
      };
    }

    try {
      const result = await this.withTimeout(
        this.order(hostname),
        ORDER_TIMEOUT_MS,
        `ACME order for ${hostname}`,
      );
      await this.recordSuccess(hostname, result);
      this.logger.log(
        `Issued certificate for ${hostname}, valid until ${result.notAfter.toISOString()}.`,
      );
      return { status: 'issued', hostname, expiresAt: result.notAfter };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.recordFailure(hostname, message);
      // Logged rather than rethrown: the Inngest function treats a failed
      // issuance as a completed run with a recorded failure, not as a crash to
      // retry. Retry policy lives in `renewAfter`, where it can back off across
      // process restarts — an Inngest retry cannot.
      this.logger.warn(`Issuance failed for ${hostname}: ${message}`);
      return { status: 'failed', hostname, error: message };
    } finally {
      await this.release(hostname);
    }
  }

  /**
   * Bound an await on the certificate authority.
   *
   * ⚠ Without this, a CA that accepts an order and never resolves it leaves
   * `issue()` awaiting forever. The claim is held the whole time, so every later
   * attempt reports "skipped" until the lock ages out — which is how the
   * platform host went seventy-five minutes with no certificate and not one line
   * of log explaining it.
   *
   * A timeout turns that into a recorded failure with a backoff, which the sweep
   * then retries. The order itself takes seconds; this is a ceiling, not a
   * target.
   */
  private async withTimeout<T>(
    work: Promise<T>,
    ms: number,
    what: string,
  ): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error(`${what} timed out after ${ms}ms.`)),
            ms,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Whether this environment issues certificates. See `acme.config.ts`. */
  enabled(): boolean {
    return acmeEnabled(this.config.get<string>('ACME_ENABLED'));
  }

  /**
   * Whether this hostname may be attempted now.
   *
   * A row that does not exist yet is due — that is a first issuance. Otherwise
   * `renewAfter` decides: set to now on creation, to the renewal point on
   * success, and to an exponential backoff on failure.
   */
  private async isDue(hostname: string): Promise<boolean> {
    const row = await this.certificates
      .findOne({ hostname })
      .select('renewAfter')
      .lean();

    if (!row) return true;
    return row.renewAfter.getTime() <= Date.now();
  }

  /**
   * Take the issuance claim for a hostname, creating the row if this is its
   * first certificate.
   *
   * One conditional `findOneAndUpdate`, so the check and the claim cannot be
   * interleaved by another worker. The condition admits a row whose lock is
   * unset *or* older than the TTL — the second half is the reaper, and it exists
   * because a worker killed mid-order would otherwise leave the hostname
   * permanently unclaimable, which reads as a certificate that quietly stopped
   * renewing.
   */
  private async claim(hostname: string): Promise<boolean> {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - ISSUANCE_LOCK_TTL_MS);

    const claimed = await this.certificates.findOneAndUpdate(
      {
        hostname,
        $or: [{ lockedAt: null }, { lockedAt: { $lt: staleBefore } }],
      },
      { $set: { lockedAt: now } },
      { new: true },
    );
    if (claimed) return true;

    // No row matched. Either the hostname has never been issued, or someone
    // else holds a live claim. `upsert` cannot distinguish those, so insert
    // and let the unique index say which it was.
    try {
      await this.certificates.create({
        hostname,
        status: 'pending',
        lockedAt: now,
        renewAfter: now,
      });
      return true;
    } catch (error) {
      if ((error as { code?: number }).code === 11000) return false;
      throw error;
    }
  }

  private async release(hostname: string): Promise<void> {
    await this.certificates.updateOne(
      { hostname },
      { $set: { lockedAt: null } },
    );
  }

  /**
   * The ACME exchange itself.
   *
   * `client.auto` drives account lookup, order placement, every authorization,
   * and the certificate download. The two callbacks are where this design earns
   * its keep: they put the challenge response somewhere *every* node can read
   * it, which is what makes validation survive a load balancer.
   */
  private async order(hostname: string): Promise<{
    certPem: string;
    keyPem: string;
    notBefore: Date;
    notAfter: Date;
  }> {
    const client = await this.account.client();

    // Bracketing the order at LOG level, not debug, so "how far did it get" is
    // answerable even where debug is filtered out. Everything between these two
    // lines is acme-client's own tracing.
    this.logger.log(`Ordering a certificate for ${hostname}...`);

    const [keyBuffer, csr] = await acme.crypto.createCsr({
      altNames: [hostname],
    });

    const certPem = await client.auto({
      csr,
      termsOfServiceAgreed: true,

      /**
       * ⚠ `http-01` only, never `dns-01`.
       *
       * A DNS challenge would require write access to the tenant's zone, which
       * for an agency-owned domain we will never have — that is the entire
       * point of white-labelling. Leaving the default priority in place would
       * let the client fall back to a challenge type that cannot succeed here
       * and report a confusing failure.
       */
      challengePriority: ['http-01'],

      challengeCreateFn: async (_authz, challenge, keyAuthorization) => {
        if (challenge.type !== 'http-01') {
          throw new Error(`Unexpected challenge type ${challenge.type}.`);
        }
        await this.challenges.updateOne(
          { token: challenge.token },
          {
            $set: {
              token: challenge.token,
              keyAuthorization,
              hostname,
              expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
            },
          },
          { upsert: true },
        );
      },

      challengeRemoveFn: async (_authz, challenge) => {
        // Best-effort: the TTL index is the backstop. A failure to clean up
        // must not fail an otherwise successful issuance.
        await this.challenges
          .deleteOne({ token: challenge.token })
          .catch((error: unknown) => {
            this.logger.warn(
              `Could not remove challenge for ${hostname}: ${String(error)}`,
            );
          });
      },
    });

    this.logger.log(`Order complete for ${hostname}; reading the certificate.`);

    const info = acme.crypto.readCertificateInfo(certPem);

    return {
      certPem,
      keyPem: keyBuffer.toString(),
      notBefore: info.notBefore,
      notAfter: info.notAfter,
    };
  }

  private async recordSuccess(
    hostname: string,
    result: {
      certPem: string;
      keyPem: string;
      notBefore: Date;
      notAfter: Date;
    },
  ): Promise<void> {
    const key = readEncryptionKey(
      this.config.get<string>('CERT_ENCRYPTION_KEY'),
    );

    await this.certificates.updateOne(
      { hostname },
      {
        $set: {
          certPem: result.certPem,
          keyPemEncrypted: encryptSecret(result.keyPem, key),
          status: 'active',
          issuedAt: result.notBefore,
          expiresAt: result.notAfter,
          renewAfter: renewalPoint(result.notBefore, result.notAfter),
          failureCount: 0,
          lastError: null,
        },
      },
    );
  }

  /**
   * Record a failed attempt and schedule the next one.
   *
   * ⚠ Note what is *not* cleared: `certPem` and `keyPemEncrypted` survive, and
   * an `active` row stays `active`. A failed renewal must not take the site
   * down — the existing certificate is valid until it expires, and the renewal
   * window is a third of its lifetime precisely so that repeated failures are
   * survivable. Only a hostname that has never had a certificate lands in
   * `failed`, where there is nothing to protect.
   */
  private async recordFailure(hostname: string, error: string): Promise<void> {
    const current = await this.certificates
      .findOne({ hostname })
      .select('status failureCount')
      .lean();

    const failureCount = (current?.failureCount ?? 0) + 1;
    const keepsServing = current?.status === 'active';

    await this.certificates.updateOne(
      { hostname },
      {
        $set: {
          status: keepsServing ? 'active' : 'failed',
          failureCount,
          lastError: error,
          renewAfter: backoffAfterFailure(failureCount, new Date()),
        },
      },
    );
  }

  /**
   * Ensure a certificate row exists for a hostname, without disturbing one that
   * already holds a valid certificate.
   *
   * The worker's own version of `CertificateRegistrationService.register` — the
   * API side cannot be reused here, because the worker boundary forbids
   * importing a feature service across it. The duplication is two lines of
   * `$setOnInsert` and the alternative is relaxing the rule that keeps the
   * worker extractable.
   *
   * Everything is `$setOnInsert` for the same reason as the API side: calling
   * this for a hostname that already has a valid certificate must do nothing.
   * Touching `renewAfter` would drag a perfectly good certificate into the next
   * sweep and re-order it, which is both wasted work and a charge against the
   * CA's duplicate-certificate limit.
   */
  async ensureRegistered(rawHostname: string): Promise<string | null> {
    const hostname = normalizeHostname(rawHostname);
    if (!hostname) return null;

    const now = new Date();
    await this.certificates.updateOne(
      { hostname },
      {
        $setOnInsert: {
          hostname,
          status: 'pending',
          renewAfter: now,
          failureCount: 0,
        },
      },
      { upsert: true },
    );

    return hostname;
  }

  /**
   * Give every hostname that is already serveable a certificate row.
   *
   * ## Why the sweep reconciles instead of only renewing
   * A sweep can only find rows that exist, so it can only ever fix hostnames
   * something else remembered to register. That made registration a single
   * point of failure spread across every code path that can make a hostname
   * serveable — and it was immediately wrong twice: the platform host, which
   * has no "someone added a domain" moment at all, and subdomains, which are
   * created `active` and never pass through `verify`.
   *
   * Both had the same shape: the app routed the hostname happily while the edge
   * refused the TLS handshake, so a browser reported a cancelled request and no
   * log anywhere said why. Reconciling from `agencyDomains` — the actual source
   * of truth for "which hostnames do we serve" — makes that class of bug
   * self-correcting within one sweep instead of permanent.
   *
   * Cheap: an indexed read plus one `$setOnInsert` per hostname, and every
   * upsert after the first is a no-op.
   */
  async reconcileActiveDomains(): Promise<number> {
    if (!this.enabled()) return 0;

    const active = await this.domains
      .find({ status: 'active' })
      .select('hostname')
      .lean();

    let registered = 0;
    for (const domain of active) {
      const known = await this.certificates
        .exists({ hostname: domain.hostname })
        .then((row) => row !== null);
      if (known) continue;

      await this.ensureRegistered(domain.hostname);
      registered += 1;
      this.logger.warn(
        `${domain.hostname} is active but had no certificate row — registered it now.`,
      );
    }

    return registered;
  }

  /**
   * Hostnames whose certificates are due for an issuance attempt.
   *
   * Covers first issuance and renewal with one query, because `renewAfter` is
   * set to "now" on creation and to the renewal point on success — the sweep
   * does not need to know which case it is looking at.
   */
  async findDue(limit: number): Promise<string[]> {
    // Nothing is due in an environment that does not issue. Checked here as
    // well as in `issue` so a disabled environment's sweep does no database
    // work and logs nothing, rather than finding rows every fifteen minutes and
    // declining them one at a time.
    if (!this.enabled()) return [];

    const rows = await this.certificates
      .find({ renewAfter: { $lte: new Date() } })
      .sort({ renewAfter: 1 })
      .limit(limit)
      .select('hostname')
      .lean();

    return rows.map((row) => row.hostname);
  }
}
