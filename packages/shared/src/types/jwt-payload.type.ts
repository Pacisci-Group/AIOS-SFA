import { AccessScope } from '../enums/scope.enum';
import { DataScope } from '../permissions/default-role-templates';

export interface JwtPayload {
  sub: string;
  agencyId: string | null;
  branchId: string | null;
  permissions: string[];
  scope: AccessScope;
  dataScope: DataScope;
  isPlatformAdmin: boolean;
}
