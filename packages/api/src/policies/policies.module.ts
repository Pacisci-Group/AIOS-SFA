import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CarriersModule } from '../carriers/carriers.module';
import { Deal, DealSchema } from '../deals/schemas/deal.schema';
import {
  Household,
  HouseholdSchema,
} from '../households/schemas/household.schema';
import { PoliciesController } from './policies.controller';
import { PoliciesService } from './policies.service';
import { Policy, PolicySchema } from './schemas/policy.schema';

/**
 * Policies (PAC-40).
 *
 * The schema existed but was registered nowhere, so its indexes were never
 * built and no runtime code could inject the model. Registering it is a
 * prerequisite for both the `policyNumberKey` backfill and
 * `GET /policies/check`.
 *
 * `Deal` and `Household` are registered because the duplicate check resolves a
 * match's owner from its deal (policies carry no `producerId`) and its client
 * name from either.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Policy.name, schema: PolicySchema },
      { name: Deal.name, schema: DealSchema },
      { name: Household.name, schema: HouseholdSchema },
    ]),
    // Supplies the carrier's policy-number rule when a correction changes the
    // number (PAC-56 #20).
    CarriersModule,
  ],
  controllers: [PoliciesController],
  providers: [PoliciesService],
  exports: [MongooseModule],
})
export class PoliciesModule {}
