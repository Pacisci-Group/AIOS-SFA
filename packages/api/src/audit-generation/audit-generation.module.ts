import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditTemplatesModule } from '../audit-templates/audit-templates.module';
import {
  DealAudit,
  DealAuditSchema,
} from '../deal-audits/schemas/deal-audit.schema';
import {
  DealAuditItem,
  DealAuditItemSchema,
} from '../deal-audit-items/schemas/deal-audit-item.schema';
import { Deal, DealSchema } from '../deals/schemas/deal.schema';
import { AuditGenerationService } from './audit-generation.service';

/**
 * Post-sale audit generation (PAC-40).
 *
 * Imported by `SoldDealsModule` and invoked post-commit — the module boundary
 * keeps the generator independent of the write path, so the backfill of an
 * older deal can reuse it later without dragging the intake pipeline along.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DealAuditItem.name, schema: DealAuditItemSchema },
      { name: DealAudit.name, schema: DealAuditSchema },
      { name: Deal.name, schema: DealSchema },
    ]),
    AuditTemplatesModule,
  ],
  providers: [AuditGenerationService],
  exports: [AuditGenerationService],
})
export class AuditGenerationModule {}
