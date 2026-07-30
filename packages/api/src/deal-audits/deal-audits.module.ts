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
import { DealAuditsController } from './deal-audits.controller';
import { DealAuditsService } from './deal-audits.service';

// StorageService is provided by the global StorageModule (see app.module).
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DealAuditItem.name, schema: DealAuditItemSchema },
      { name: Deal.name, schema: DealSchema },
      { name: Activity.name, schema: ActivitySchema },
    ]),
  ],
  controllers: [DealAuditsController],
  providers: [DealAuditsService],
})
export class DealAuditsModule {}
