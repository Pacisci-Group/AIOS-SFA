import type { PageLevelOverride } from '@sfa/shared';
import { apiFetch } from '@/lib/api-client';

export interface AgencyUserRole {
  _id: string;
  name: string;
  slug: string;
}

export interface AgencyUser {
  _id: string;
  agencyId: string | null;
  branchId: string | null;
  email: string;
  firstName?: string;
  lastName?: string;
  isActive: boolean;
  /**
   * ISO-8601 when the user was removed from the agency; null otherwise.
   *
   * ⚠ `isActive: false` on its own is ambiguous — it covers both a pending
   * invite and a removed employee. Use {@link userStatus} rather than reading
   * `isActive` directly, or an ex-employee renders as "Invited" and gets offered
   * a "Resend invite" button.
   */
  deactivatedAt: string | null;
  isPlatformAdmin: boolean;
  roleIds: AgencyUserRole[];
  createdAt?: string;
  updatedAt?: string;
}

export type UserStatus = 'active' | 'invited' | 'deactivated';

/**
 * The single place the three-way status is derived.
 *
 * Extracted rather than inlined because the badge, both row-action components
 * and the empty-state copy all need it, and a nested ternary repeated four times
 * is how one of them ends up disagreeing with the others.
 */
export function userStatus(user: AgencyUser): UserStatus {
  if (user.deactivatedAt) return 'deactivated';
  return user.isActive ? 'active' : 'invited';
}

/** What a removal put back into the unassigned queue. */
export interface ReleasedWork {
  ticketsUnassigned: number;
  rotationsDeactivated: number;
}

export interface AgencyUserDetail extends AgencyUser {
  /** Effective permissions after role defaults + owner overrides. */
  effectivePermissions: string[];
  /** Permissions the user would have from roles alone (no overrides). */
  roleDefaultPermissions: string[];
}

export interface InviteUserInput {
  email: string;
  /**
   * The invite form assigns exactly one role (PAC-58), but the wire contract is
   * an array — `PATCH /users/:userId/roles` is already many-per-user, and the
   * two endpoints should not disagree about the shape.
   */
  roleIds: string[];
  branchId?: string;
  firstName?: string;
  lastName?: string;
}

export interface InviteResponse {
  userId: string;
  /** Absolute accept-invite URL. */
  inviteUrl: string;
  /** ISO-8601. */
  expiresAt: string;
  /**
   * **Dev/test only — absent in production.** Email delivery is still a stub
   * (see the API's `MailService`), so outside production the server hands back
   * the raw token to make the flow walkable. Never build a feature on it.
   */
  inviteToken?: string;
}

/** The three states the Status column shows. */
export const AGENCY_USER_STATUSES = [
  'active',
  'invited',
  'deactivated',
] as const;

export interface ListUsersParams {
  page?: number;
  pageSize?: number;
  /** Name, email, role name — and branch name, for a caller who can see it. */
  q?: string;
  status?: UserStatus[];
}

export interface AgencyUserListResponse {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  items: AgencyUser[];
}

/**
 * One page of the agency directory.
 *
 * ⚠ Paginated since PAC-101, where it returned the whole roster as a bare
 * array. A caller that wants **everybody** — a picker — wants
 * {@link listUserOptions} instead; this one is the table.
 */
export function listUsers(
  params: ListUsersParams = {},
): Promise<AgencyUserListResponse> {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    // Repeated params, not comma-joined: Express parses `?status=a&status=b`
    // into an array, which is one of the three forms `multiValue` accepts.
    if (Array.isArray(value)) {
      for (const item of value) search.append(key, String(item));
    } else {
      search.set(key, String(value));
    }
  }
  const qs = search.toString();
  return apiFetch<AgencyUserListResponse>(`/users${qs ? `?${qs}` : ''}`);
}

/**
 * One assignable person, for a picker.
 *
 * Not a row of {@link AgencyUser}: a picker renders a name and needs the whole
 * list at once, where the directory renders eleven fields and is about to grow
 * pagination (PAC-101). The server does the filtering all three call sites used
 * to do in the browser — active people only, platform admins excluded — so
 * there is nothing left here to filter.
 */
