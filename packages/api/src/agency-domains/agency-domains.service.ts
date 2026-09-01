import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { HostTenantResolver } from '../common/tenancy/host-tenant.resolver';
import {
  isValidHostname,
  normalizeHostname,
  RESERVED_SUBDOMAIN_LABELS,
  subdomainLabelOf,
} from '../common/tenancy/hostname';
import {
  AgencyDomain,
  AgencyDomainDocument,
} from '../platform/schemas/agency-domain.schema';
import {
  DnsVerifier,
  VERIFICATION_TXT_LABEL,
  VERIFICATION_TXT_PREFIX,
} from './dns-verifier';
import type {
  AgencyDomainView,
  CreateAgencyDomainDto,
  DnsInstruction,
} from './dto/agency-domain.dto';

@Injectable()
export class AgencyDomainsService {
  constructor(
    @InjectModel(AgencyDomain.name)
    private readonly domainModel: Model<AgencyDomainDocument>,
    private readonly hostResolver: HostTenantResolver,
    private readonly dns: DnsVerifier,
    private readonly config: ConfigService,
  ) {}

  async list(agencyId: string): Promise<AgencyDomainView[]> {
    const domains = await this.domainModel
      .find({ agencyId: new Types.ObjectId(agencyId) })
      .sort({ isPrimary: -1, createdAt: 1 })
      .lean();

    return domains.map((d) => this.toView(d));
  }

  /**
   * Claim a hostname for an agency.
   *
   * A subdomain of our own zone is created **active** — we control that zone,
   * the wildcard DNS record already resolves it, and the wildcard certificate
   * already covers it, so there is nothing left to prove or wait for.
   *
   * A custom domain is created **pending** with a fresh token. It serves
   * nothing until {@link verify} passes.
   */
  async create(
    agencyId: string,
    dto: CreateAgencyDomainDto,
  ): Promise<AgencyDomainView> {
    const hostname = normalizeHostname(dto.hostname);
    if (!hostname || !isValidHostname(hostname)) {
      throw new BadRequestException(
        'That is not a valid domain name. Use the form "example.com".',
      );
    }

    if (hostname === this.hostResolver.platformHostname) {
      throw new ConflictException('That address is not available.');
    }

    if (dto.kind === 'subdomain') {
      this.assertClaimableSubdomain(hostname);
    } else {
      this.assertNotOurZone(hostname);
    }

    // Nothing else may already hold the name — the unique index enforces this,
    // but checking first turns a driver-level 409 into a sentence the owner can
    // act on. `MongoDuplicateKeyFilter` still catches the race.
    const existing = await this.domainModel.findOne({ hostname }).lean();
    if (existing) {
      throw new ConflictException(
        existing.agencyId.toString() === agencyId
          ? 'You have already added that domain.'
          : 'That domain is already in use.',
      );
    }

    const isSubdomain = dto.kind === 'subdomain';
    const created = await this.domainModel.create({
      agencyId: new Types.ObjectId(agencyId),
      hostname,
      kind: dto.kind,
      status: isSubdomain ? 'active' : 'pending',
      verifiedAt: isSubdomain ? new Date() : null,
      verificationToken: isSubdomain
        ? undefined
        : randomBytes(16).toString('hex'),
      // First active domain an agency gets becomes its primary, so outbound
      // links start using it without anyone having to know the setting exists.
      isPrimary: isSubdomain && !(await this.hasPrimary(agencyId)),
    });

    this.hostResolver.invalidate(hostname);
    return this.toView(created.toObject());
  }

