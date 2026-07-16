import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Agency, AgencySchema } from '../platform/schemas/agency.schema';
import { AgencyRole, AgencyRoleSchema } from './schemas/agency-role.schema';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AgencyRole.name, schema: AgencyRoleSchema },
      { name: Agency.name, schema: AgencySchema },
    ]),
  ],
  controllers: [RolesController],
  providers: [RolesService],
  exports: [RolesService, MongooseModule],
})
export class RolesModule {}
