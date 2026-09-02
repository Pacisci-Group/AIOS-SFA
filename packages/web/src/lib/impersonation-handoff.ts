/**
 * The impersonation handoff URL — both sides of the contract in one place
 * (PAC-70).
 *
 * ## Why a URL at all
 *
 * `HostTenantGuard` binds every session to a hostname: a user of an agency
 * with its own domain is refused on the platform host, and a platform admin is
 * refused on any agency host. Browser storage is per origin. So after the
 * Super Admin panel mints a session as a tenant user, it cannot simply keep the
 * tokens where it is — it has to navigate the browser to the target's origin
 * and store them *there*. `appBaseUrl` on the impersonate response says which
 * origin; this module says how the tokens travel.
 *
 * ## Why the fragment, not the query string
 *
 * `#…` never leaves the browser: it is not sent to the server, so it is absent
 * from the Vite proxy log, Caddy's access log, the API's request log and any
 * `Referer` header. A `?…` query would land in all four. The landing page reads
 * the fragment once and immediately replaces the URL so it survives neither a
 * reload nor the history stack.
 */

export const HANDOFF_PATH = '/auth/impersonate';

export interface HandoffTokens {
  accessToken: string;
  refreshToken: string;
}

export function buildHandoffUrl(
  appBaseUrl: string,
  tokens: HandoffTokens,
): string {
  const fragment = new URLSearchParams({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  });
  return `${appBaseUrl.replace(/\/+$/, '')}${HANDOFF_PATH}#${fragment.toString()}`;
}

/** The tokens carried by a handoff URL's fragment, or `null` if either is missing. */
export function parseHandoffHash(hash: string): HandoffTokens | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const accessToken = params.get('accessToken');
  const refreshToken = params.get('refreshToken');
  if (!accessToken || !refreshToken) return null;
  return { accessToken, refreshToken };
}
