import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  RolePermission,
  RolePermissionSchema,
} from '../../permissions/schemas/role-permission.schema';
import {
  UserPermission,
  UserPermissionSchema,
} from '../../permissions/schemas/user-permission.schema';
import {
  UserRole,
  UserRoleSchema,
} from '../../permissions/schemas/user-role.schema';
import { Agency, AgencySchema } from '../../platform/schemas/agency.schema';
import {
  AgencyRole,
  AgencyRoleSchema,
} from '../../roles/schemas/agency-role.schema';
import { User, UserSchema } from '../../users/schemas/user.schema';
import { PermissionHoldersService } from './permission-holders.service';

/**
 * `PermissionHoldersService` with the schemas it reads (PAC-161). Schemas
 * only — the worker boundary lets those across, and this is what makes the
 * resolver usable from both the API and a job.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: UserRole.name, schema: UserRoleSchema },
      { name: AgencyRole.name, schema: AgencyRoleSchema },
      { name: RolePermission.name, schema: RolePermissionSchema },
      { name: UserPermission.name, schema: UserPermissionSchema },
      { name: Agency.name, schema: AgencySchema },
    ]),
  ],
  providers: [PermissionHoldersService],
  exports: [PermissionHoldersService],
})
export class PermissionHoldersModule {}
