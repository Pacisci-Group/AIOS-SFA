import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MailerCampaignCommitFn } from './functions/mailer-campaign-commit.fn';
import { MailerCampaignPreviewFn } from './functions/mailer-campaign-preview.fn';
import { SendInviteEmailFn } from './functions/send-invite-email.fn';
import { SendPasswordResetEmailFn } from './functions/send-password-reset-email.fn';
import { SweepEventLogFn } from './functions/sweep-event-log.fn';
import { MailDeliveryService } from './email/mail-delivery.service';
import { SenderIdentityService } from './email/sender-identity.service';
import { mailTransportProvider } from './email/mail-transport.provider';
import {
  EmailMessage,
  EmailMessageSchema,
} from './email/schemas/email-message.schema';
import { WorkerIndexesService } from './worker-indexes.service';
import { Carrier, CarrierSchema } from '../carriers/schemas/carrier.schema';
import { Lead, LeadSchema } from '../leads/schemas/lead.schema';
import {
  MailerCampaign,
  MailerCampaignSchema,
} from '../mailers/schemas/mailer-campaign.schema';
import {
  MailerZipMarket,
  MailerZipMarketSchema,
} from '../mailers/schemas/mailer-zip-market.schema';
import { Mailer, MailerSchema } from '../mailers/schemas/mailer.schema';
import { Agency, AgencySchema } from '../platform/schemas/agency.schema';
import { StorageModule } from '../storage/storage.module';

/**
 * All asynchronous work: Inngest function bodies, and every outbound email.
 *
 * ## This is a feature module, not a root module
 * It deliberately declares **no** `ConfigModule.forRoot` and **no**
 * `MongooseModule.forRootAsync`, so that importing it into `AppModule` does not
 * open a second MongoDB connection. The standalone entrypoint gets those from
 * {@link WorkerRootModule} instead. That split is the whole reason the same
 * module can run in-process today and as its own container tomorrow with no
 * code change.
 *
 * ## Import boundary — enforced by eslint, not by convention
 * Nothing outside `src/worker/` may import from it. The API side hands work over
 * by sending an event from `src/inngest/events/`, never by injecting anything
 * declared here. Without that rule someone injects `MailDeliveryService` into a
 * controller within a month and the worker can no longer be extracted.
 *
 * The rule runs the other way too: this module must not import feature
 * *services* (`leads/*.service`, `crm/*.service`, …). Schemas and pure helpers
 * are fine. If a function needs domain logic that today lives in a service, the
 * fix is to extract the pure part into a helper — the same split the codebase
 * already makes between `intake.normalize.ts` and `LeadIntakeService`.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: EmailMessage.name, schema: EmailMessageSchema },
      // Owned by the API, registered here so `SenderIdentityService` can read
      // the per-agency `From:`/`Reply-To`. Schemas are the one thing the worker
      // boundary lets across (see `eslint.config.mjs`); duplicating them would
      // be strictly worse.
      { name: Agency.name, schema: AgencySchema },
      // Owned by the API, registered here for the mailer campaign jobs
      // (PAC-71). Schemas are the one thing the worker boundary lets across;
      // the transform, the import engine and the assignment resolver are all
      // plain functions in `common/` for exactly that reason.
      { name: MailerCampaign.name, schema: MailerCampaignSchema },
      { name: MailerZipMarket.name, schema: MailerZipMarketSchema },
      { name: Mailer.name, schema: MailerSchema },
      { name: Carrier.name, schema: CarrierSchema },
      { name: Lead.name, schema: LeadSchema },
    ]),
    // Imported explicitly rather than relying on `StorageModule` being
    // `@Global()`: a global module is only global within the app that imports
    // it, and `WorkerRootModule` does not import `AppModule`. Without this the
    // standalone worker would boot fine and then fail to resolve
    // `StorageService` the first time a file needed reading. The mailer campaign
    // jobs (PAC-71) are the next thing that will need it.
    StorageModule,
  ],
  providers: [
    WorkerIndexesService,
    mailTransportProvider,
    // Resolves the per-agency `From:`/`Reply-To`. Reads the `Agency` document
    // (registered above) — a schema, which the worker import boundary allows.
    SenderIdentityService,
    MailDeliveryService,
    // Inngest functions. Each is an @Injectable so its handler can inject
    // services; InngestRegistry (in src/inngest/) collects them by decorator,
    // so listing it here is the only registration step.
    SendInviteEmailFn,
    SendPasswordResetEmailFn,
    SweepEventLogFn,
    MailerCampaignPreviewFn,
    MailerCampaignCommitFn,
  ],
})
export class WorkerModule {}
