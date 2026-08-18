import { Module } from '@nestjs/common';
import { MailService } from './mail.service';

/**
 * Outbound email. See {@link MailService} — delivery is a documented stub until
 * the email architecture is decided (PAC-58 Scope 1 deferred).
 */
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
