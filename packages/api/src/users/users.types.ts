/**
 * `POST /users/invite` and `POST /users/:userId/invite/resend` response.
 *
 * `inviteToken` is **absent in production** — see `UsersService.issueInvite`.
 * Anything consuming it must treat it as optional rather than assuming the dev
 * shape.
 */
export interface InviteResponse {
  userId: string;
  /** Absolute accept-invite URL. */
  inviteUrl: string;
  /** ISO-8601. */
  expiresAt: string;
  /** Dev/test only. */
  inviteToken?: string;
}

export interface UserDetailResponse {
  _id: unknown;
  agencyId?: unknown;
  branchId?: unknown;
  email: string;
  roleIds: unknown[];
  permissionGrants: string[];
  permissionRevokes: string[];
  isPlatformAdmin: boolean;
  firstName?: string;
  lastName?: string;
  isActive: boolean;
  effectivePermissions: string[];
  roleDefaultPermissions: string[];
  createdAt?: Date;
  updatedAt?: Date;
}
