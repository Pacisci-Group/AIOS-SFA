import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Agency, AgencySchema } from '../platform/schemas/agency.schema';
import { AgencyRole, AgencyRoleSchema } from '../roles/schemas/agency-role.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { PermissionsService } from './permissions.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: AgencyRole.name, schema: AgencyRoleSchema },
      { name: Agency.name, schema: AgencySchema },
    ]),
  ],
  providers: [PermissionsService],
  exports: [PermissionsService, MongooseModule],
})
export class PermissionsModule {}
