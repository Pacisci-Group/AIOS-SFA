import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HouseholdMembersService } from './household-members.service';
import {
  HouseholdMember,
  HouseholdMemberSchema,
} from './schemas/household-member.schema';

/**
 * The `householdMembers` join collection and the one service over it
 * (PAC-91 §5).
 *
 * Its own module because membership is read and written from four feature
 * modules — clients (the Household page), leads (intake and Lead Detail),
 * sold deals (the defensive-driver picker) and contacts (the ownership probe)
 * — and the alternative, registering the model ad hoc wherever it is needed, is
 * exactly what left `Contact` without an owner until PAC-38.
 *
 * `MongooseModule` is re-exported so the seeds and the SmartSuite importer can
 * inject the model directly; they write memberships in bulk and have no use for
 * the request-shaped service.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: HouseholdMember.name, schema: HouseholdMemberSchema },
    ]),
  ],
  providers: [HouseholdMembersService],
  exports: [HouseholdMembersService, MongooseModule],
})
export class HouseholdMembersModule {}
