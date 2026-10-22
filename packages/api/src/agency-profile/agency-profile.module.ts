import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PermissionsModule } from '../permissions/permissions.module';
import { Agency, AgencySchema } from '../platform/schemas/agency.schema';
import { AgencyProfileController } from './agency-profile.controller';
import { AgencyProfileService } from './agency-profile.service';

@Module({
  imports: [
    PermissionsModule,
    MongooseModule.forFeature([{ name: Agency.name, schema: AgencySchema }]),
  ],
  controllers: [AgencyProfileController],
  providers: [AgencyProfileService],
})
export class AgencyProfileModule {}
