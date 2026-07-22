import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  AuditRecord,
  AuditRecordSchema,
} from '../audit-records/schemas/audit-record.schema';
import { Deal, DealSchema } from '../deals/schemas/deal.schema';
import { DealAuditsController } from './deal-audits.controller';
import { DealAuditsService } from './deal-audits.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AuditRecord.name, schema: AuditRecordSchema },
      { name: Deal.name, schema: DealSchema },
    ]),
  ],
  controllers: [DealAuditsController],
  providers: [DealAuditsService],
})
export class DealAuditsModule {}
