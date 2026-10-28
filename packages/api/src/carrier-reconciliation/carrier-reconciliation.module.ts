import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Carrier, CarrierSchema } from '../carriers/schemas/carrier.schema';
import { Deal, DealSchema } from '../deals/schemas/deal.schema';
import { Agency, AgencySchema } from '../platform/schemas/agency.schema';
import {
  UserRole,
  UserRoleSchema,
} from '../permissions/schemas/user-role.schema';
import { Policy, PolicySchema } from '../policies/schemas/policy.schema';
import {
  AgencyRole,
  AgencyRoleSchema,
} from '../roles/schemas/agency-role.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { CarrierReconciliationController } from './carrier-reconciliation.controller';
import { ReconciliationAssignmentsController } from './reconciliation-assignments.controller';
import { ReconciliationAssignmentsService } from './reconciliation-assignments.service';
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
 * The Dash Reconciliation page, and the assignee's side of it. Schema
 * registrations rather than feature imports — it reads deals, policies and
 * who holds which role, and wants none of their services. `StorageService`
 * and `InngestService` are global.
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
      { name: AgencyRole.name, schema: AgencyRoleSchema },
      { name: UserRole.name, schema: UserRoleSchema },
    ]),
  ],
  controllers: [
    CarrierReconciliationController,
    ReconciliationAssignmentsController,
  ],
  providers: [ReconciliationRunsService, ReconciliationAssignmentsService],
})
export class CarrierReconciliationModule {}
