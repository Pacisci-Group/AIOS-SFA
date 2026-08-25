import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { InngestModule } from '../inngest/inngest.module';
import { Lead, LeadSchema } from '../leads/schemas/lead.schema';
import { LeadsModule } from '../leads/leads.module';
import { Agency, AgencySchema } from '../platform/schemas/agency.schema';
import { MailersController } from './mailers.controller';
import { MailersService } from './mailers.service';
import { PlatformMailersController } from './platform-mailers.controller';
import { PlatformMailersService } from './platform-mailers.service';
import { Mailer, MailerSchema } from './schemas/mailer.schema';
import {
  MailerImportRun,
  MailerImportRunSchema,
} from './schemas/mailer-import-run.schema';

/**
 * Mailers — both halves.
 *
 * **Platform side (PAC-73):** `PlatformMailersController` on `platform/mailers`
 * turns an uploaded RTP file into `mailers` documents.
 *
 * **Agency side (PAC-61):** `MailersController` on `mailers` is the QCN lookup
 * and log-lead behind the Mailers drawer. It replaced the generated stub in
 * `feature-modules/feature.controllers.ts` in the same commit that added it —
 * two classes on `@Controller('mailers')` both register and which one answers
 * depends on module import order, so leaving the stub for later was never an
 * option. `ContactsController` and `PerformanceController` set the precedent.
 *
 * `LeadsModule` is imported for `LeadIntakeService`: logging a lead runs the
 * *same* pipeline as the New Lead form and the public share-link route, so
 * matching, dedupe, linking and assignment are written once. No cycle —
 * `LeadsModule` imports nothing from here, and `share-links`, `sold-deals` and
 * `quote-recaps` all depend on it the same way.
 *
 * `Lead` is registered here rather than reached for through `LeadsModule`
 * because the drawer needs to *read* leads (has this mailer already been
 * logged, and by someone this caller can see?) without a service of its own.
 * Registering another module's schema is the house pattern — see the note in
 * `crm.module.ts`.
 *
 * `StorageService` and `TenantContextResolver` come from global modules and
 * need no import here.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Mailer.name, schema: MailerSchema },
      { name: MailerImportRun.name, schema: MailerImportRunSchema },
      { name: Agency.name, schema: AgencySchema },
      { name: Lead.name, schema: LeadSchema },
    ]),
    InngestModule,
    LeadsModule,
  ],
  controllers: [MailersController, PlatformMailersController],
  providers: [MailersService, PlatformMailersService],
  // Exported so the demo seed and the BigQuery backfill can inject the models
  // without re-registering the schemas — the same thing `PlatformModule` does.
  exports: [MongooseModule],
})
export class MailersModule {}
