import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SendInviteEmailFn } from './functions/send-invite-email.fn';
import { MailDeliveryService } from './email/mail-delivery.service';
import { mailTransportProvider } from './email/mail-transport.provider';
import {
  EmailMessage,
  EmailMessageSchema,
} from './email/schemas/email-message.schema';
import { WorkerIndexesService } from './worker-indexes.service';

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
    ]),
  ],
  providers: [
    WorkerIndexesService,
    mailTransportProvider,
    MailDeliveryService,
    // Inngest functions. Each is an @Injectable so its handler can inject
    // services; InngestRegistry (in src/inngest/) collects them by decorator,
    // so listing it here is the only registration step.
    SendInviteEmailFn,
  ],
})
export class WorkerModule {}
