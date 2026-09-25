import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  AgencyDomain,
  AgencyDomainDocument,
} from '../../platform/schemas/agency-domain.schema';
import { PUBLIC_FORM_BASE_URL } from '../../config/public-form.config';
import { platformHost } from '../../config/tenant-host.config';

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
   * still served on the platform host, so the link it produces is correct —
   * which is precisely why {@link platformBaseUrl} has to answer with the
   * *platform host* and not merely with `APP_BASE_URL`.
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
   * `<scheme>//<hostname>[:<port>]`, with scheme and port inherited from
   * `APP_BASE_URL`. Falls back to `https://` if that URL does not parse —
   * an unparseable `APP_BASE_URL` is a deploy bug, and a secure link is the
   * safer wrong answer.
   */
  private originFor(hostname: string): string {
    try {
      const configured = new URL(this.configuredBaseUrl());
      const port = configured.port ? `:${configured.port}` : '';
      return `${configured.protocol}//${hostname}${port}`;
    } catch {
      return `https://${hostname}`;
    }
  }

  /**
   * `APP_BASE_URL` as configured — the source of the **scheme and port** for
   * every link, and of the hostname only when `PLATFORM_HOST` is unset.
   *
   * Deliberately not public: a call site that wants "where do platform links
   * go" wants {@link platformBaseUrl}, which is the same value in production
   * and the correct one everywhere else.
   */
  private configuredBaseUrl(): string {
    const configured = this.config.get<string>('APP_BASE_URL');
    return (configured ?? PUBLIC_FORM_BASE_URL).replace(/\/+$/, '');
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
   * Where links go when no agency host applies: the origin of **`PLATFORM_HOST`**,
   * with the scheme and port of `APP_BASE_URL`.
   *
   * This used to return `APP_BASE_URL` verbatim, which is right only while the
   * two agree — and they do not have to. `PLATFORM_HOST` is the *one* hostname
   * `HostTenantResolver` answers as `platform`; every other host resolves to
   * `unknown` and `HostTenantGuard` 404s it. So when they disagree, this
   * produced links onto a host that serves nothing, for exactly the users the
   * fallback exists to protect: an agency with no domain of its own (the
   * bootstrap case) plus every platform admin.
   *
   * That is the local default (`PLATFORM_HOST=app.sfa.local`,
   * `APP_BASE_URL=http://localhost:5173`), and the impersonation handoff is
   * where it bites hardest — it *navigates* the browser to this origin (PAC-70),
   * so a super admin impersonating a domainless agency's user landed on
   * `localhost:5173`, where the session they were just handed is refused. The
   * invite and password-reset links for those agencies had the same fault, more
   * quietly.
   *
   * Deriving the host rather than the whole URL keeps `APP_BASE_URL` doing the
   * job it documents — the public origin, and the only place a scheme or port
   * is written down — while `PLATFORM_HOST` stays the single source of truth
   * for *which* host is the platform's. Where it is unset, `platformHost()`
   * falls back to `APP_BASE_URL`'s own host, so a deployment that sets only
   * `APP_BASE_URL` is unchanged, byte for byte.
   *
   * ⚠ Returns an **origin**: any path on `APP_BASE_URL` is dropped. That was
   * already true of every agency-host link (`originFor`), and `APP_BASE_URL` is
   * documented as an origin — but it is a behaviour change for a deployment
   * that had smuggled a path prefix through here.
   */
  platformBaseUrl(): string {
    return this.originFor(
      platformHost(
        this.config.get<string>('PLATFORM_HOST'),
        this.configuredBaseUrl(),
      ),
    );
  }
}