  /**
   * Re-check a pending or failed custom domain's DNS.
   *
   * Idempotent and safe to hammer — it is a read of public DNS. An already
   * active domain returns unchanged rather than erroring: the owner pressing
   * "Verify" again on something that works should be told it works.
   */
  async verify(agencyId: string, domainId: string): Promise<AgencyDomainView> {
    const domain = await this.findOwned(agencyId, domainId);

    if (domain.status === 'active') {
      return this.toView(domain.toObject());
    }
    if (!domain.verificationToken) {
      throw new BadRequestException('This domain does not need verification.');
    }

    const ownership = await this.dns.hasVerificationToken(
      domain.hostname,
      domain.verificationToken,
    );

    domain.lastCheckedAt = new Date();

    if (!ownership.ok) {
      domain.status = 'failed';
      domain.lastError = ownership.detail;
      await domain.save();
      // Invalidate anyway: a domain moving out of `active` must stop resolving
      // immediately, and this method is the only path that can demote one.
      this.hostResolver.invalidate(domain.hostname);
      return this.toView(domain.toObject());
    }

    // Ownership is proven, so the claim is granted. Routing is checked second
    // and only shapes the message — a domain that is provably theirs but not
    // yet pointed here is activated, because the DNS propagation they are
    // waiting on is the same DNS propagation that would fail this check.
    const routing = await this.dns.pointsAtUs(
      domain.hostname,
      this.hostResolver.platformHostname,
      this.serverIps(),
    );

    domain.status = 'active';
    domain.verifiedAt = new Date();
    domain.lastError = routing.ok
      ? null
      : `Ownership verified, but ${routing.detail}`;

    if (!(await this.hasPrimary(agencyId))) {
      domain.isPrimary = true;
    }

    await domain.save();
    this.hostResolver.invalidate(domain.hostname);
    return this.toView(domain.toObject());
  }

  /**
   * Move the "primary" flag, which decides the host in outbound links.
   *
   * Two writes rather than one because the partial unique index on
   * `{ agencyId, isPrimary: true }` will reject a second primary — the old one
   * has to be cleared first. Not a transaction: the worst interleaving leaves
   * the agency with *no* primary for a moment, and `TenantUrlService` falls
   * back to any active domain, so links keep working. The opposite ordering
   * would fail the index and leave the old primary in place, which is a
   * silently ignored click.
   */
  async setPrimary(
    agencyId: string,
    domainId: string,
  ): Promise<AgencyDomainView> {
    const domain = await this.findOwned(agencyId, domainId);

    if (domain.status !== 'active') {
      throw new BadRequestException(
        'Verify this domain before making it the primary address.',
      );
    }

    await this.domainModel.updateMany(
      { agencyId: new Types.ObjectId(agencyId), isPrimary: true },
      { $set: { isPrimary: false } },
    );

    domain.isPrimary = true;
    await domain.save();

    this.hostResolver.invalidate();
    return this.toView(domain.toObject());
  }

  async remove(agencyId: string, domainId: string): Promise<void> {
    const domain = await this.findOwned(agencyId, domainId);
    const hostname = domain.hostname;

    await domain.deleteOne();
    this.hostResolver.invalidate(hostname);
  }

  /**
   * Caddy's on-demand-TLS gate: may we obtain a certificate for this hostname?
   *
   * Answers true **only** for an active domain or the platform host. This is
   * the whole defence against certificate-issuance abuse: the droplet has a
   * public IP and answers on 443, so without it anyone could point any domain
   * at us and make us request a Let's Encrypt certificate for it — burning a
   * shared rate limit that, once exhausted, stops issuing for our real domains
   * too.
   */
  async isCertificateAllowed(rawHost: string | undefined): Promise<boolean> {
    const host = await this.hostResolver.resolve(rawHost);
    return host.kind !== 'unknown';
  }

  /** Reject anything that is not a free label directly under our own zone. */
  private assertClaimableSubdomain(hostname: string): void {
    const base = this.hostResolver.baseDomain;
    if (!base) {
      throw new BadRequestException(
        'Subdomains are not available on this deployment. Add a custom domain instead.',
      );
    }

    const label = subdomainLabelOf(hostname, base);
    if (!label) {
      throw new BadRequestException(
        `A subdomain must look like "youragency.${base}".`,
      );
    }

    if (RESERVED_SUBDOMAIN_LABELS.has(label)) {
      throw new ConflictException(
        `"${label}" is reserved. Choose another name.`,
      );
    }
  }