export interface AgencyUserOption {
  _id: string;
  email: string;
  firstName?: string;
  lastName?: string;
}

/**
 * Everyone who can be assigned work. **Unpaginated on purpose** — see
 * `AgencyUserOption`; a picker showing page 1 of 3 is a bug.
 */
export function listUserOptions() {
  return apiFetch<AgencyUserOption[]>('/users/options');
}

/**
 * The cache key every picker shares.
 *
 * ⚠ Invalidate this **alongside** `['users']` on anything that changes the
 * roster — inviting, deactivating, reactivating. They were already two keys
 * before PAC-101 and only `['users']` was ever invalidated, so the Lead Owner
 * and Audit Assignee pickers went stale until remount.
 */
export const agencyUserOptionsKey = ['agency-users'] as const;

export function inviteUser(input: InviteUserInput) {
  return apiFetch<InviteResponse>('/users/invite', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** Regenerate the token and send again. Invalidates the previous link. */
export function resendInvite(userId: string) {
  return apiFetch<InviteResponse>(`/users/${userId}/invite/resend`, {
    method: 'POST',
  });
}

/**
 * `POST /users/:userId/password-reset` response (PAC-79).
 *
 * `resetToken` is **absent in production**, where the email is the only
 * delivery channel. Treat it as optional rather than assuming the dev shape.
 */
export interface PasswordResetResponse {
  userId: string;
  /** Absolute reset URL. */
  resetUrl: string;
  /** ISO-8601. Hours away, not days. */
  expiresAt: string;
  /** Dev/test only. */
  resetToken?: string;
}

/**
 * Email an active employee a link to set a new password.
 *
 * The way back in for users the SmartSuite migration left with an unusable
 * password hash: they cannot log in, and they cannot be re-invited because the
 * invite endpoints refuse an active user.
 *
 * Issuing a new link invalidates any previous one, and completing the reset
 * ends every session that user had open.
 */
export function sendPasswordReset(userId: string) {
  return apiFetch<PasswordResetResponse>(`/users/${userId}/password-reset`, {
    method: 'POST',
  });
}

/** Revoke a pending invite. The invited row disappears from the directory. */
export function revokeInvite(userId: string) {
  return apiFetch<void>(`/users/${userId}/invite`, { method: 'DELETE' });
}

/**
 * Remove an employee from the agency.
 *
 * Deactivates rather than deletes: their history stays attributed to a real
 * name, and access is revoked on their very next request. Returns what was
 * released back to the unassigned queue.
 */
export function deactivateUser(userId: string) {
  return apiFetch<ReleasedWork>(`/users/${userId}`, { method: 'DELETE' });
}

/** Restore a removed employee. Does not restore the work released on removal. */
export function reactivateUser(userId: string) {
  return apiFetch<AgencyUserDetail>(`/users/${userId}/reactivate`, {
    method: 'POST',
  });
}

export function getUser(userId: string) {
  return apiFetch<AgencyUserDetail>(`/users/${userId}`);
}

/**
 * Replace a user's roles.
 *
 * `PATCH /users/:id/roles` has existed since day one with no client and no
 * caller, which is why the invite dialog's "Adjustable afterwards" was untrue.
 *
 * A full replacement, not a merge. Multiple roles union their permissions and
 * take the **widest** data scope of the set.
 *
 * The API owns the owner-protection rules — an owner may give up their own
 * owner role but not someone else's (403), and never the last one (409).
 * Surface the server's message rather than re-deriving those rules here; the
 * client cannot see who else holds the role.
 */
export function updateUserRoles(userId: string, roleIds: string[]) {
  return apiFetch<AgencyUserDetail>(`/users/${userId}/roles`, {
    method: 'PATCH',
    body: JSON.stringify({ roleIds }),
  });
}

export function updateUserPermissions(
  userId: string,
  overrides: PageLevelOverride[],
) {
  return apiFetch<AgencyUserDetail>(`/users/${userId}/permissions`, {
    method: 'PATCH',
    body: JSON.stringify({ overrides }),
  });
}
