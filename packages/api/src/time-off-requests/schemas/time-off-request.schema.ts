import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { TenantRecord } from '../../common/schemas/tenant-record.schema';

export type TimeOffRequestDocument = HydratedDocument<TimeOffRequest>;

/**
 * Migrated from SmartSuite "The Time Off Request Table" (696dd246b1bf4b889f2fb4fa).
 */
@Schema({ timestamps: true, collection: 'timeOffRequests' })
export class TimeOffRequest extends TenantRecord {
  @Prop({ trim: true })
  title?: string;

  @Prop({ type: Date })
  startDate?: Date;

  @Prop({ type: Date })
  endDate?: Date;

  @Prop()
  requestType?: string;

  @Prop({ default: 0 })
  hoursRequested: number;

  @Prop({ index: true })
  status?: string;

  @Prop()
  type?: string;

  @Prop()
  decision?: string;

  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  producerId?: Types.ObjectId;

  @Prop()
  legacyProducerId?: string;
}

export const TimeOffRequestSchema =
  SchemaFactory.createForClass(TimeOffRequest);
TimeOffRequestSchema.index(
  { agencyId: 1, legacySmartSuiteId: 1 },
  { unique: true, sparse: true },
);