  /**
   * A "custom" domain must not be inside our own zone.
   *
   * Otherwise an agency could add `app.smithfamily.agency` — or any other
   * label we rely on — through the path that skips the reserved-label check,
   * and the reserved list would protect nothing.
   */
  private assertNotOurZone(hostname: string): void {
    const base = this.hostResolver.baseDomain;
    if (base && (hostname === base || hostname.endsWith(`.${base}`))) {
      throw new BadRequestException(
        `Addresses under ${base} are added as a subdomain, not a custom domain.`,
      );
    }
  }

  private async hasPrimary(agencyId: string): Promise<boolean> {
    const primary = await this.domainModel
      .findOne({ agencyId: new Types.ObjectId(agencyId), isPrimary: true })
      .select('_id')
      .lean();
    return !!primary;
  }

  private async findOwned(
    agencyId: string,
    domainId: string,
  ): Promise<AgencyDomainDocument> {
    if (!Types.ObjectId.isValid(domainId)) {
      throw new NotFoundException('Domain not found');
    }

    // Scoped by agency in the query, not checked after loading: a domain
    // belonging to another tenant must be indistinguishable from one that does
    // not exist.
    const domain = await this.domainModel.findOne({
      _id: new Types.ObjectId(domainId),
      agencyId: new Types.ObjectId(agencyId),
    });

    if (!domain) {
      throw new NotFoundException('Domain not found');
    }
    return domain;
  }

  /** Public IPs a custom domain's A record may point at. */
  private serverIps(): string[] {
    return (this.config.get<string>('PUBLIC_SERVER_IPS') ?? '')
      .split(',')
      .map((ip) => ip.trim())
      .filter(Boolean);
  }

  private toView(
    domain: AgencyDomain & { _id: Types.ObjectId },
  ): AgencyDomainView {
    return {
      id: domain._id.toString(),
      hostname: domain.hostname,
      kind: domain.kind,
      status: domain.status,
      isPrimary: domain.isPrimary,
      verifiedAt: domain.verifiedAt?.toISOString() ?? null,
      lastCheckedAt: domain.lastCheckedAt?.toISOString() ?? null,
      lastError: domain.lastError,
      dnsInstructions: this.instructionsFor(domain),
    };
  }

  /**
   * The records the owner still has to publish.
   *
   * Returned on every non-active custom domain, including `failed` — a failed
   * check is exactly the moment someone needs to re-read what they were meant
   * to add.
   */
  private instructionsFor(domain: AgencyDomain): DnsInstruction[] | null {
    if (domain.kind !== 'custom' || domain.status === 'active') {
      return null;
    }
    if (!domain.verificationToken) {
      return null;
    }

    const instructions: DnsInstruction[] = [
      {
        type: 'TXT',
        name: `${VERIFICATION_TXT_LABEL}.${domain.hostname}`,
        value: `${VERIFICATION_TXT_PREFIX}${domain.verificationToken}`,
        purpose: 'Proves you control this domain.',
      },
    ];

    const ips = this.serverIps();
    instructions.push(
      // An apex domain cannot carry a CNAME (RFC 1034), so which of these
      // applies depends on whether they are pointing the bare domain or a
      // subdomain of their own. Both are shown rather than guessed.
      {
        type: 'CNAME',
        name: domain.hostname,
        value: this.hostResolver.platformHostname,
        purpose: 'Sends visitors to your app. Use this for a subdomain.',
      },
    );
    if (ips.length) {
      instructions.push({
        type: 'A',
        name: domain.hostname,
        value: ips.join(', '),
        purpose:
          'Use this instead of the CNAME if you are pointing the bare domain — an apex domain cannot use a CNAME.',
      });
    }

    return instructions;
  }
}
