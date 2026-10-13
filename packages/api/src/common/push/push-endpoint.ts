/**
 * The browser push services a subscription endpoint may point at.
 *
 * A push endpoint is a URL the browser hands the page, and the page hands us;
 * the worker then POSTs a VAPID-signed body to it for every notification the
 * subscriber receives. Accepting any `https://` URL therefore lets a signed-in
 * user aim the worker at any host — an internal service, a metadata endpoint,
 * a third party — from inside our network, with the response status or error
 * text written back to `delivery.push.error` (PAC-154 PR4 review: SSRF).
 *
 * So the host has to be one of the services browsers actually use. Exact
 * hosts where a service has one, suffixes where it shards by subdomain:
 *
 * - Chrome, Edge, Brave, Opera, Samsung Internet (Chromium): `fcm.googleapis.com`.
 * - Firefox: `updates.push.services.mozilla.com` and siblings.
 * - Safari (macOS and the installed iOS app): `web.push.apple.com`.
 * - Edge on Windows (WNS, legacy): `*.notify.windows.com`.
 *
 * A browser we have not met will fail the opt-in switch with "Could not turn
 * on browser notifications" and a 400 in the network pane; add its host here
 * once it is identified, never widen the rule to a protocol check.
 */
const EXACT_HOSTS: ReadonlySet<string> = new Set([
  'fcm.googleapis.com',
  'web.push.apple.com',
]);

const HOST_SUFFIXES: readonly string[] = [
  '.push.services.mozilla.com',
  '.push.apple.com',
  '.notify.windows.com',
];

/** Whether `endpoint` is an `https:` URL on a known browser push service. */
export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  return (
    EXACT_HOSTS.has(host) ||
    HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
  );
}
