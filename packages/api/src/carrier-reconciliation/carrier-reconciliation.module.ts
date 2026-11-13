import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Carrier, CarrierSchema } from '../carriers/schemas/carrier.schema';
import { Deal, DealSchema } from '../deals/schemas/deal.schema';
import { Agency, AgencySchema } from '../platform/schemas/agency.schema';
import { Policy, PolicySchema } from '../policies/schemas/policy.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { CarrierReconciliationController } from './carrier-reconciliation.controller';
import { ReconciliationRunsService } from './reconciliation-runs.service';
import {
  ReconciliationRow,
  ReconciliationRowSchema,
} from './schemas/reconciliation-row.schema';
import {
  ReconciliationRun,
  ReconciliationRunSchema,
} from './schemas/reconciliation-run.schema';

/**
 * The Dash Reconciliation page. Schema registrations rather than feature
 * imports — it reads deals and policies and wants none of their services.
 * `StorageService` is global.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ReconciliationRun.name, schema: ReconciliationRunSchema },
      { name: ReconciliationRow.name, schema: ReconciliationRowSchema },
      { name: Deal.name, schema: DealSchema },
      { name: Policy.name, schema: PolicySchema },
      { name: Agency.name, schema: AgencySchema },
      { name: Carrier.name, schema: CarrierSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [CarrierReconciliationController],
  providers: [ReconciliationRunsService],
})
export class CarrierReconciliationModule {}
