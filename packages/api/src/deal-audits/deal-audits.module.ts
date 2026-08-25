import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Activity,
  ActivitySchema,
} from '../activities/schemas/activity.schema';
import {
  DealAuditItem,
  DealAuditItemSchema,
} from '../deal-audit-items/schemas/deal-audit-item.schema';
import { Deal, DealSchema } from '../deals/schemas/deal.schema';
import {
  AgencyRole,
  AgencyRoleSchema,
} from '../roles/schemas/agency-role.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { DealAuditsController } from './deal-audits.controller';
import { DealAuditsService } from './deal-audits.service';
import { DealAudit, DealAuditSchema } from './schemas/deal-audit.schema';

// StorageService is provided by the global StorageModule (see app.module).
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DealAuditItem.name, schema: DealAuditItemSchema },
      { name: Deal.name, schema: DealSchema },
      { name: Activity.name, schema: ActivitySchema },
      // The board's driving collection + the two lookups that turn an
      // `auditAssignee.id` into a display name (PAC-72).
      { name: DealAudit.name, schema: DealAuditSchema },
      { name: User.name, schema: UserSchema },
      { name: AgencyRole.name, schema: AgencyRoleSchema },
    ]),
  ],
  controllers: [DealAuditsController],
  providers: [DealAuditsService],
})
export class DealAuditsModule {}
