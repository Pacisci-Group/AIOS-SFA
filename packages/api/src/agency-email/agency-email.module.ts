import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Agency, AgencySchema } from '../platform/schemas/agency.schema';
import { AgencyEmailController } from './agency-email.controller';
import { AgencyEmailService } from './agency-email.service';
import { emailProviderClientProvider } from './email-provider.client';

/**
 * Per-agency sender identity.
 *
 * Lives on the API side, not in `WorkerModule`, even though it is about email:
 * registering a domain is a synchronous thing an owner does in a settings form
 * and needs an answer to, while *sending* is asynchronous work the worker owns.
 * The two share only the pure `common/mail/sender-address.ts` helper, which is
 * what keeps the address shown here identical to the one that goes out.
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Agency.name, schema: AgencySchema }]),
  ],
  controllers: [AgencyEmailController],
  providers: [AgencyEmailService, emailProviderClientProvider],
})
export class AgencyEmailModule {}
