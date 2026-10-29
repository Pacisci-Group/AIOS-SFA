import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Carrier, CarrierSchema } from '../carriers/schemas/carrier.schema';
import {
  Chargeback,
  ChargebackSchema,
} from '../chargebacks/schemas/chargeback.schema';
import { Deal, DealSchema } from '../deals/schemas/deal.schema';
import { Agency, AgencySchema } from '../platform/schemas/agency.schema';
import { PermissionsModule } from '../permissions/permissions.module';
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
import { ReconciliationOutcomesService } from './reconciliation-outcomes.service';
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
 * registrations rather than feature imports — it reads deals, policies,
 * chargebacks and who holds which role, and wants none of their services.
 * `StorageService` and `InngestService` are global.
 *
 * `PermissionsModule` is the one feature import: who may be given a row
 * missing from the app is decided by effective permission
 * (`PermissionsService.resolveForUser`), which is not to be reimplemented. It
 * imports nothing but Redis, so no cycle is possible.
 *
 * Exports `ReconciliationOutcomesService` for the two forms an assignee
 * records a sale through (PAC-173 PR 4): `LeadsModule` links the lead,
 * `SoldDealsModule` books the sale. Acyclic because this module imports
 * neither of them, nor anything that does — keep it that way, or the two
 * hooks need `forwardRef`.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ReconciliationRun.name, schema: ReconciliationRunSchema },
      { name: ReconciliationRow.name, schema: ReconciliationRowSchema },
      { name: Deal.name, schema: DealSchema },
      { name: Policy.name, schema: PolicySchema },
      // Read-only: the chargeback a cancel-rewrite outcome links.
      { name: Chargeback.name, schema: ChargebackSchema },
      { name: Agency.name, schema: AgencySchema },
      { name: Carrier.name, schema: CarrierSchema },
      { name: User.name, schema: UserSchema },
      { name: AgencyRole.name, schema: AgencyRoleSchema },
      { name: UserRole.name, schema: UserRoleSchema },
    ]),
    PermissionsModule,
  ],
  controllers: [
    CarrierReconciliationController,
    ReconciliationAssignmentsController,
  ],
  providers: [
    ReconciliationRunsService,
    ReconciliationAssignmentsService,
    ReconciliationOutcomesService,
  ],
  exports: [ReconciliationOutcomesService],
})
export class CarrierReconciliationModule {}
