import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  AuditTemplate,
  AuditTemplateSchema,
} from './schemas/audit-template.schema';

/**
 * The audit-template catalog (PAC-40).
 *
 * Schema-only until now — the collection existed but nothing in the running
 * app ever read it, so its indexes were never built and audit generation had
 * nothing to resolve against. No controller: the catalog is seeded and
 * migrated, not edited over HTTP. Exported so `AuditGenerationModule` and the
 * core seed can inject the model.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AuditTemplate.name, schema: AuditTemplateSchema },
    ]),
  ],
  exports: [MongooseModule],
})
export class AuditTemplatesModule {}
