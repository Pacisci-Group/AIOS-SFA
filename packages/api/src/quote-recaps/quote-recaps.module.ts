import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Activity,
  ActivitySchema,
} from '../activities/schemas/activity.schema';
import {
  Household,
  HouseholdSchema,
} from '../households/schemas/household.schema';
import { Lead, LeadSchema } from '../leads/schemas/lead.schema';
import { QuoteRecapsController } from './quote-recaps.controller';
import { QuoteRecapsService } from './quote-recaps.service';
import { QuoteRecap, QuoteRecapSchema } from './schemas/quote-recap.schema';

@Module({
  imports: [
    // `StorageService` and `TenantContextResolver` come from the global
    // StorageModule / TenancyModule, so they are not imported here.
    MongooseModule.forFeature([
      { name: QuoteRecap.name, schema: QuoteRecapSchema },
      { name: Lead.name, schema: LeadSchema },
      { name: Household.name, schema: HouseholdSchema },
      { name: Activity.name, schema: ActivitySchema },
    ]),
  ],
  controllers: [QuoteRecapsController],
  providers: [QuoteRecapsService],
})
export class QuoteRecapsModule {}
