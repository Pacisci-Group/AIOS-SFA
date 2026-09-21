import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Deal, DealSchema } from '../deals/schemas/deal.schema';
import { LeadSourcesModule } from '../lead-sources/lead-sources.module';
import { Lead, LeadSchema } from '../leads/schemas/lead.schema';
import {
  QuoteRecap,
  QuoteRecapSchema,
} from '../quote-recaps/schemas/quote-recap.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { OwnerDashboardController } from './owner-dashboard.controller';
import { OwnerDashboardService } from './owner-dashboard.service';

/**
 * The Owner View dashboard (PAC-135).
 *
 * Schema registrations rather than module imports, the house pattern for a pure
 * read model: this module aggregates `deals`, `quoteRecaps` and `leads` and
 * wants none of their services. `policies` is reached by `$lookup`, which needs
 * no model. `LeadSourcesModule` is the one real import — it names the rows of the
 * lead-source table.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Deal.name, schema: DealSchema },
      { name: QuoteRecap.name, schema: QuoteRecapSchema },
      { name: Lead.name, schema: LeadSchema },
      { name: User.name, schema: UserSchema },
    ]),
    LeadSourcesModule,
  ],
  controllers: [OwnerDashboardController],
  providers: [OwnerDashboardService],
})
export class OwnerDashboardModule {}
