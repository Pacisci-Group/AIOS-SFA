import { normalizeHostname } from '../common/tenancy/hostname';

/**
 * White-label host configuration.
 *
 * Read through `ConfigService` at call time (the `invite.config.ts` pattern,
 * not the import-time one in `rate-limit.config.ts`), so these work from the
 * repo `.env` and a developer can point a local checkout at made-up hostnames
 * without touching compose.
 *
 * Two values, easily confused:
 * - **platform host** — the single hostname the super-admin app answers on
 *   (`app.smithfamily.agency`). Exact match.
 * - **base domain** — the parent zone agency subdomains hang off
 *   (`smithfamily.agency`), covered by one wildcard DNS record and one wildcard
 *   certificate.
 *
 * They are usually related (`app.` + base) but are not derived from each other,
 * because nothing guarantees the platform host is a child of the base domain —
 * a deployment could serve the admin app from an entirely separate name.
 */

/** Dev default. Keeps a fresh checkout working with no new env vars. */
export const DEFAULT_PLATFORM_HOST = 'localhost';

/**
 * The hostname the platform (super-admin) app answers on.
 *
 * Falls back to the host of `APP_BASE_URL` before the dev default, so an
 * existing deployment that already sets `APP_BASE_URL` behaves correctly
 * without a new secret — the alternative is that every agency user is locked
 * out on first deploy because no host resolves to `platform`.
 */
export function platformHost(
  rawPlatformHost: string | undefined,
  rawAppBaseUrl: string | undefined,
): string {
  return (
    normalizeHostname(rawPlatformHost) ??
    normalizeHostname(rawAppBaseUrl) ??
    DEFAULT_PLATFORM_HOST
  );
}

/**
 * The parent zone agency subdomains are issued under, or `null` when none is
 * configured.
 *
 * `null` disables subdomain creation entirely rather than guessing a zone.
 * Guessing would mean minting `texasholdings.<something>` records that no DNS
 * server answers for, which looks like a working feature right up until a user
 * clicks the link.
 */
export function baseDomain(raw: string | undefined): string | null {
  return normalizeHostname(raw);
}
