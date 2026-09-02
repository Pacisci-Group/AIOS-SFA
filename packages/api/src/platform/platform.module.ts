import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  AuditTemplate,
  AuditTemplateSchema,
} from '../audit-templates/schemas/audit-template.schema';
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
import { UsersModule } from '../users/users.module';
import { Agency, AgencySchema } from './schemas/agency.schema';
import { AgencyProvisioningService } from './agency-provisioning.service';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';
import { PlatformUsersController } from './platform-users.controller';
import { PlatformUsersService } from './platform-users.service';

/**
 * `UsersModule` is imported for `UsersService` — onboarding (PAC-69) creates the
 * agency's owner through the same invite machinery the tenant-side users list
 * uses, so the two can never drift on token expiry, duplicate-email handling or
 * the email itself.
 *
 * That is the one place this module reaches for an agency-scoped *service*. The
 * cross-agency user directory (PAC-70) deliberately does not: it registers the
 * schemas it reads and leaves the users/branches/roles services agency-scoped.
 *
 * No cycle: `UsersModule` imports `PermissionsModule`, `MailModule` and
 * `TenantBrandingModule`, none of which reach back here.
 */
@Module({
  imports: [
    PermissionsModule,
    UsersModule,
    MongooseModule.forFeature([
      { name: Agency.name, schema: AgencySchema },
      // Read by the cross-agency user directory (PAC-70). Schemas only — the
      // users/branches/roles *services* stay agency-scoped and are not
      // imported here.
      { name: User.name, schema: UserSchema },
      { name: Branch.name, schema: BranchSchema },
      { name: AgencyRole.name, schema: AgencyRoleSchema },
      { name: UserRole.name, schema: UserRoleSchema },
      // Seeded into each new tenant by `AgencyProvisioningService` (PAC-69);
      // without them a sold deal generates no service hand-off at all.
      { name: AuditTemplate.name, schema: AuditTemplateSchema },
    ]),
  ],
  controllers: [PlatformController, PlatformUsersController],
  providers: [PlatformService, AgencyProvisioningService, PlatformUsersService],
  exports: [PlatformService, MongooseModule],
})
export class PlatformModule {}
