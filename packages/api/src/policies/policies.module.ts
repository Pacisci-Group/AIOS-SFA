import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Activity,
  ActivitySchema,
} from '../activities/schemas/activity.schema';
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
 * name from either. `Activity` is registered for the edit log a correction
 * writes (PAC-65 #9) — the same schema-only registration five other feature
 * modules already do, so it adds no dependency on `ActivitiesModule`.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Policy.name, schema: PolicySchema },
      { name: Deal.name, schema: DealSchema },
      { name: Household.name, schema: HouseholdSchema },
      { name: Activity.name, schema: ActivitySchema },
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
