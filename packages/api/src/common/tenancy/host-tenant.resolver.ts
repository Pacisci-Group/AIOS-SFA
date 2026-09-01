import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  AgencyDomain,
  AgencyDomainDocument,
} from '../../platform/schemas/agency-domain.schema';
import { baseDomain, platformHost } from '../../config/tenant-host.config';
import { normalizeHostname } from './hostname';

/**
 * Which tenant, if any, a request's hostname belongs to.
 *
 * `unknown` is a first-class outcome, not an error: the droplet has a public IP
 * and answers on it, so scanners and stale DNS reach us constantly with hosts
 * that mean nothing. They get a 404, not a tenant.
 */
export type HostTenant =
  | { kind: 'platform'; hostname: string }
  | { kind: 'agency'; agencyId: string; hostname: string }
  | { kind: 'unknown'; hostname: string | null };

/**
 * How long a resolution is trusted before it is looked up again.
 *
 * Short, because it bounds how long a just-activated domain keeps 404ing and
 * how long a just-deleted one keeps working. Explicit invalidation handles the
 * same-process case immediately; the TTL is what covers a second API container
 * that never saw the write.
 */
const POSITIVE_TTL_MS = 60_000;

/**
 * Unknown hosts expire faster than known ones.
 *
 * Deliberately asymmetric. A negative entry is the difference between a port
 * scan costing one database query and costing thousands, but it is also exactly
 * what makes a newly-added domain appear dead for its owner — who is, at that
 * moment, refreshing the page. Fifteen seconds keeps the shield and keeps the
 * wait short enough to read as loading rather than broken.
 */
const NEGATIVE_TTL_MS = 15_000;

interface CacheEntry {
  value: HostTenant;
  expiresAt: number;
}

/**
 * Resolves a `Host` header to a tenant.
 *
 * ## The Host header is client-controlled
 * Anyone can send any `Host`. This resolver therefore only ever **restricts**
 * access, never grants it: the worst a spoofed header achieves is the access
 * the caller would already have had by typing that hostname into a browser.
 * `HostTenantGuard` still checks the authenticated user's own `agencyId`, so a
 * forged host cannot move a user into a tenant they do not belong to.
 *
 * This is the same caution `TrustedProxyThrottlerGuard` documents for
 * `X-Forwarded-For`, and it must survive any future change here: **never use
 * the resolved agency as the sole basis for granting access to data.**
 *
 * ## Why an in-process cache rather than Redis
 * This runs on *every* request, including public ones, which is a heavier read
 * path than the permission cache. The domain table is small, nearly static, and
 * identical for every process, so a per-process map costs a few kilobytes and
 * saves a round trip that Redis would still have to make. The cost is that a
 * second API container can serve a stale answer for up to {@link POSITIVE_TTL_MS};
 * for a routing table that changes when an agency is onboarded, that is the
 * right trade. Revisit it if domains ever become high-churn.
 */
@Injectable()
export class HostTenantResolver implements OnModuleInit {
  private readonly logger = new Logger(HostTenantResolver.name);
  private readonly cache = new Map<string, CacheEntry>();
  /** `agencyId -> has at least one active domain`. See `agencyHasDomains`. */
  private readonly agencyDomainCache = new Map<
    string,
    { value: boolean; expiresAt: number }
  >();

  constructor(
    @InjectModel(AgencyDomain.name)
    private readonly domainModel: Model<AgencyDomainDocument>,
    private readonly config: ConfigService,
  ) {}

  /** The hostname the super-admin app answers on. */
  get platformHostname(): string {
    return platformHost(
      this.config.get<string>('PLATFORM_HOST'),
      this.config.get<string>('APP_BASE_URL'),
    );
  }

  /** The zone agency subdomains hang off, or `null` when none is configured. */
  get baseDomain(): string | null {
    return baseDomain(this.config.get<string>('BASE_DOMAIN'));
  }

  async resolve(rawHost: string | undefined | null): Promise<HostTenant> {
    const hostname = normalizeHostname(rawHost);
    if (!hostname) {
      return { kind: 'unknown', hostname: null };
    }

    const cached = this.cache.get(hostname);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const resolved = await this.lookup(hostname);

    this.cache.set(hostname, {
      value: resolved,
      expiresAt:
        Date.now() +
        (resolved.kind === 'unknown' ? NEGATIVE_TTL_MS : POSITIVE_TTL_MS),
    });

    return resolved;
  }

  /**
   * Whether an agency has any hostname of its own yet.
   *
   * Backs the **platform-host fallback**: an agency with no active domain is
   * still allowed to sign in on the platform host, because otherwise it has
   * nowhere at all to sign in — its own address does not exist yet.
   *
   * Without this, deploying white-labelling would lock every pre-existing
   * agency out of the product on the first request: agency users are refused on
   * the platform host, and no agency host exists until someone signs in and
   * creates one. That is a bootstrap deadlock, and it closes on its own the
   * moment an agency gets its first domain.
   *
   * Cached on the same TTL as host resolution, and invalidated by every domain
   * write, so an agency's first domain takes effect immediately rather than
   * leaving its staff able to use the platform host for another minute.
   */
  async agencyHasDomains(agencyId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(agencyId)) return false;

    const cached = this.agencyDomainCache.get(agencyId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const domain = await this.domainModel
      .findOne({ agencyId: new Types.ObjectId(agencyId), status: 'active' })
      .select('_id')
      .lean();

    const value = !!domain;
    this.agencyDomainCache.set(agencyId, {
      value,
      expiresAt: Date.now() + POSITIVE_TTL_MS,
    });
    return value;
  }

  private async lookup(hostname: string): Promise<HostTenant> {
    // The platform host wins over any domain row. A row claiming it should be
    // impossible (the reserved-label check rejects it), but if one ever existed
    // it would lock every super admin out of the platform — so this ordering is
    // the backstop, not the check.
    if (hostname === this.platformHostname) {
      return { kind: 'platform', hostname };
    }

    const domain = await this.domainModel
      .findOne({ hostname, status: 'active' })
      .select('agencyId')
      .lean();

    if (!domain) {
      return { kind: 'unknown', hostname };
    }

    return {
      kind: 'agency',
      agencyId: domain.agencyId.toString(),
      hostname,
    };
  }

  /**
   * Forget one hostname (or everything, with no argument).
   *
   * Called by every write path in `AgencyDomainsService` so an owner who adds,
   * verifies or removes a domain sees the effect on their next request rather
   * than after the TTL. Clearing wholesale is correct for a status change that
   * could affect the primary-host choice.
   */
  invalidate(rawHost?: string): void {
    // Always cleared: a domain write can flip an agency between "has a host"
    // and "does not", which decides whether its staff may still use the
    // platform host. Keyed by agency rather than hostname, so there is nothing
    // to selectively evict from the host argument alone.
    this.agencyDomainCache.clear();

    if (!rawHost) {
      this.cache.clear();
      return;
    }
    const hostname = normalizeHostname(rawHost);
    if (hostname) {
      this.cache.delete(hostname);
    }
  }

  /** Log the host configuration once at startup — silent misconfiguration here
   * presents as "nobody can log in", which is expensive to diagnose blind. */
  onModuleInit(): void {
    const base = this.baseDomain;
    this.logger.log(
      `Platform host: ${this.platformHostname}; agency subdomains: ${
        base ? `*.${base}` : 'disabled (BASE_DOMAIN not set)'
      }`,
    );
  }
}
