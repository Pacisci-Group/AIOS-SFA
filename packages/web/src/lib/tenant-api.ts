import { ApiError, publicFetch } from '@/lib/api-client';

/** The branding payload `GET /public/tenant` returns. */
export interface TenantBranding {
  kind: 'platform' | 'agency';
  agencyId: string | null;
  /** Wordmark. Never empty — the API's fallback chain guarantees it. */
  name: string;
  tagline: string;
  /** Path on this origin, or `null` when the agency uploaded no logo. */
  logoUrl: string | null;
  logoDarkUrl: string | null;
  faviconUrl: string | null;
}

/** What the app shows when the host serves no tenant, or the fetch failed. */
export const PLATFORM_BRANDING: TenantBranding = {
  kind: 'platform',
  agencyId: null,
  name: 'AgencyOps',
  tagline: 'Operations Platform',
  logoUrl: null,
  logoDarkUrl: null,
  faviconUrl: null,
};

/**
 * Where the cached payload lives, keyed by host.
 *
 * **Keyed by host, not global**, because one browser can legitimately hold
 * sessions on several tenant hostnames and a shared key would repaint each with
 * the last one's brand. Must stay in sync with the pre-paint script in
 * `index.html`, which reads the same key before React exists.
 */
export function tenantCacheKey(host = window.location.host): string {
  return `tenant:${host}`;
}

/**
 * Read the cached branding, or `null`.
 *
 * Used to render the correct wordmark on the very first paint, before the fetch
 * resolves. A stale value here is harmless — the fetch overwrites it a moment
 * later — whereas *no* value means every returning user watches the app flash
 * "AgencyOps" before becoming their own agency.
 */
export function readCachedBranding(): TenantBranding | null {
  try {
    const raw = localStorage.getItem(tenantCacheKey());
    return raw ? (JSON.parse(raw) as TenantBranding) : null;
  } catch {
    // Private mode throws on localStorage; a cold first paint is the fallback.
    return null;
  }
}

function cacheBranding(branding: TenantBranding): void {
  try {
    localStorage.setItem(tenantCacheKey(), JSON.stringify(branding));
  } catch {
    // Nothing to do — caching is an optimisation, not a requirement.
  }
}

function clearCachedBranding(): void {
  try {
    localStorage.removeItem(tenantCacheKey());
  } catch {
    // As above.
  }
}

export interface TenantBootstrapResult {
  branding: TenantBranding;
  /**
   * The host serves no tenant at all.
   *
   * Set **only** on a definitive `404`, never on a network error, and the
   * distinction is the whole point — see {@link fetchTenantBranding}.
   */
  unknownHost: boolean;
}

/**
 * Fetch this host's branding.
 *
 * Never rejects, but it does distinguish **two failures that must not be
 * treated alike** — conflating them is what made an unrecognised hostname serve
 * a perfectly ordinary-looking "AgencyOps" login page:
 *
 * - **`404` — definitive.** No tenant is served on this hostname, and none will
 *   be a moment later. Falling back to the platform brand here produces a
 *   working-*looking* sign-in form on an address where nobody can sign in:
 *   `HostTenantGuard` refuses every request from it, so the user fills in
 *   correct credentials and gets an unexplained failure. The honest answer is
 *   to say the address is not configured. The cached entry is dropped too, or a
 *   host that *used* to be a tenant keeps rendering its old brand forever.
 *
 * - **Anything else — transient.** Network blip, API restarting, a 5xx. Here
 *   the original reasoning stands: render the last known identity and a working
 *   login form rather than an error page, because the screen this would block
 *   is the one people use to report the outage.
 */
export async function fetchTenantBranding(): Promise<TenantBootstrapResult> {
  try {
    const branding = await publicFetch<TenantBranding>('/public/tenant');
    cacheBranding(branding);
    return { branding, unknownHost: false };
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      clearCachedBranding();
      return { branding: PLATFORM_BRANDING, unknownHost: true };
    }
    return {
      branding: readCachedBranding() ?? PLATFORM_BRANDING,
      unknownHost: false,
    };
  }
}
