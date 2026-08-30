import {
  publicFetch,
  setStoredUser,
  setTokens,
  type AuthUser,
} from '@/lib/api-client';

/**
 * `GET /auth/password-reset/:token` — the greeting on the reset page (PAC-79).
 *
 * Narrower than `InvitePreview`: no `roleNames`. This link points at an account
 * that already exists, so the role is not part of introducing anyone to
 * anything, and a forwarded link should not answer "what can this person do?".
 */
export interface PasswordResetPreview {
  /** The address the reset was sent to. Rendered read-only. */
  email: string;
  agencyName: string;
  /** ISO-8601. Hours away, not days — render the time, not just the date. */
  expiresAt: string;
}

export interface ResetPasswordResult {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

/**
 * Both calls go through `publicFetch`, not `apiFetch`, and that is load-bearing
 * for exactly the reason spelled out in `invite-api.ts`.
 *
 * It matters more here, if anything: an owner will routinely open a reset link
 * to check it while signed in, and a shared machine is the normal case for the
 * migrated staff this feature exists for. `apiFetch` would attach that stale
 * session's `Authorization` header and, on a 401, run its refresh-then-
 * `clearTokens()` path — signing the current user out as a side effect.
 *
 * `404` unknown, already used, or the user has since been removed · `410`
 * expired. The page renders a distinct state for each, so callers switch on
 * `ApiError.status`.
 */
export function getPasswordResetPreview(token: string) {
  return publicFetch<PasswordResetPreview>(
    `/auth/password-reset/${encodeURIComponent(token)}`,
  );
}

/**
 * Set the new password and sign in.
 *
 * Returns a full token pair so the user lands in the app already authenticated
 * rather than being bounced to `/login` to retype a password they set two
 * seconds ago.
 *
 * ⚠ This call also **ends every other session** for that account server-side
 * (it bumps `tokenVersion`), including any this browser held for the same user.
 * Storing the returned pair is therefore not just a convenience — it is what
 * replaces the credentials this request just invalidated.
 */
export async function resetPassword(token: string, password: string) {
  const data = await publicFetch<ResetPasswordResult>('/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, password }),
  });

  setTokens(data.accessToken, data.refreshToken);
  setStoredUser(data.user);
  return data;
}
