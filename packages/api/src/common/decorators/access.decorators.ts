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
