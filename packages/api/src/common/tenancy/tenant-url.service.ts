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
   * `https://<the agency's primary host>`, or the platform default when the
   * agency has no active domain yet.
   *
   * The fallback is not a nicety — it is what keeps invites working for every
   * agency that existed before this feature and for a new tenant during the
   * window between "created" and "domain verified". An agency in that state is
   * still served on the platform host, so the link it produces is correct.
   *
   * Always `https`. The one caller that legitimately wants plain HTTP is local
   * development, and there the env fallback already carries its own scheme.
   */
  async baseUrlFor(agencyId: string | null | undefined): Promise<string> {
    const hostname = await this.primaryHostFor(agencyId);
    return hostname ? `https://${hostname}` : this.platformBaseUrl();
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
