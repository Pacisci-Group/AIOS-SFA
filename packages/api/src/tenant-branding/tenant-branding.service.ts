import { createHash } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Agency, AgencyDocument } from '../platform/schemas/agency.schema';
import type { HostTenant } from '../common/tenancy/host-tenant.resolver';
import { TenantUrlService } from '../common/tenancy/tenant-url.service';

/** What the platform is called when no agency branding applies. */
export const PLATFORM_BRAND_NAME = 'AgencyOps';
export const PLATFORM_BRAND_TAGLINE = 'Operations Platform';

/** Which of an agency's two logos to serve. */
export type LogoVariant = 'light' | 'dark';

/**
 * The payload the SPA boots from, and the same shape the email path reads.
 *
 * `kind` is what tells the client whether it is looking at a tenant or at the
 * platform admin app; `logoUrl` is `null` rather than absent when there is no
 * logo, so the caller has one thing to check.
 */
export interface TenantBrandingView {
  kind: 'platform' | 'agency';
  agencyId: string | null;
  /** The wordmark to render. Never empty. */
  name: string;
  tagline: string;
  /** Path on this origin, or `null` when the agency has uploaded no logo. */
  logoUrl: string | null;
  logoDarkUrl: string | null;
  faviconUrl: string | null;
}

/**
 * The brand an outbound email carries. Structurally the templates' `EmailBrand`
 * (`worker/email/templates/layout.ts`), declared here so this module does not
 * import from the worker tier.
 */
export interface OutboundEmailBrand {
  name: string;
  /** Absolute and publicly fetchable, or `null` when there is nothing to show. */
  logoUrl: string | null;
}

/**
 * Resolves what to *show* for a given host.
 *
 * Read by three callers with different needs and one rule: the app shell, the
 * unauthenticated login page, and the email templates. Keeping the fallback
 * chain here — rather than in each of them — is what stops the login page and
 * the sidebar disagreeing about an agency's name.
 *
 * ## Every field falls back
 * An agency created before this feature has no `branding` sub-document at all,
 * and one created yesterday may have a name but no logo. Nothing here may
 * return an empty string or assume a key exists.
 */
@Injectable()
export class TenantBrandingService {
  constructor(
    @InjectModel(Agency.name)
    private readonly agencyModel: Model<AgencyDocument>,
    private readonly tenantUrls: TenantUrlService,
  ) {}

  /**
   * The brand to put on an outbound email about an agency — or `undefined`
   * for a platform message, which the templates render under the platform
   * identity.
   *
   * The logo comes back **absolute, on the agency's own host, or `null`**.
   * A mail client has no origin to resolve a path against, and the logo
   * endpoint resolves the agency from its `Host` — so on the platform host it
   * 404s. An agency that has uploaded a logo but has no verified domain yet is
   * therefore served on the platform host *and* cannot have its logo fetched
   * from there; the only honest brand for it is name-only.
   *
   * One helper because the rule was copied three times (invite email,
   * notification email, push icon) and all three built the URL on
   * `baseUrlFor`, whose platform fallback is right for a link and wrong for
   * an asset — every one of them was a broken image for exactly those
   * agencies (PAC-154 PR3 review).
   */
  async emailBrandFor(
    agencyId: string | null | undefined,
  ): Promise<OutboundEmailBrand | undefined> {
    if (!agencyId) return undefined;

    const branding = await this.forAgency(agencyId);
    if (branding.kind !== 'agency') return undefined;

    const ownBase = branding.logoUrl
      ? await this.tenantUrls.agencyBaseUrlFor(agencyId)
      : null;

    return {
      name: branding.name,
      logoUrl:
        ownBase && branding.logoUrl ? `${ownBase}${branding.logoUrl}` : null,
    };
  }

  /** The default identity, used on the platform host and as every fallback. */
  platformBranding(): TenantBrandingView {
    return {
      kind: 'platform',
      agencyId: null,
      name: PLATFORM_BRAND_NAME,
      tagline: PLATFORM_BRAND_TAGLINE,
      logoUrl: null,
      logoDarkUrl: null,
      faviconUrl: null,
    };
  }

  /**
   * The absolute icon for a web push about an agency: its favicon, else its
   * logo, on its **own** host — else `platformIconPath` on the platform host.
   *
   * Same rule as {@link emailBrandFor}, for the same reason: the favicon and
   * logo endpoints resolve the agency from `Host`, so an agency served on the
   * platform host (no verified domain yet) cannot have either fetched from
   * there. A service worker fetches the icon with no origin of its own, so
   * the URL must be absolute and publicly reachable. The platform icon is a
   * bundled asset the web container serves on every host.
   */
  async pushIconFor(
    agencyId: string | null | undefined,
    platformIconPath: string,
  ): Promise<string> {
    if (agencyId) {
      const branding = await this.forAgency(agencyId);
      const path =
        branding.kind === 'agency'
          ? (branding.faviconUrl ?? branding.logoUrl)
          : null;
      if (path) {
        const ownBase = await this.tenantUrls.agencyBaseUrlFor(agencyId);
        if (ownBase) return `${ownBase}${path}`;
      }
    }
    return `${this.tenantUrls.platformBaseUrl()}${platformIconPath}`;
  }

