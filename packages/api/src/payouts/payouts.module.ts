import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Branch, BranchSchema } from '../branches/schemas/branch.schema';
import { LeadSourcesModule } from '../lead-sources/lead-sources.module';
import {
  UserRole,
  UserRoleSchema,
} from '../permissions/schemas/user-role.schema';
import { Agency, AgencySchema } from '../platform/schemas/agency.schema';
import {
  AgencyRole,
  AgencyRoleSchema,
} from '../roles/schemas/agency-role.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { PaymentStructuresService } from './payment-structures.service';
import { PayoutSettingsService } from './payout-settings.service';
import { PayoutsAdminController } from './payouts-admin.controller';
import {
  PaymentStructure,
  PaymentStructureSchema,
} from './schemas/payment-structure.schema';

/**
 * Payouts (PAC-176). PAC-177 brings the admin half — payout settings and
 * payment structures; statements, the monthly job and the chargeback import
 * follow in PAC-178…182.
 *
 * `LeadSourcesModule` for the structures' lead-source rates: the service
 * checks each source is the agency's to use and names it on read.
 */
@Module({
  imports: [
    LeadSourcesModule,
    MongooseModule.forFeature([
      { name: PaymentStructure.name, schema: PaymentStructureSchema },
      { name: Agency.name, schema: AgencySchema },
      { name: User.name, schema: UserSchema },
      { name: AgencyRole.name, schema: AgencyRoleSchema },
      { name: UserRole.name, schema: UserRoleSchema },
      { name: Branch.name, schema: BranchSchema },
    ]),
  ],
  controllers: [PayoutsAdminController],
  providers: [PayoutSettingsService, PaymentStructuresService],
})
export class PayoutsModule {}
