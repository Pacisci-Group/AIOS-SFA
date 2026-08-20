import { Module } from '@nestjs/common';
import { MailService } from './mail.service';

/**
 * Outbound email, API side.
 *
 * {@link MailService} emits an Inngest event; the rendering, the provider call
 * and the delivery record all live in `src/worker/mail/`. No transport is
 * imported here, and none should be — that is what keeps the API free of a mail
 * provider even after the worker moves to its own container.
 *
 * `InngestService` is not imported because `InngestModule` is `@Global()`.
 */
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
