import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { buildFromHeader } from '../common/mail/sender-address';
import { isValidHostname, normalizeHostname } from '../common/tenancy/hostname';
import { Agency, AgencyDocument } from '../platform/schemas/agency.schema';
import type {
  AgencyEmailView,
  SetSendingDomainDto,
  UpdateAgencyEmailDto,
} from './dto/agency-email.dto';
import {
  EmailProviderClient,
  type SendingDnsRecord,
} from './email-provider.client';

/** Mirrors the worker's fallback so `effectiveFrom` is never a guess. */
const DEFAULT_FROM = 'AgencyOps <onboarding@resend.dev>';

@Injectable()
export class AgencyEmailService {
  constructor(
    @InjectModel(Agency.name)
    private readonly agencyModel: Model<AgencyDocument>,
    private readonly provider: EmailProviderClient,
    private readonly config: ConfigService,
  ) {}

  async get(agencyId: string): Promise<AgencyEmailView> {
    const agency = await this.loadAgency(agencyId);
    return this.toView(agency, this.cachedRecords(agency));
  }

  /**
   * Edit the display name, sending mailbox and reply-to.
   *
   * None of these needs verification: `fromName` and `replyTo` carry no
   * authentication requirement at all, and `fromLocalPart` only takes effect
   * once a domain is verified. So an owner can set them at any point, including
   * before they have decided whether to bother with a custom domain.
   */
  async update(
    agencyId: string,
    dto: UpdateAgencyEmailDto,
  ): Promise<AgencyEmailView> {
    const agency = await this.loadAgency(agencyId);
    agency.email ??= {
      sendingStatus: 'platform',
      verifiedAt: null,
      lastError: null,
    };

    if (dto.fromName !== undefined) {
      agency.email.fromName = dto.fromName ?? undefined;
    }
    if (dto.fromLocalPart !== undefined) {
      agency.email.fromLocalPart = dto.fromLocalPart ?? undefined;
    }
    if (dto.replyTo !== undefined) {
      agency.email.replyTo = dto.replyTo ?? undefined;
    }

    agency.markModified('email');
    await agency.save();

    return this.toView(agency, this.cachedRecords(agency));
  }

  /**
   * Register a sending domain with the provider and hand back the DNS records
   * the owner has to publish.
   *
   * Lands in `pending`, never `verified` — DNS has not been checked yet, and
   * `SenderIdentityService` keys off this exact field to decide whether it may
   * send from the domain. Until it flips, mail keeps going out from the
   * platform address, which is the correct behaviour and not a degradation.
   */
  async setSendingDomain(
    agencyId: string,
    dto: SetSendingDomainDto,
  ): Promise<AgencyEmailView> {
    const domain = normalizeHostname(dto.domain);
    if (!domain || !isValidHostname(domain)) {
      throw new BadRequestException(
        'That is not a valid domain name. Use the form "example.com".',
      );
    }

    const agency = await this.loadAgency(agencyId);
    agency.email ??= {
      sendingStatus: 'platform',
      verifiedAt: null,
      lastError: null,
    };

    if (
      agency.email.sendingDomain === domain &&
      agency.email.sendingStatus === 'verified'
    ) {
      throw new ConflictException('That domain is already verified.');
    }

    // Registering a second domain while a first is live would leave two
    // provider-side records and no way to tell which one `fromLocalPart`
    // belongs to. Replacing is the honest operation.
    if (agency.email.providerDomainId) {
      await this.provider.removeDomain(agency.email.providerDomainId);
    }

    const created = await this.provider.createDomain(domain);

    agency.email.sendingDomain = domain;
    agency.email.providerDomainId = created.providerDomainId;
    agency.email.sendingStatus =
      created.status === 'verified' ? 'verified' : 'pending';
    agency.email.verifiedAt = created.status === 'verified' ? new Date() : null;
    agency.email.lastError = null;

    this.cacheRecords(agency, created.records);
    agency.markModified('email');
    await agency.save();

    return this.toView(agency, created.records);
  }

