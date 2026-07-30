import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import {
  LEGACY_DEDUPE_INDEX_OPTIONS,
  TenantRecord,
} from '../../common/schemas/tenant-record.schema';

export type AuditTemplateDocument = HydratedDocument<AuditTemplate>;

/**
 * Migrated from SmartSuite "The Audit Templates Table" (69532d09f018acf38e53443a).
 * The catalog of audit item definitions that drive generated Deal Audit Items.
 */
@Schema({ timestamps: true, collection: 'auditTemplates' })
export class AuditTemplate extends TenantRecord {
  @Prop({ trim: true })
  name?: string;

  @Prop()
  category?: string;

  @Prop({ default: false })
  required: boolean;

  @Prop({ default: false })
  blocking: boolean;

  @Prop({ default: true })
  active: boolean;

  @Prop({ default: false })
  alwaysInclude: boolean;

  @Prop()
  task?: string;
}

export const AuditTemplateSchema = SchemaFactory.createForClass(AuditTemplate);
AuditTemplateSchema.index(
  { agencyId: 1, legacySmartSuiteId: 1 },
  LEGACY_DEDUPE_INDEX_OPTIONS,
);
