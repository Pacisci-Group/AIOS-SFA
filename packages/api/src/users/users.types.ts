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

/**
 * `POST /users/:userId/password-reset` response (PAC-79).
 *
 * `resetToken` is **absent in production** — see
 * `UsersService.exposeTokensForDev`. Anything consuming it must treat it as
 * optional rather than assuming the dev shape.
 */
export interface PasswordResetResponse {
  userId: string;
  /** Absolute reset URL. */
  resetUrl: string;
  /** ISO-8601. */
  expiresAt: string;
  /** Dev/test only. */
  resetToken?: string;
}

/**
 * A user in the agency directory.
 *
 * Explicit rather than inferred from `lean()` — the hydrated Mongoose type is
 * too large for TypeScript to serialize, and this is the contract the web codes
 * against. `roleIds` keeps its populated `{ _id, name, slug }` shape even though
 * the assignment now lives in the `userRoles` join.
 */
export interface AgencyUserListItem {
  _id: unknown;
  agencyId?: unknown;
  branchId?: unknown;
  email: string;
  roleIds: { _id: unknown; name: string; slug: string }[];
  isPlatformAdmin: boolean;
  firstName?: string;
  lastName?: string;
  isActive: boolean;
  deactivatedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
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
  /**
   * Set when the user was removed from the agency.
   *
   * ⚠ Needed to tell a removed employee from a pending invite — `isActive` is
   * `false` for both. See the table on `User.isActive`.
   */
  deactivatedAt?: Date | null;
  effectivePermissions: string[];
  roleDefaultPermissions: string[];
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * What creating an invited user needs. Shared by `POST /users/invite` and by
 * agency onboarding (PAC-69), which drives the same two halves — account, then
 * email — across a rollback boundary.
 */
export interface InviteUserInput {
  agencyId: string;
  branchId?: string;
  email: string;
  roleIds: string[];
  firstName?: string;
  lastName?: string;
  invitedByUserId?: string;
  /**
   * Whether the inviter is a platform account.
   *
   * Reaches `OwnerProtectionService.assertMayChangeOwnerRole`, which reserves
   * assigning the Agency Owner role for platform operators. Only the onboarding
   * path sets it; the tenant-side invite dialog leaves it false.
   */
  invitedByIsPlatformAdmin?: boolean;
}

/** A minted-but-not-yet-sent invite. See `UsersService.mintInviteToken`. */
export interface MintedInvite {
  inviteToken: string;
  expiresAt: Date;
  /** Absolute accept-invite URL, on the recipient's own agency host. */
  inviteUrl: string;
  /** The host the URL was built from, reused for the email's logo. */
  baseUrl: string;
}

/**
 * Which invite this is, so the email can say the right thing.
 *
 * `employee` (the default, and what an omitted value means) is "X invited you
 * to join Y". `owner` is the agency's first account, created by a platform
 * operator during onboarding — nobody at the agency invited them, and being
 * told "Super Admin invited you" is both confusing and slightly alarming.
 */
export type InviteKind = 'employee' | 'owner';
