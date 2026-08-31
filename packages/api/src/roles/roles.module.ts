import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PermissionsModule } from '../permissions/permissions.module';
import { Agency, AgencySchema } from '../platform/schemas/agency.schema';
import {
  UserRole,
  UserRoleSchema,
} from '../permissions/schemas/user-role.schema';
import { AgencyRole, AgencyRoleSchema } from './schemas/agency-role.schema';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';

@Module({
  imports: [
    PermissionsModule,
    MongooseModule.forFeature([
      { name: AgencyRole.name, schema: AgencyRoleSchema },
      { name: Agency.name, schema: AgencySchema },
      { name: UserRole.name, schema: UserRoleSchema },
    ]),
  ],
  controllers: [RolesController],
  providers: [RolesService],
  exports: [RolesService, MongooseModule],
})
export class RolesModule {}