  /**
   * Ask the provider to re-check DNS, then store what it now reports.
   *
   * Safe to call repeatedly — it is a DNS re-check, and an owner watching for
   * propagation will press it several times.
   */
  async verifySendingDomain(agencyId: string): Promise<AgencyEmailView> {
    const agency = await this.loadAgency(agencyId);
    const providerDomainId = agency.email?.providerDomainId;

    if (!providerDomainId) {
      throw new BadRequestException('Add a sending domain first.');
    }

    const result = await this.provider.verifyDomain(providerDomainId);

    agency.email.sendingStatus =
      result.status === 'verified' ? 'verified' : result.status;
    agency.email.verifiedAt =
      result.status === 'verified' ? new Date() : agency.email.verifiedAt;
    agency.email.lastError =
      result.status === 'verified'
        ? null
        : 'DNS records are not visible yet. They can take up to 72 hours to publish — check them and try again.';

    this.cacheRecords(agency, result.records);
    agency.markModified('email');
    await agency.save();

    return this.toView(agency, result.records);
  }

  /**
   * Drop the custom domain and go back to the platform sender.
   *
   * Deliberately always available, including while `verified`. This is the
   * recovery path when an agency's DNS changes underneath them and their email
   * silently stops arriving — the fastest fix is to fall back to an address
   * that certainly works.
   */
  async clearSendingDomain(agencyId: string): Promise<AgencyEmailView> {
    const agency = await this.loadAgency(agencyId);

    if (agency.email?.providerDomainId) {
      await this.provider.removeDomain(agency.email.providerDomainId);
    }

    agency.email.sendingDomain = undefined;
    agency.email.providerDomainId = undefined;
    agency.email.sendingStatus = 'platform';
    agency.email.verifiedAt = null;
    agency.email.lastError = null;

    this.cacheRecords(agency, null);
    agency.markModified('email');
    await agency.save();

    return this.toView(agency, null);
  }

  private toView(
    agency: AgencyDocument,
    records: SendingDnsRecord[] | null,
  ): AgencyEmailView {
    const settings = agency.email ?? { sendingStatus: 'platform' as const };
    const displayName =
      settings.fromName?.trim() ||
      agency.branding?.displayName?.trim() ||
      agency.name;

    return {
      fromName: settings.fromName ?? null,
      fromLocalPart: settings.fromLocalPart ?? null,
      replyTo: settings.replyTo ?? null,
      sendingDomain: settings.sendingDomain ?? null,
      sendingStatus: settings.sendingStatus ?? 'platform',
      verifiedAt: settings.verifiedAt?.toISOString() ?? null,
      lastError: settings.lastError ?? null,
      // Computed with the *same* helper the worker uses to build the real
      // header, so this cannot drift into telling an owner something untrue.
      effectiveFrom: buildFromHeader(
        settings,
        displayName,
        this.config.get<string>('MAIL_DEFAULT_FROM') ?? DEFAULT_FROM,
      ),
      dnsRecords: settings.sendingStatus === 'verified' ? null : records,
    };
  }

  /**
   * The provider's DNS records, kept on the agency's `settings` bag.
   *
   * Cached because they are only returned by a `create`/`verify` round trip,
   * and an owner who reloads the settings page between attempts must still see
   * the records they are supposed to be publishing. Parked in `settings` rather
   * than given a schema field: they are opaque provider output we never query
   * on, and re-fetchable at any time.
   *
   * Mutates only — the caller owns the single `save()`. Saving here as well
   * would write the document twice per request and, worse, leave the two writes
   * able to disagree if the second failed.
   */
  private cacheRecords(
    agency: AgencyDocument,
    records: SendingDnsRecord[] | null,
  ): void {
    const settings = { ...agency.settings };
    if (records) {
      settings.emailDnsRecords = records;
    } else {
      delete settings.emailDnsRecords;
    }
    agency.settings = settings;
    agency.markModified('settings');
  }

  private cachedRecords(agency: AgencyDocument): SendingDnsRecord[] | null {
    const cached = agency.settings?.emailDnsRecords;
    return Array.isArray(cached) ? (cached as SendingDnsRecord[]) : null;
  }

  private async loadAgency(agencyId: string): Promise<AgencyDocument> {
    if (!Types.ObjectId.isValid(agencyId)) {
      throw new NotFoundException('Agency not found');
    }
    const agency = await this.agencyModel.findById(agencyId);
    if (!agency) {
      throw new NotFoundException('Agency not found');
    }
    return agency;
  }
}
