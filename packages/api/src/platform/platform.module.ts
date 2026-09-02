import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Branch, BranchSchema } from '../branches/schemas/branch.schema';
import { PermissionsModule } from '../permissions/permissions.module';
import {
  UserRole,
  UserRoleSchema,
} from '../permissions/schemas/user-role.schema';
import {
  AgencyRole,
  AgencyRoleSchema,
} from '../roles/schemas/agency-role.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { Agency, AgencySchema } from './schemas/agency.schema';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';
import { PlatformUsersController } from './platform-users.controller';
import { PlatformUsersService } from './platform-users.service';

@Module({
  imports: [
    PermissionsModule,
    MongooseModule.forFeature([
      { name: Agency.name, schema: AgencySchema },
      // Read by the cross-agency user directory (PAC-70). Schemas only — the
      // users/branches/roles *services* stay agency-scoped and are not
      // imported here.
      { name: User.name, schema: UserSchema },
      { name: Branch.name, schema: BranchSchema },
      { name: AgencyRole.name, schema: AgencyRoleSchema },
      { name: UserRole.name, schema: UserRoleSchema },
    ]),
  ],
  controllers: [PlatformController, PlatformUsersController],
  providers: [PlatformService, PlatformUsersService],
  exports: [PlatformService, MongooseModule],
})
export class PlatformModule {}
