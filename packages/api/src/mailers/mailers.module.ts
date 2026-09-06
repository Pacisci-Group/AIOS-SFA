import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Carrier, CarrierSchema } from '../carriers/schemas/carrier.schema';
import { InngestModule } from '../inngest/inngest.module';
import { Lead, LeadSchema } from '../leads/schemas/lead.schema';
import { LeadsModule } from '../leads/leads.module';
import { Agency, AgencySchema } from '../platform/schemas/agency.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { MailerCampaignsService } from './mailer-campaigns.service';
import { MailerZipMarketsService } from './mailer-zip-markets.service';
import { MailersController } from './mailers.controller';
import { MailersService } from './mailers.service';
import { PlatformMailerCampaignsController } from './platform-mailer-campaigns.controller';
import { PlatformMailerZipMarketsController } from './platform-mailer-zip-markets.controller';
import { Mailer, MailerSchema } from './schemas/mailer.schema';
import {
  MailerCampaign,
  MailerCampaignSchema,
} from './schemas/mailer-campaign.schema';
import {
  MailerZipMarket,
  MailerZipMarketSchema,
} from './schemas/mailer-zip-market.schema';

/**
 * Mailers — the collection, the campaigns that write it, and the drawer that
 * reads it.
 *
 * **Agency side (PAC-61):** `MailersController` on `mailers` is the QCN lookup
 * and log-lead behind the Mailers drawer. It replaced the generated stub in
 * `feature-modules/feature.controllers.ts` in the same commit that added it —
 * two classes on `@Controller('mailers')` both register and which one answers
 * depends on module import order, so leaving the stub for later was never an
 * option. `ContactsController` and `PerformanceController` set the precedent.
 *
 * **Platform side (PAC-71):** `PlatformMailerCampaignsController` runs a
 * campaign from the vendor file and `PlatformMailerZipMarketsController` owns
 * the ZIP → market table it resolves against. Both sit on the platform guard
 * stack and neither parses a file — the transform and the import happen in the
 * worker. They replace the Add Mailers upload flow, which was deleted in the
 * schema refactor because `ImportMailersFn` could not compile against the
 * campaign-shaped import engine without inventing a throwaway campaign for it.
 *
 * `LeadsModule` is imported for `LeadIntakeService`: logging a lead runs the
 * *same* pipeline as the New Lead form and the public share-link route, so
 * matching, dedupe, linking and assignment are written once. No cycle —
 * `LeadsModule` imports nothing from here, and `share-links`, `sold-deals` and
 * `quote-recaps` all depend on it the same way.
 *
 * `Lead` is registered here rather than reached for through `LeadsModule`
 * because the drawer needs to *read* leads (is this mailer already logged, and
 * by someone this caller can see?) without a service of its own. Registering
 * another module's schema is the house pattern — see the note in `crm.module.ts`.
 *
 * `Carrier` and `User` are registered for the campaign read paths: the carrier's
 * display name and the requesting operator's, both resolved server-side so no
 * client has to join.
 *
 * `StorageService` and `TenantContextResolver` come from global modules and
 * need no import here.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Mailer.name, schema: MailerSchema },
      { name: MailerCampaign.name, schema: MailerCampaignSchema },
      { name: MailerZipMarket.name, schema: MailerZipMarketSchema },
      { name: Agency.name, schema: AgencySchema },
      { name: Carrier.name, schema: CarrierSchema },
      { name: User.name, schema: UserSchema },
      { name: Lead.name, schema: LeadSchema },
    ]),
    InngestModule,
    LeadsModule,
  ],
  controllers: [
    MailersController,
    PlatformMailerCampaignsController,
    PlatformMailerZipMarketsController,
  ],
  providers: [MailersService, MailerCampaignsService, MailerZipMarketsService],
  // Exported so the demo seed and the BigQuery backfill can inject the models
  // without re-registering the schemas — the same thing `PlatformModule` does.
  exports: [MongooseModule],
})
export class MailersModule {}
