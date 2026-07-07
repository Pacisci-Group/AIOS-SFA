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
  createdAt?: Date;
  updatedAt?: Date;
}
