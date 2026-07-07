import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const REQUIRE_MODULE_KEY = 'requireModule';
export const RequireModule = (...modules: string[]) =>
  SetMetadata(REQUIRE_MODULE_KEY, modules);

export const REQUIRE_PERMISSIONS_KEY = 'requirePermissions';
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(REQUIRE_PERMISSIONS_KEY, permissions);

export const SKIP_TENANT_KEY = 'skipTenant';
export const SkipTenant = () => SetMetadata(SKIP_TENANT_KEY, true);

export const SKIP_BRANCH_KEY = 'skipBranch';
export const SkipBranch = () => SetMetadata(SKIP_BRANCH_KEY, true);

export const SKIP_MODULE_KEY = 'skipModule';
export const SkipModule = () => SetMetadata(SKIP_MODULE_KEY, true);
