import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { TenantRecord } from '../../common/schemas/tenant-record.schema';

export type ProducerAssignmentDocument = HydratedDocument<ProducerAssignment>;

/**
 * Migrated from SmartSuite "The Producer Assignment Table" (695ec3890ac528daf6607fa2).
 * Round-robin CRM assignment pointer per producer.
 */
@Schema({ timestamps: true, collection: 'producerAssignments' })
export class ProducerAssignment extends TenantRecord {
  @Prop({ trim: true })
  title?: string;

  @Prop({ default: 0 })
  indexPointer: number;

  @Prop({ default: false })
  activeForProducer: boolean;

  @Prop({ type: Date })
  lastAssignedAt?: Date;

  @Prop({ default: false })
  lock: boolean;

  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  producerId?: Types.ObjectId;

  @Prop()
  legacyProducerId?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  lastAssignedCrmId?: Types.ObjectId;

  @Prop()
  legacyLastAssignedCrmId?: string;
}

export const ProducerAssignmentSchema =
  SchemaFactory.createForClass(ProducerAssignment);
ProducerAssignmentSchema.index(
  { agencyId: 1, legacySmartSuiteId: 1 },
  { unique: true, sparse: true },
);
