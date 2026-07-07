import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PermissionsModule } from '../permissions/permissions.module';
import { Agency, AgencySchema } from './schemas/agency.schema';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';

@Module({
  imports: [
    PermissionsModule,
    MongooseModule.forFeature([{ name: Agency.name, schema: AgencySchema }]),
  ],
  controllers: [PlatformController],
  providers: [PlatformService],
  exports: [PlatformService, MongooseModule],
})
export class PlatformModule {}
