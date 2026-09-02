import type {
  PlatformRoleOption,
  PlatformUserListResponse,
  PlatformUserRow,
} from '@sfa/shared';
import { apiFetch, type AuthUser } from '@/lib/api-client';

export type { PlatformRoleOption, PlatformUserListResponse, PlatformUserRow };

/**
 * Find / Impersonate User (PAC-70) — the platform's cross-agency user
 * directory and the impersonate call it hands a row to.
 *
 * Platform-scoped like `platform-api.ts`: an operator has no `agencyId`, so
 * nothing here reads the caller's tenant. The row and envelope types are
 * re-exported from `@sfa/shared` rather than redeclared, so a change on the
 * API side is a compile error here and not a runtime surprise.
 */

export interface ListPlatformUsersParams {
  page?: number;
  pageSize?: number;
  /** Name, email, agency name or role name — case-insensitive contains. */
  q?: string;
  /** Several are ORed together. */
  agencyIds?: string[];
  /** Role **slugs**, ORed; a user holding any of them matches. */
  roleSlugs?: string[];
}

export function listPlatformUsers(params: ListPlatformUsersParams = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '') continue;
    if (Array.isArray(value)) {
      // Repeated params (`?roleSlugs=producer&roleSlugs=csr`) — Express parses
      // these into an array, which is what the DTO's `multiValue` expects.
      for (const item of value) {
        search.append(key, String(item));
      }
      continue;
    }
    search.set(key, String(value));
  }
  const qs = search.toString();
  return apiFetch<PlatformUserListResponse>(
    `/platform/users${qs ? `?${qs}` : ''}`,
  );
}

/** One option per distinct role slug across the platform — the Role filter. */
export function listPlatformRoles() {
  return apiFetch<PlatformRoleOption[]>('/platform/users/roles');
}

/** What `POST /auth/impersonate/:userId` returns: a login envelope plus where to use it. */
export interface ImpersonationSession {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
  /**
   * The origin the session must be used on — the target agency's own host, or
   * the platform host when the agency has no domain. See
   * `impersonation-handoff.ts` for why the tokens are carried there by URL.
   */
  appBaseUrl: string;
}

/**
 * Mint a session as another user.
 *
 * Deliberately does **not** persist the tokens the way `login` does: they
 * belong to a different origin (usually), and storing them here would replace
 * the operator's own session in this one. The handoff page on the target
 * origin is what stores them.
 */
export function impersonateUser(userId: string) {
  return apiFetch<ImpersonationSession>(
    `/auth/impersonate/${encodeURIComponent(userId)}`,
    { method: 'POST' },
  );
}
