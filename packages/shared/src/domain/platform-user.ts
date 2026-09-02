/**
 * The cross-agency user directory in the Super Admin panel (PAC-70).
 *
 * The one list that returns users from **every** tenant, which is why it has
 * its own row type rather than reusing the agency-scoped `AgencyUserListItem`:
 * that carries audit timestamps and raw ids an operator has no use for, and a
 * cross-tenant row needs the agency *named*, not referenced.
 */
export interface PlatformUserRow {
  id: string;
  /** `first last`, or `null` when both are empty (an invited, unnamed user). */
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string;
  /** `null` only for a user with no tenant, which the directory never lists. */
  agency: { id: string; name: string; slug: string } | null;
  branch: { id: string; name: string } | null;
  /**
   * Every role the user holds. Slugs are the cross-agency identity — the
   * `producer` role has a different id in each tenant but the same slug — and
   * are what the Role filter sends back.
   */
  roles: { slug: string; name: string }[];
  isActive: boolean;
  deactivatedAt: string | null;
}

export interface PlatformUserListResponse {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  items: PlatformUserRow[];
}

/**
 * One entry per distinct role slug across the platform, for the Role filter.
 * Owners can rename a template role, so the name shown is the first one found;
 * the slug is what the filter matches on.
 */
export interface PlatformRoleOption {
  slug: string;
  name: string;
}
