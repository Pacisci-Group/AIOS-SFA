import type {
  AddressAutocompleteResponse,
  AddressResolveResponse,
} from "@sfa/shared";
import { apiFetch, publicFetch } from "@/lib/api-client";

/**
 * Google-backed address lookup (PAC-60).
 *
 * Every call goes through our own API — the Google key is server-side only and
 * never reaches this bundle. Nothing here should ever import a Google SDK or
 * name a `googleapis.com` host; the production-bundle check in the PR
 * description greps for exactly that.
 */

/**
 * Session identifier for one address-entry session.
 *
 * A session is N autocomplete keystrokes plus **one** terminating
 * `resolveAddress` call, which Google bills as a bundle rather than
 * per-request. Sibling of `newSubmissionToken` and guarded the same way, for
 * the same reason: the public lead form is mobile-first and gets opened over
 * `http://192.168.x.x:5173` during testing, which is **not a secure context**,
 * so `crypto.randomUUID` is `undefined` there and a bare call crashes on mount.
 */
export function newAddressSessionToken(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

/**
 * Where a lookup is routed.
 *
 * `undefined` on every authenticated form. The public intake form passes its
 * share-link token, which routes to `/public/address/:token/*` — the same
 * lookup, re-verifying the link by hand because `@Public()` bypasses the guard
 * chain, and drawing on that link's daily allowance.
 */
export type AddressLookupScope = string | undefined;

function path(shareToken: AddressLookupScope, action: string): string {
  return shareToken
    ? `/public/address/${encodeURIComponent(shareToken)}/${action}`
    : `/address/${action}`;
}

function send<T>(
  shareToken: AddressLookupScope,
  action: string,
  body: unknown,
): Promise<T> {
  const init: RequestInit = { method: "POST", body: JSON.stringify(body) };
  /*
   * `publicFetch` on the public form, deliberately — `apiFetch` would try to
   * refresh an expired token and, failing, call `clearTokens()`. On a page
   * nobody is logged into that is harmless, but a producer previewing their own
   * share link would be logged out of the app for typing an address. Same
   * reasoning as `getPublicLeadForm` in `lead-intake-api.ts`.
   */
  return shareToken
    ? publicFetch<T>(path(shareToken, action), init)
    : apiFetch<T>(path(shareToken, action), init);
}

/** `POST /address/autocomplete` — predictions for a partially-typed address. */
export function autocompleteAddress(
  input: string,
  sessionToken: string,
  shareToken?: AddressLookupScope,
): Promise<AddressAutocompleteResponse> {
  return send(shareToken, "autocomplete", { input, sessionToken });
}

/**
 * `POST /address/resolve` — a chosen prediction as `{ street, city, state, zip }`.
 *
 * **Terminates the billing session**, so the caller must discard its session
 * token afterwards. Passing a token Google has already seen terminated gets the
 * next batch of keystrokes billed standalone.
 */
export function resolveAddress(
  placeId: string,
  sessionToken: string,
  shareToken?: AddressLookupScope,
): Promise<AddressResolveResponse> {
  return send(shareToken, "resolve", { placeId, sessionToken });
}

/**
 * The shortest input worth a billed request. Mirrors the API's own floor —
 * below three characters predictions return everything and help nobody.
 */
export const MIN_ADDRESS_LOOKUP_LENGTH = 3;
