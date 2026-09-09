import {
  AGENCY_SLUG_MAX_LENGTH,
  AGENCY_SLUG_MIN_LENGTH,
  AGENCY_SLUG_PATTERN,
} from './agency-onboarding';

/**
 * Labels an agency may not take under our own zone.
 *
 * Two kinds, deliberately in one list: names the platform itself answers on or
 * will (`app`, `api`, `admin`, `platform`, `inngest`, `dev`, `staging`), and
 * names that are conventionally infrastructure (`www`, `mail`, `ns1`, `smtp`).
 * Handing either to a tenant takes a hostname the platform needs, and takes it
 * *permanently* — every link already issued under it would have to be reissued.
 *
 * Lives in `shared` because both sides must agree: the API refuses a reserved
 * label, and the web app has to be able to say so before the owner submits.
 * Two copies would drift, and the direction of the drift is a claimable `app`.
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
 * Why this label cannot be an agency subdomain, or `null` if it can.
 *
 * The message is the one shown to the owner, so it names the fix rather than
 * the rule it broke.
 *
 * Reuses {@link AGENCY_SLUG_PATTERN} rather than restating DNS label syntax:
 * that constant is already documented as "a DNS label in waiting — it becomes
 * the agency's subdomain the moment they add one", so a subdomain label and a
 * slug are the same thing at two points in time. It is stricter than the API's
 * internal `LABEL` check (no doubled hyphens), which is the safe direction:
 * everything this accepts, the server accepts.
 *
 * **Not a replacement for the server's checks.** `assertClaimableSubdomain`
 * still runs, because a client cannot be trusted and because uniqueness is not
 * knowable here. This exists so a typo is caught while the owner is still
 * looking at the field.
 */
export function subdomainLabelIssue(raw: string): string | null {
  const label = raw.trim().toLowerCase();

  if (!label) return 'Enter a name.';
  if (label.length < AGENCY_SLUG_MIN_LENGTH) {
    return 'Use at least two characters.';
  }
  if (label.length > AGENCY_SLUG_MAX_LENGTH) {
    return 'That name is too long.';
  }
  // Caught before the pattern so the commonest mistake — typing the whole
  // address into a field that already shows the rest of it — is named exactly,
  // rather than reported as a character problem.
  if (label.includes('.')) {
    return 'Just the first part — the rest of the address is added for you.';
  }
  if (!AGENCY_SLUG_PATTERN.test(label)) {
    return 'Use lowercase letters, numbers and single hyphens.';
  }
  if (RESERVED_SUBDOMAIN_LABELS.has(label)) {
    return `"${label}" is reserved. Choose another name.`;
  }

  return null;
}
