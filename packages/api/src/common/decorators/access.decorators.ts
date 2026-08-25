import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const REQUIRE_MODULE_KEY = 'requireModule';
export const RequireModule = (...modules: string[]) =>
  SetMetadata(REQUIRE_MODULE_KEY, modules);

export const REQUIRE_PERMISSIONS_KEY = 'requirePermissions';
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(REQUIRE_PERMISSIONS_KEY, permissions);

/**
 * Multi-permission (OR) gate: the handler is reachable when the user holds AT
 * LEAST ONE of the listed permissions.
 *
 * Use this for data that legitimately renders on more than one page. Household
 * and policy records, for example, appear both on the Clients pages and inside
 * the CRM service-ticket detail, so they accept `clients:read` OR
 * `crm_service:read`. Gating stays page-level — this widens *which* page grants
 * access, it never narrows access down to individual records.
 *
 * Composes with `@RequirePermissions`: when both are present, the AND-set and
 * the OR-set must each be satisfied.
 *
 * NOTE: metadata overriding is per-key. A handler-level `@RequireWrite(...)`
 * replaces `REQUIRE_PERMISSIONS_KEY` only — it does NOT clear a class-level
 * `@RequireAnyPermission`, so both would still apply to that handler.
 */
export const REQUIRE_ANY_PERMISSIONS_KEY = 'requireAnyPermissions';
export const RequireAnyPermission = (...permissions: string[]) =>
  SetMetadata(REQUIRE_ANY_PERMISSIONS_KEY, permissions);

/**
 * Module counterpart to `@RequireAnyPermission`: passes when AT LEAST ONE of
 * the listed modules is enabled for the agency.
 */
export const REQUIRE_ANY_MODULE_KEY = 'requireAnyModule';
export const RequireAnyModule = (...modules: string[]) =>
  SetMetadata(REQUIRE_ANY_MODULE_KEY, modules);

/**
 * Require read + write on a page/module for a mutating handler. Apply to
 * POST/PATCH/PUT/DELETE handlers on feature controllers. Since `write` implies
 * `read` at resolution time, requiring `{module}:write` is sufficient.
 */
export const RequireWrite = (moduleKey: string) =>
  SetMetadata(REQUIRE_PERMISSIONS_KEY, [`${moduleKey}:write`]);

export const SKIP_TENANT_KEY = 'skipTenant';
export const SkipTenant = () => SetMetadata(SKIP_TENANT_KEY, true);

export const SKIP_BRANCH_KEY = 'skipBranch';
export const SkipBranch = () => SetMetadata(SKIP_BRANCH_KEY, true);

export const SKIP_MODULE_KEY = 'skipModule';
export const SkipModule = () => SetMetadata(SKIP_MODULE_KEY, true);
