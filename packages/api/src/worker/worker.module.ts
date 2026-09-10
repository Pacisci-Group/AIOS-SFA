import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MailerCampaignCommitFn } from './functions/mailer-campaign-commit.fn';
import { MailerCampaignOutputEmailFn } from './functions/mailer-campaign-output-email.fn';
import { MailerCampaignPreviewFn } from './functions/mailer-campaign-preview.fn';
import { SendInviteEmailFn } from './functions/send-invite-email.fn';
import { SendPasswordResetEmailFn } from './functions/send-password-reset-email.fn';
import { SweepEventLogFn } from './functions/sweep-event-log.fn';
import { SyncTicketStatusFn } from './functions/sync-ticket-status.fn';
import { MaterializeRenewalCyclesFn } from './functions/materialize-renewal-cycles.fn';
import { RenewalMaterializationService } from '../common/renewal/renewal-materialization.service';
import { TicketNumberService } from '../common/tickets/ticket-number.service';
import { MailDeliveryService } from './email/mail-delivery.service';
import { SenderIdentityService } from './email/sender-identity.service';
import { mailTransportProvider } from './email/mail-transport.provider';
import {
  EmailMessage,
  EmailMessageSchema,
} from './email/schemas/email-message.schema';
import { WorkerIndexesService } from './worker-indexes.service';
import { TenantUrlService } from '../common/tenancy/tenant-url.service';
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
import {
  AgencyDomain,
  AgencyDomainSchema,
} from '../platform/schemas/agency-domain.schema';
import { Agency, AgencySchema } from '../platform/schemas/agency.schema';
import {
  ServiceTicket,
  ServiceTicketSchema,
} from '../crm/schemas/service-ticket.schema';
import {
  RenewalCycle,
  RenewalCycleSchema,
} from '../crm/schemas/renewal-cycle.schema';
import {
  RenewalScanState,
  RenewalScanStateSchema,
} from '../crm/schemas/renewal-scan-state.schema';
import { Policy, PolicySchema } from '../policies/schemas/policy.schema';
import {
  Household,
  HouseholdSchema,
} from '../households/schemas/household.schema';
import { Contact, ContactSchema } from '../contacts/schemas/contact.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
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
      // Same reason, for `TenantUrlService` below: the campaign completion
      // email's link back to the panel is built from the platform host, and the
      // service that decides that reads this collection.
      { name: AgencyDomain.name, schema: AgencyDomainSchema },
      // Owned by the API, registered here for the mailer campaign jobs
      // (PAC-71). Schemas are the one thing the worker boundary lets across;
      // the transform, the import engine and the assignment resolver are all
      // plain functions in `common/` for exactly that reason.
      { name: MailerCampaign.name, schema: MailerCampaignSchema },
      { name: MailerZipMarket.name, schema: MailerZipMarketSchema },
      { name: Mailer.name, schema: MailerSchema },
      { name: Carrier.name, schema: CarrierSchema },
      { name: Lead.name, schema: LeadSchema },
      // Owned by the CRM, registered here for `SyncTicketStatusFn`. The job
      // advances the stored status of scheduled calls as their deadlines pass,
      // and reaches the collection through the schema rather than
      // `ServiceTicketsService` — the worker boundary bars feature services,
      // which is why the status rule and its Mongo predicates live as pure
      // helpers in `common/scheduling/` rather than under `crm/`.
      { name: ServiceTicket.name, schema: ServiceTicketSchema },
      // The renewal materializer's collections (PAC-99). It reads the policy
      // book, groups it into cycles and opens call tickets; the worker reaches
      // all of that through schemas, which is the one thing the boundary lets
      // across. The logic itself lives in `common/renewal/` for the same reason.
      { name: RenewalCycle.name, schema: RenewalCycleSchema },
      { name: RenewalScanState.name, schema: RenewalScanStateSchema },
      { name: Policy.name, schema: PolicySchema },
      { name: Household.name, schema: HouseholdSchema },
      { name: Contact.name, schema: ContactSchema },
      { name: User.name, schema: UserSchema },
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
    // Declared here rather than reached for through `TenancyModule`, which is
    // `@Global()` only within the app that imports it — and `WorkerRootModule`
    // does not import `AppModule`. Without this the standalone worker would boot
    // and then fail to resolve it the first time a campaign finished importing.
    // Same reasoning as the explicit `StorageModule` import above. It is a
    // `common/` helper whose only dependencies are `ConfigService` and the
    // `AgencyDomain` schema, so the worker boundary is intact.
    TenantUrlService,
    // Inngest functions. Each is an @Injectable so its handler can inject
    // services; InngestRegistry (in src/inngest/) collects them by decorator,
    // so listing it here is the only registration step.
    SendInviteEmailFn,
    SendPasswordResetEmailFn,
    SweepEventLogFn,
    SyncTicketStatusFn,
    MaterializeRenewalCyclesFn,
    // Declared here as well as in `CrmModule`: the standalone worker does not
    // import `AppModule`, so without these it would boot and then fail to
    // resolve them on the first renewal tick. Same reasoning as the explicit
    // `StorageModule` and `TenantUrlService` above.
    TicketNumberService,
    RenewalMaterializationService,
    MailerCampaignPreviewFn,
    MailerCampaignCommitFn,
    MailerCampaignOutputEmailFn,
  ],
})
export class WorkerModule {}
