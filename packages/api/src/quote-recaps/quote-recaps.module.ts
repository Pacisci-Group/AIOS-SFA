import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Activity,
  ActivitySchema,
} from '../activities/schemas/activity.schema';
import { LeadsModule } from '../leads/leads.module';
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
      { name: Activity.name, schema: ActivitySchema },
    ]),
    // For `LeadAccessService` — the shared lead scope clamp and household
    // resolver. It owns the Household model, so this module no longer needs it.
    LeadsModule,
  ],
  controllers: [QuoteRecapsController],
  providers: [QuoteRecapsService],
})
export class QuoteRecapsModule {}
