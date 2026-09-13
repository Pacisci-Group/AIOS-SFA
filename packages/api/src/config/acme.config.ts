/**
 * ACME / certificate-issuance configuration.
 *
 * Read through `ConfigService` at call time (the `tenant-host.config.ts`
 * pattern), so a developer can point a local checkout at a test CA without
 * touching compose.
 */

/**
 * Whether this environment issues certificates at all.
 *
 * ## Why an explicit flag, defaulting to off
 * Certificate issuance only works once *we* own port 80 — the CA validates by
 * fetching a plain-HTTP URL on the hostname, and whatever is listening there has
 * to be able to answer it. Until the Node edge replaces Caddy, Caddy owns that
 * port and knows nothing of our tokens, so every order we place would fail
 * validation.
 *
 * Failing is not free. Let's Encrypt counts failed validations against a limit
 * that is separate from the issuance limit, so an environment quietly retrying
 * doomed orders every fifteen minutes spends an allowance that hostnames which
 * *would* succeed then cannot use.
 *
 * Off by default therefore means this whole subsystem ships inert and is turned
 * on in the same change that gives it a port to answer on. It mirrors
 * `INNGEST_ENABLED`: an explicit statement someone made, rather than behaviour
 * inferred from which secrets happen to be present.
 */
export function acmeEnabled(raw: string | undefined): boolean {
  return raw?.trim().toLowerCase() === 'true';
}

/** Let's Encrypt's test environment. Issues untrusted certs, generous limits. */
export const LETS_ENCRYPT_STAGING =
  'https://acme-staging-v02.api.letsencrypt.org/directory';

/** Let's Encrypt production. Trusted certs, limits that bite. */
export const LETS_ENCRYPT_PRODUCTION =
  'https://acme-v02.api.letsencrypt.org/directory';

/**
 * Which CA endpoint to order from.
 *
 * ## Why staging is the default
 * The two failure modes are not symmetric, and the asymmetry decides this.
 *
 * Defaulting to *production* means a misconfigured environment — a new staging
 * box, a developer pointing at real hostnames, a preview environment — orders
 * real certificates and spends Let's Encrypt's production rate limits. Those
 * limits are per registered domain and per account, they are counted over a
 * rolling week, and there is no way to give them back. With white-labelling we
 * hold many registered domains behind one account, so the blast radius of that
 * mistake is every tenant's issuance for a week. It is also *silent* — the
 * certificates work, so nothing surfaces until the limit is hit by something
 * that mattered.
 *
 * Defaulting to *staging* means an environment that forgot to opt in serves
 * certificates browsers reject. That is about as loud as a failure gets, it is
 * noticed within minutes of the first request, and the fix is one environment
 * variable and a re-issue.
 *
 * A recoverable loud failure beats an unrecoverable quiet one, so production is
 * opt-in. The deploy preflight requires the variable explicitly in deployed
 * environments, so "forgot to opt in" fails the deploy rather than the site.
 */
export function acmeDirectoryUrl(raw: string | undefined): string {
  const value = raw?.trim();
  if (!value) return LETS_ENCRYPT_STAGING;

  // Friendly aliases, so an environment variable can say what it means rather
  // than carrying a URL nobody can eyeball for correctness.
  if (value === 'staging') return LETS_ENCRYPT_STAGING;
  if (value === 'production') return LETS_ENCRYPT_PRODUCTION;
  return value;
}

/** True when we are pointed at a CA whose certificates browsers will trust. */
export function isProductionCa(directoryUrl: string): boolean {
  return directoryUrl === LETS_ENCRYPT_PRODUCTION;
}

/**
 * Contact address registered with the CA. Optional — Let's Encrypt does not
 * require one, and it is used only for expiry notices we should never need.
 */
export function acmeContactEmail(raw: string | undefined): string | null {
  const value = raw?.trim();
  return value ? value : null;
}

/**
 * When a certificate becomes eligible for renewal.
 *
 * Expressed as a fraction of its own lifetime rather than a fixed number of
 * days, because certificate lifetimes are not a constant. Let's Encrypt's
 * ninety-day certificate is already not the only shape they issue, and a
 * hard-coded "renew 30 days out" silently becomes "renew after it has expired"
 * the day we are issued something shorter.
 *
 * A third of the lifetime remaining gives, on a ninety-day certificate, a
 * thirty-day window in which a daily renewal attempt may fail every single time
 * and still leave the site working. That is the property worth buying: renewal
 * runs unattended, and the first sign of trouble should never be an outage.
 */
export const RENEW_AT_REMAINING_FRACTION = 1 / 3;

export function renewalPoint(notBefore: Date, notAfter: Date): Date {
  const lifetimeMs = notAfter.getTime() - notBefore.getTime();
  return new Date(
    notAfter.getTime() - lifetimeMs * RENEW_AT_REMAINING_FRACTION,
  );
}

/**
 * Backoff after a failed issuance attempt.
 *
 * ## Why this is not "retry in five minutes, forever"
 * A domain whose DNS was pointed away, or whose owner never finished pointing
 * it here, fails validation every time. Retrying it on a tight loop spends the
 * CA's *failed-validation* rate limit — which is separate from the issuance
 * limit and is counted per account-and-hostname — on a domain nobody is waiting
 * for. Reaching that limit blocks retries for hostnames that would have
 * succeeded.
 *
 * Exponential from fifteen minutes, capped at a day: a transient problem
 * recovers quickly, and a genuinely dead domain settles into one attempt a day
 * that costs nothing.
 */
const BACKOFF_BASE_MS = 15 * 60_000;
const BACKOFF_CAP_MS = 24 * 3_600_000;

export function backoffAfterFailure(failureCount: number, now: Date): Date {
  // `failureCount` is the count *including* the failure just recorded, so the
  // first retry waits one base interval rather than none.
  const exponent = Math.max(0, failureCount - 1);
  const delay = Math.min(BACKOFF_BASE_MS * 2 ** exponent, BACKOFF_CAP_MS);
  return new Date(now.getTime() + delay);
}

/**
 * How long a worker may hold an issuance claim before another may take it.
 *
 * Fifteen minutes, matching the reaping window `database/run-migrations.ts`
 * uses, and for the same reason: a process killed mid-order leaves the claim
 * set, and a row nobody can ever claim again is a certificate that silently
 * stops renewing. Long enough that a slow-but-live order is never stolen —
 * validation plus issuance is seconds, not minutes.
 */
export const ISSUANCE_LOCK_TTL_MS = 15 * 60_000;

/**
 * How long an unanswered `http-01` challenge row survives.
 *
 * The happy path deletes explicitly; this is the backstop for an order that
 * died between writing the token and cleaning it up. An hour is far longer than
 * any validation takes and short enough that debris does not accumulate.
 */
export const CHALLENGE_TTL_MS = 3_600_000;
