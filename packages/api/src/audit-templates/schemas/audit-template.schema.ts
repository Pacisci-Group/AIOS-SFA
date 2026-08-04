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

/**
 * Audit generation resolves computed titles against this collection by name,
 * and the core seed upserts on `{ agencyId, name }` (PAC-40).
 *
 * **Non-unique deliberately.** SmartSuite does not constrain the title field,
 * so a migrated workspace may already hold two templates with the same name; a
 * unique index would fail to build at boot and take the API down with it. The
 * generator dedupes by normalized title in memory instead.
 */
AuditTemplateSchema.index({ agencyId: 1, name: 1 });

/** The generator only ever loads active templates. */
AuditTemplateSchema.index({ agencyId: 1, active: 1 });
