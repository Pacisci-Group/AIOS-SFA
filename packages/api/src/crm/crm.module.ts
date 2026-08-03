import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ClientsModule } from '../clients/clients.module';
import {
  AgencyRole,
  AgencyRoleSchema,
} from '../roles/schemas/agency-role.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { ServiceTicketsController } from './service-tickets.controller';
import { ServiceTicketsService } from './service-tickets.service';
import { Onboarding, OnboardingSchema } from './schemas/onboarding.schema';
import {
  RenewalCycle,
  RenewalCycleSchema,
} from './schemas/renewal-cycle.schema';
import {
  RenewalScanState,
  RenewalScanStateSchema,
} from './schemas/renewal-scan-state.schema';
import {
  OnboardingStepDefinitionRecord,
  OnboardingStepDefinitionSchema,
} from './schemas/onboarding-step-definition.schema';
import {
  ServiceTicket,
  ServiceTicketSchema,
} from './schemas/service-ticket.schema';

@Module({
  imports: [
    // Ticket creation resolves the picked household/policy through the same
    // scoped reads the Clients pages use.
    ClientsModule,
    MongooseModule.forFeature([
      { name: ServiceTicket.name, schema: ServiceTicketSchema },
      { name: User.name, schema: UserSchema },
      { name: AgencyRole.name, schema: AgencyRoleSchema },
      {
        name: OnboardingStepDefinitionRecord.name,
        schema: OnboardingStepDefinitionSchema,
      },
      { name: Onboarding.name, schema: OnboardingSchema },
      { name: RenewalCycle.name, schema: RenewalCycleSchema },
      { name: RenewalScanState.name, schema: RenewalScanStateSchema },
    ]),
  ],
  controllers: [ServiceTicketsController],
  providers: [ServiceTicketsService],
  exports: [ServiceTicketsService, MongooseModule],
})
export class CrmModule {}
