import {
  publicFetch,
  setStoredUser,
  setTokens,
  type AuthUser,
} from '@/lib/api-client';

/** `GET /auth/invite/:token` — the greeting shown before any credentials exist. */
export interface InvitePreview {
  /** The address the invite was sent to. Rendered read-only. */
  email: string;
  agencyName: string;
  roleNames: string[];
  /** ISO-8601. */
  expiresAt: string;
  /** What the inviter typed, so the wizard's name step arrives prefilled. */
  firstName: string | null;
  lastName: string | null;
  /** The Allstate codes the inviter typed (PAC-173), prefilled the same way. */
  allstateBindId: string | null;
  allstateSubProducerCode: string | null;
  /**
   * Whether accepting leads into the agency's own first-run setup — true only
   * for the owner of a freshly onboarded agency (PAC-69).
   *
   * Read **before** the first step renders, so the step counter is right from
   * the start rather than growing by three once the session exists.
   */
  agencySetupPending: boolean;
}

/**
 * What the invitee confirms about themselves. Each key: absent keeps what the
 * inviter typed, `''` clears it.
 */
export interface AcceptInviteDetails {
  firstName?: string;
  lastName?: string;
  allstateBindId?: string;
  allstateSubProducerCode?: string;
}

export interface AcceptInviteResult {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

/**
 * Both calls go through `publicFetch`, not `apiFetch`, and that is load-bearing.
 *
 * The accept-invite page is reachable while signed in as somebody else (shared
 * machine, owner testing their own invite). `apiFetch` would attach that stale
 * session's `Authorization` header and, on a 401, run its refresh-then-
 * `clearTokens()` path — logging the current user out as a side effect of
 * opening an emailed link. Same reasoning as `PublicLeadFormPage`; see the
 * docblock on `publicFetch`.
 *
 * `404` unknown/already-used · `410` expired — the page renders a distinct state
 * for each, so callers should switch on `ApiError.status`.
 */
export function getInvitePreview(token: string) {
  return publicFetch<InvitePreview>(`/auth/invite/${encodeURIComponent(token)}`);
}

/**
 * Set the password and sign in.
 *
 * `acceptInvite` returns a full token pair, so the invitee lands in the app
 * already authenticated — this stores the session rather than bouncing them to
 * `/login` to type a password they set two seconds ago.
 */
export async function acceptInvite(
  token: string,
  password: string,
  details?: AcceptInviteDetails,
) {
  const data = await publicFetch<AcceptInviteResult>('/auth/accept-invite', {
    method: 'POST',
    // Details omitted rather than sent empty when the caller has none: absent
    // means "keep what the inviter typed", where `''` would clear it.
    body: JSON.stringify({ token, password, ...(details ?? {}) }),
  });

  setTokens(data.accessToken, data.refreshToken);
  setStoredUser(data.user);
  return data;
}
