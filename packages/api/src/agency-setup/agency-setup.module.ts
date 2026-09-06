import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PermissionsModule } from '../permissions/permissions.module';
import { Agency, AgencySchema } from '../platform/schemas/agency.schema';
import { AgencySetupController } from './agency-setup.controller';
import { AgencySetupService } from './agency-setup.service';

@Module({
  imports: [
    PermissionsModule,
    MongooseModule.forFeature([{ name: Agency.name, schema: AgencySchema }]),
  ],
  controllers: [AgencySetupController],
  providers: [AgencySetupService],
})
export class AgencySetupModule {}
