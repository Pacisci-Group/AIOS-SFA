import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  AgencyDomain,
  AgencyDomainDocument,
} from '../../platform/schemas/agency-domain.schema';
import { PUBLIC_FORM_BASE_URL } from '../../config/public-form.config';

/**
 * Which absolute URL an agency's outbound links should point at.
 *
 * Every link we put in front of a human — an invite email, a lead share link,
 * the logo `<img src>` inside an email — has to land on **that agency's** host.
 * Send a Texas Holdings employee a `app.smithfamily.agency` invite and it does
 * not merely look wrong: `HostTenantGuard` rejects them there, so the link is
 * broken as well as off-brand.
 *
 * One service rather than a helper per call site because the fallback rule is
 * the part that is easy to get subtly different, and getting it wrong is
 * invisible until an agency without a domain stops receiving invites.
 */
@Injectable()
export class TenantUrlService {
  constructor(
    @InjectModel(AgencyDomain.name)
    private readonly domainModel: Model<AgencyDomainDocument>,
    private readonly config: ConfigService,
  ) {}

  /**
   * The agency's primary host as an origin, or the platform default when the
   * agency has no active domain yet.
   *
   * The fallback is not a nicety — it is what keeps invites working for every
   * agency that existed before this feature and for a new tenant during the
   * window between "created" and "domain verified". An agency in that state is
   * still served on the platform host, so the link it produces is correct.
   *
   * The scheme and port come from `APP_BASE_URL`, not a hard-coded `https`.
   * In production that is `https://` with no port, so the result is exactly
   * `https://<host>`. Locally it is `http://…:5173`, and an agency host there
   * is `http://texasholdings.sfa.local:5173` — the address Vite actually
   * serves — rather than an `https://` link nothing answers. That matters
   * beyond convenience since PAC-70: the impersonation handoff navigates the
   * browser to this origin, so a dead scheme is a dead feature in dev.
   */
  async baseUrlFor(agencyId: string | null | undefined): Promise<string> {
    const hostname = await this.primaryHostFor(agencyId);
    return hostname ? this.originFor(hostname) : this.platformBaseUrl();
  }

  /**
   * `<scheme>//<hostname>[:<port>]`, with scheme and port inherited from the
   * platform base URL. Falls back to `https://` if that URL does not parse —
   * an unparseable `APP_BASE_URL` is a deploy bug, and a secure link is the
   * safer wrong answer.
   */
  private originFor(hostname: string): string {
    try {
      const platform = new URL(this.platformBaseUrl());
      const port = platform.port ? `:${platform.port}` : '';
      return `${platform.protocol}//${hostname}${port}`;
    } catch {
      return `https://${hostname}`;
    }
  }

  /**
   * The agency's primary hostname, or `null`.
   *
   * Prefers the row explicitly marked primary; falls back to any active domain
   * so an agency that has one verified domain but never pressed "make primary"
   * still gets branded links rather than silently dropping to the platform
   * host. Ordered by `createdAt` so that fallback is stable between calls —
   * an unstable choice would mean two invites sent minutes apart pointing at
   * different hosts.
   */
  async primaryHostFor(
    agencyId: string | null | undefined,
  ): Promise<string | null> {
    if (!agencyId || !Types.ObjectId.isValid(agencyId)) {
      return null;
    }

    const domain = await this.domainModel
      .findOne({ agencyId: new Types.ObjectId(agencyId), status: 'active' })
      .select('hostname isPrimary')
      .sort({ isPrimary: -1, createdAt: 1 })
      .lean();

    return domain?.hostname ?? null;
  }

  /**
   * Where links go when no agency host applies.
   *
   * `APP_BASE_URL` first — it is what `UsersService.buildInviteUrl` has always
   * used and is the one people-facing base URL the deploy already sets — then
   * the share-link constant, which carries the same value in every environment
   * that sets both.
   */
  platformBaseUrl(): string {
    const configured = this.config.get<string>('APP_BASE_URL');
    return (configured ?? PUBLIC_FORM_BASE_URL).replace(/\/+$/, '');
  }
}
