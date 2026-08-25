import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  LEGACY_DEDUPE_INDEX_OPTIONS,
  TenantRecord,
} from '../../common/schemas/tenant-record.schema';

export type CrmRotationDocument = HydratedDocument<CrmRotation>;

/**
 * Migrated from SmartSuite "The CRM Rotation Table" (695ec474897e7b72911f64d7).
 * Ordered CRM rotation entries used for round-robin service assignment.
 */
@Schema({ timestamps: true, collection: 'crmRotations' })
export class CrmRotation extends TenantRecord {
  @Prop({ trim: true })
  title?: string;

  @Prop({ default: 0 })
  order: number;

  @Prop({ default: false })
  activeForProducer: boolean;

  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  crmId?: Types.ObjectId;

  @Prop()
  legacyCrmId?: string;

  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  producerId?: Types.ObjectId;

  @Prop()
  legacyProducerId?: string;
}

export const CrmRotationSchema = SchemaFactory.createForClass(CrmRotation);
CrmRotationSchema.index(
  { agencyId: 1, legacySmartSuiteId: 1 },
  LEGACY_DEDUPE_INDEX_OPTIONS,
);
