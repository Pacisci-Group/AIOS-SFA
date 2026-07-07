import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type TenantDocument = HydratedDocument<TenantRecord>;

@Schema({ timestamps: true })
export class TenantRecord {
  @Prop({ required: true, index: true })
  agencyId: string;

  @Prop({ required: true, index: true })
  branchId: string;

  @Prop({ sparse: true, index: true })
  legacySmartSuiteId?: string;
}

export const TenantRecordSchema = SchemaFactory.createForClass(TenantRecord);
TenantRecordSchema.index({ agencyId: 1, branchId: 1, createdAt: -1 });
