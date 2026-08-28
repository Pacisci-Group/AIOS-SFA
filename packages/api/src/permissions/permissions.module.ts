import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Agency, AgencySchema } from '../platform/schemas/agency.schema';
import {
  AgencyRole,
  AgencyRoleSchema,
} from '../roles/schemas/agency-role.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { AccessResolverService } from './access-resolver.service';
import { PermissionCache } from './cache/permission-cache';
import { permissionCacheProvider } from './cache/permission-cache.provider';
import { OwnerProtectionService } from './owner-protection.service';
import { PermissionsController } from './permissions.controller';
import { PermissionsService } from './permissions.service';
import { RoleAssignmentsService } from './role-assignments.service';
import { Permission, PermissionSchema } from './schemas/permission.schema';
import {
  RolePermission,
  RolePermissionSchema,
} from './schemas/role-permission.schema';
import {
  UserPermission,
  UserPermissionSchema,
} from './schemas/user-permission.schema';
import { UserRole, UserRoleSchema } from './schemas/user-role.schema';

/**
 * The authorization spine: the permission catalog, the three join collections,
 * the resolver that turns them into an `AccessContext`, and the one service
 * allowed to write any of it.
 *
 * `RoleAssignmentsService` and `OwnerProtectionService` live here rather than in
 * `RolesModule` because `RolesModule` already imports this one — putting them
 * the other way round would close a cycle and need `forwardRef`. The join
 * models they write are here too, so this is also where they belong by
 * ownership.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: AgencyRole.name, schema: AgencyRoleSchema },
      { name: Agency.name, schema: AgencySchema },
      { name: Permission.name, schema: PermissionSchema },
      { name: RolePermission.name, schema: RolePermissionSchema },
      { name: UserRole.name, schema: UserRoleSchema },
      { name: UserPermission.name, schema: UserPermissionSchema },
    ]),
  ],
  controllers: [PermissionsController],
  providers: [
    PermissionsService,
    AccessResolverService,
    RoleAssignmentsService,
    OwnerProtectionService,
    permissionCacheProvider,
  ],
  exports: [
    PermissionsService,
    AccessResolverService,
    RoleAssignmentsService,
    OwnerProtectionService,
    PermissionCache,
    MongooseModule,
  ],
})
export class PermissionsModule {}
