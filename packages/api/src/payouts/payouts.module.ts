import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Branch, BranchSchema } from '../branches/schemas/branch.schema';
import { Carrier, CarrierSchema } from '../carriers/schemas/carrier.schema';
import {
  Chargeback,
  ChargebackSchema,
} from '../chargebacks/schemas/chargeback.schema';
import { Contact, ContactSchema } from '../contacts/schemas/contact.schema';
import {
  DealAudit,
  DealAuditSchema,
} from '../deal-audits/schemas/deal-audit.schema';
import { Deal, DealSchema } from '../deals/schemas/deal.schema';
import {
  Household,
  HouseholdSchema,
} from '../households/schemas/household.schema';
import {
  LeadSource,
  LeadSourceSchema,
} from '../lead-sources/schemas/lead-source.schema';
import { LeadSourcesModule } from '../lead-sources/lead-sources.module';
import {
  UserRole,
  UserRoleSchema,
} from '../permissions/schemas/user-role.schema';
import { Agency, AgencySchema } from '../platform/schemas/agency.schema';
import { Policy, PolicySchema } from '../policies/schemas/policy.schema';
import {
  AgencyRole,
  AgencyRoleSchema,
} from '../roles/schemas/agency-role.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { ChargebackImportsService } from './chargeback-imports.service';
import { PayStatementsService } from './pay-statements.service';
import { PaymentStructuresService } from './payment-structures.service';
import { PayoutActivityService } from './payout-activity.service';
import { PayoutModelsService } from './payout-models.service';
import { PayoutRunsService } from './payout-runs.service';
import { PayoutSettingsService } from './payout-settings.service';
import { PayoutsAdminController } from './payouts-admin.controller';
import { PayoutsImportsController } from './payouts-imports.controller';
import { PayoutsStatementsController } from './payouts-statements.controller';
import {
  ChargebackImport,
  ChargebackImportSchema,
} from './schemas/chargeback-import.schema';
import {
  PaymentStructure,
  PaymentStructureSchema,
} from './schemas/payment-structure.schema';
import { PayoutRun, PayoutRunSchema } from './schemas/payout-run.schema';
import {
  PayStatement,
  PayStatementSchema,
} from './schemas/pay-statement.schema';

/**
 * Payouts (PAC-176). PAC-177 brought the admin half — payout settings and
 * payment structures; PAC-178/179 the monthly statements, the run that drafts
 * them and the activity behind them; PAC-180 the carrier chargeback report
 * import. The PDF and the sign-off follow in PAC-181/182.
 *
 * `LeadSourcesModule` for the structures' lead-source rates: the service
 * checks each source is the agency's to use and names it on read. The
 * statement engine itself reads only models (`PayoutModelsService`), the
 * same ones the monthly job registers in the worker.
 */
@Module({
  imports: [
    LeadSourcesModule,
    MongooseModule.forFeature([
      { name: PaymentStructure.name, schema: PaymentStructureSchema },
      { name: PayoutRun.name, schema: PayoutRunSchema },
      { name: PayStatement.name, schema: PayStatementSchema },
      { name: Agency.name, schema: AgencySchema },
      { name: User.name, schema: UserSchema },
      { name: AgencyRole.name, schema: AgencyRoleSchema },
      { name: UserRole.name, schema: UserRoleSchema },
      { name: Branch.name, schema: BranchSchema },
      { name: Deal.name, schema: DealSchema },
      { name: Policy.name, schema: PolicySchema },
      { name: Chargeback.name, schema: ChargebackSchema },
      { name: DealAudit.name, schema: DealAuditSchema },
      { name: Household.name, schema: HouseholdSchema },
      { name: Contact.name, schema: ContactSchema },
      { name: Carrier.name, schema: CarrierSchema },
      { name: LeadSource.name, schema: LeadSourceSchema },
      { name: ChargebackImport.name, schema: ChargebackImportSchema },
    ]),
  ],
  controllers: [
    PayoutsAdminController,
    PayoutsStatementsController,
    PayoutsImportsController,
  ],
  providers: [
    PayoutSettingsService,
    PaymentStructuresService,
    PayoutModelsService,
    PayoutRunsService,
    PayStatementsService,
    PayoutActivityService,
    ChargebackImportsService,
  ],
})
export class PayoutsModule {}