  /**
   * Branding for the tenant a request's host names.
   *
   * @throws NotFoundException on an unknown host — the same answer
   * `HostTenantGuard` gives, so an unrecognised hostname cannot be probed for
   * which agencies exist.
   */
  async forHost(host: HostTenant | undefined): Promise<TenantBrandingView> {
    if (!host || host.kind === 'unknown') {
      throw new NotFoundException('No application is served on this host');
    }
    if (host.kind === 'platform') {
      return this.platformBranding();
    }
    return this.forAgency(host.agencyId);
  }

  /**
   * Branding for a specific agency, by id.
   *
   * Used by the email path, which knows the agency but has no host. Falls back
   * to the platform identity for an agency that no longer exists rather than
   * throwing: an email must still render if its agency was deleted mid-flight.
   */
  async forAgency(agencyId: string): Promise<TenantBrandingView> {
    if (!Types.ObjectId.isValid(agencyId)) {
      return this.platformBranding();
    }

    const agency = await this.agencyModel
      .findById(agencyId)
      .select('name branding')
      .lean();

    if (!agency) {
      return this.platformBranding();
    }

    const branding = agency.branding ?? {};

    return {
      kind: 'agency',
      agencyId,
      name: branding.displayName?.trim() || agency.name,
      tagline: branding.tagline?.trim() || PLATFORM_BRAND_TAGLINE,
      logoUrl: branding.logoKey ? logoPath('light', branding.logoKey) : null,
      // Falls back to the light key so an agency with one logo gets it in both
      // themes — a missing image is worse than a slightly-wrong one.
      logoDarkUrl: branding.logoDarkKey
        ? logoPath('dark', branding.logoDarkKey)
        : branding.logoKey
          ? logoPath('dark', branding.logoKey)
          : null,
      faviconUrl: branding.faviconKey ? faviconPath(branding.faviconKey) : null,
    };
  }

  /**
   * The object key to stream for one variant, or `null` when there is none.
   *
   * Returns the key rather than the bytes so the controller owns the HTTP
   * concerns (caching, content type) and this stays a pure lookup.
   */
  async logoKeyFor(
    agencyId: string,
    variant: LogoVariant,
  ): Promise<string | null> {
    if (!Types.ObjectId.isValid(agencyId)) return null;

    const agency = await this.agencyModel
      .findById(agencyId)
      .select('branding')
      .lean();

    const branding = agency?.branding;
    if (!branding) return null;

    return variant === 'dark'
      ? (branding.logoDarkKey ?? branding.logoKey ?? null)
      : (branding.logoKey ?? null);
  }

  async faviconKeyFor(agencyId: string): Promise<string | null> {
    if (!Types.ObjectId.isValid(agencyId)) return null;
    const agency = await this.agencyModel
      .findById(agencyId)
      .select('branding')
      .lean();
    return agency?.branding?.faviconKey ?? null;
  }
}

/**
 * Logo and favicon URLs are **paths on the requesting origin**, not absolute
 * URLs and not presigned storage links.
 *
 * Three reasons, and the third is the one that would bite later:
 * 1. Same-origin means no entry in the Spaces CORS allow-list, which is a
 *    static Terraform list that would otherwise need every new tenant domain.
 * 2. A path is stable, so browsers and email clients can cache it. A presigned
 *    URL changes on every request and defeats caching entirely.
 * 3. The endpoint resolves the agency from its own `Host`, so the *same* path
 *    serves a different logo per tenant — which is exactly what lets the email
 *    templates build one absolute URL per agency by prefixing their own host.
 *
 * ## The `v` parameter is what makes the long cache safe
 * The endpoint sends `Cache-Control: max-age=3600`, which is what keeps a
 * hundred-recipient email send from being a hundred storage reads. But the path
 * itself never changes, so without a version an owner who replaces their logo
 * watches the old one persist for an hour and reasonably concludes the upload
 * failed.
 *
 * The version is a hash of the **object key**, and every upload mints a fresh
 * UUID key — so replacing an image changes the URL, and *not* replacing it
 * leaves the URL byte-identical so the cached copy is still used. A timestamp
 * would break the cache on every page load instead.
 */
function logoPath(variant: LogoVariant, key: string): string {
  return `/api/v1/public/tenant/logo?variant=${variant}&v=${versionOf(key)}`;
}

function faviconPath(key: string): string {
  return `/api/v1/public/tenant/favicon?v=${versionOf(key)}`;
}

/** Short, stable fingerprint of an object key. Not a security boundary. */
function versionOf(key: string): string {
  return createHash('sha1').update(key).digest('hex').slice(0, 8);
}
