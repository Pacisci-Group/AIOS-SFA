import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Deal, DealSchema } from '../deals/schemas/deal.schema';
import {
  Household,
  HouseholdSchema,
} from '../households/schemas/household.schema';
import {
  ProducerAssignment,
  ProducerAssignmentSchema,
} from '../producer-assignments/schemas/producer-assignment.schema';
import { CrmAssignmentService } from './crm-assignment.service';
import { CrmRotation, CrmRotationSchema } from './schemas/crm-rotation.schema';

/**
 * CRM round-robin (PAC-40).
 *
 * Schema-only until now: `crmRotations` and `producerAssignments` were
 * populated by the migration but never read, so a sold deal reached the service
 * team unassigned.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CrmRotation.name, schema: CrmRotationSchema },
      { name: ProducerAssignment.name, schema: ProducerAssignmentSchema },
      { name: Household.name, schema: HouseholdSchema },
      { name: Deal.name, schema: DealSchema },
    ]),
  ],
  providers: [CrmAssignmentService],
  exports: [CrmAssignmentService],
})
export class CrmRotationsModule {}
