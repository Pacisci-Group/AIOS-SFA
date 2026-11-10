import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ObjectIdType } from '../../common/mongo/object-id';
import {
  LEGACY_DEDUPE_INDEX_OPTIONS,
  TenantRecord,
} from '../../common/schemas/tenant-record.schema';

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

  @Prop({ type: ObjectIdType, ref: 'User', index: true })
  producerId?: Types.ObjectId;

  @Prop()
  legacyProducerId?: string;

  /**
   * The time off policy the request draws on (PAC-174 declares it, PAC-165
   * writes it). Migrated rows have none — their `type` is a legacy label,
   * not a policy. Read today only by the policy archive guard, which refuses
   * to archive a policy with a `Submitted` request against it.
   */
  @Prop({ type: ObjectIdType, ref: 'TimeOffPolicy', default: null })
  policyId?: Types.ObjectId | null;
}

export const TimeOffRequestSchema =
  SchemaFactory.createForClass(TimeOffRequest);
TimeOffRequestSchema.index(
  { agencyId: 1, legacySmartSuiteId: 1 },
  LEGACY_DEDUPE_INDEX_OPTIONS,
);
