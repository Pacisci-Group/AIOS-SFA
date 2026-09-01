import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Agency, AgencySchema } from '../platform/schemas/agency.schema';
import { StorageModule } from '../storage/storage.module';
import { AgencyBrandingService } from './agency-branding.service';
import {
  AgencyBrandingController,
  TenantBootstrapController,
} from './tenant-branding.controller';
import { TenantBrandingService } from './tenant-branding.service';

/**
 * White-label identity: the public read path the SPA and email templates use,
 * and the owner-facing write path behind `agency:branding:*`.
 *
 * `TenantBrandingService` is exported because the worker's mail path needs the
 * same fallback chain — an email header and the app sidebar disagreeing about
 * an agency's name is exactly the bug this module exists to prevent.
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Agency.name, schema: AgencySchema }]),
    StorageModule,
  ],
  controllers: [TenantBootstrapController, AgencyBrandingController],
  providers: [TenantBrandingService, AgencyBrandingService],
  exports: [TenantBrandingService],
})
export class TenantBrandingModule {}
