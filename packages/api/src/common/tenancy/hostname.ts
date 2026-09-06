/**
 * Hostname normalisation and validation, shared by everything that touches a
 * tenant host.
 *
 * Pure functions with no injected services, so they are testable with plain
 * strings — the same discipline `common/address/household-address.ts` follows.
 *
 * The reason this is one file rather than a helper on each service: an inbound
 * `Host` header and a stored `AgencyDomain.hostname` are compared as strings,
 * and any disagreement about case, port or trailing dot makes a tenant
 * invisible on its own domain with nothing in the logs to say why.
 */

/**
 * Reduce a `Host` header or user-typed domain to its canonical stored form.
 *
 * Strips, in order: surrounding whitespace, a `scheme://` prefix, any path,
 * the `[v6]`/`:port` suffix, a trailing root dot, and case.
 *
 * Returns `null` for anything that is not a plausible hostname, so callers get
 * one thing to check rather than a string that silently fails to match later.
 */
export function normalizeHostname(
  raw: string | undefined | null,
): string | null {
  if (!raw) return null;

  let host = raw.trim().toLowerCase();
  if (!host) return null;

  // `https://texasholdings.com/login` — owners paste what is in their address
  // bar, and a stored "https://texasholdings.com" matches no Host header ever.
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  host = host.split('/')[0] ?? '';

  // IPv6 literals arrive bracketed (`[::1]:4000`). Keep the brackets off and
  // the address intact; the port is what has to go.
  if (host.startsWith('[')) {
    const close = host.indexOf(']');
    if (close === -1) return null;
    host = host.slice(1, close);
  } else {
    host = host.split(':')[0] ?? '';
  }

  // A fully-qualified name may legally end in the root dot. Browsers do not
  // send it, but a copy-paste from `dig` does.
  host = host.replace(/\.+$/, '');

  if (!host) return null;
  // Total length cap from RFC 1035, applied before the per-label checks so a
  // pathological input cannot reach the regex loop.
  if (host.length > 253) return null;

  return host;
}

/** A single DNS label: alphanumeric, inner hyphens, 1–63 chars. */
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Whether `host` is a syntactically valid, *routable* hostname.
 *
 * Requires at least two labels: a bare `texasholdings` is not something DNS can
 * resolve on the public internet, and accepting it would create a domain row
 * that can never verify.
 *
 * Assumes an already-normalised input — call {@link normalizeHostname} first.
 */
export function isValidHostname(host: string): boolean {
  const labels = host.split('.');
  if (labels.length < 2) return false;
  return labels.every((label) => LABEL.test(label));
}

/**
 * Labels an agency may not claim as its subdomain.
 *
 * Two different hazards, deliberately in one list:
 * - **Ours to keep.** `app` is the platform host itself; handing it to a tenant
 *   would lock every super admin out of the platform. `api`, `inngest` and
 *   `static` name infrastructure that may need its own record later.
 * - **Confusable.** `admin`, `support`, `billing`, `security` and friends read
 *   as *the platform speaking*, which is precisely the sentence a phishing page
 *   wants to borrow.
 *
 * Cheap to extend and expensive to have forgotten, so it errs long.
 */
export const RESERVED_SUBDOMAIN_LABELS: ReadonlySet<string> = new Set([
  'admin',
  'api',
  'app',
  'assets',
  'auth',
  'billing',
  'cdn',
  'dashboard',
  'dev',
  'docs',
  'ftp',
  'help',
  'inngest',
  'localhost',
  'login',
  'mail',
  'ns',
  'ns1',
  'ns2',
  'platform',
  'root',
  'security',
  'smtp',
  'staging',
  'static',
  'status',
  'support',
  'test',
  'www',
]);

/**
 * The label an agency subdomain would occupy under `baseDomain`, or `null` when
 * `host` is not a direct child of it.
 *
 * Direct children only, on purpose: `a.b.smithfamily.agency` is two levels deep,
 * which a single wildcard `*.smithfamily.agency` certificate does **not** cover
 * (wildcards match exactly one label). Accepting it would create a domain that
 * verifies, activates, and then fails TLS in the browser.
 */
export function subdomainLabelOf(
  host: string,
  baseDomain: string,
): string | null {
  const suffix = `.${baseDomain}`;
  if (!host.endsWith(suffix)) return null;

  const label = host.slice(0, -suffix.length);
  if (!label || label.includes('.')) return null;

  return LABEL.test(label) ? label : null;
}
