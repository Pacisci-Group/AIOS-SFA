import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  DealAuditItem,
  DealAuditItemSchema,
} from '../deal-audit-items/schemas/deal-audit-item.schema';
import { Deal, DealSchema } from '../deals/schemas/deal.schema';
import { DealAuditsController } from './deal-audits.controller';
import { DealAuditsService } from './deal-audits.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DealAuditItem.name, schema: DealAuditItemSchema },
      { name: Deal.name, schema: DealSchema },
    ]),
  ],
  controllers: [DealAuditsController],
  providers: [DealAuditsService],
})
export class DealAuditsModule {}
