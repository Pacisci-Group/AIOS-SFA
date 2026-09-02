import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  AuditTemplate,
  AuditTemplateSchema,
} from '../audit-templates/schemas/audit-template.schema';
import { Branch, BranchSchema } from '../branches/schemas/branch.schema';
import { PermissionsModule } from '../permissions/permissions.module';
import { UsersModule } from '../users/users.module';
import { Agency, AgencySchema } from './schemas/agency.schema';
import { AgencyProvisioningService } from './agency-provisioning.service';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';

/**
 * `UsersModule` is imported for `UsersService` — onboarding creates the agency's
 * owner through the same invite machinery the tenant-side users list uses, so
 * the two can never drift on token expiry, duplicate-email handling or the
 * email itself.
 *
 * No cycle: `UsersModule` imports `PermissionsModule`, `MailModule` and
 * `TenantBrandingModule`, none of which reach back here. It registers the
 * `Agency` model itself, which is why this module still exports `MongooseModule`.
 */
@Module({
  imports: [
    PermissionsModule,
    UsersModule,
    MongooseModule.forFeature([
      { name: Agency.name, schema: AgencySchema },
      { name: Branch.name, schema: BranchSchema },
      { name: AuditTemplate.name, schema: AuditTemplateSchema },
    ]),
  ],
  controllers: [PlatformController],
  providers: [PlatformService, AgencyProvisioningService],
  exports: [PlatformService, MongooseModule],
})
export class PlatformModule {}
