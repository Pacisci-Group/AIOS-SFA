import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { TenantRecord } from '../../common/schemas/tenant-record.schema';

export type ServiceTicketDocument = HydratedDocument<ServiceTicket>;

/**
 * Migrated from SmartSuite "The Service Tickets Table" (6941fdb3dc9a6d024fd8d23d).
 */
@Schema({ timestamps: true, collection: 'serviceTickets' })
export class ServiceTicket extends TenantRecord {
  @Prop({ trim: true })
  title?: string;

  @Prop({ type: Date })
  createdDate?: Date;

  @Prop()
  category?: string;

  @Prop()
  priority?: string;

  @Prop({ type: Date })
  dueDate?: Date;

  @Prop({ index: true })
  status?: string;

  @Prop({ type: Date })
  dateResolved?: Date;

  @Prop({ default: 0 })
  daysOpen: number;

  @Prop({ trim: true })
  clientName?: string;

  @Prop({ trim: true })
  crmName?: string;

  @Prop({ type: Types.ObjectId, ref: 'Policy', index: true })
  policyId?: Types.ObjectId;

  @Prop()
  legacyPolicyId?: string;

  @Prop({ type: Types.ObjectId, ref: 'Household', index: true })
  householdId?: Types.ObjectId;

  @Prop()
  legacyHouseholdId?: string;

  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  assignedCrmId?: Types.ObjectId;

  @Prop()
  legacyAssignedCrmId?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdById?: Types.ObjectId;

  @Prop()
  legacyCreatedById?: string;

  @Prop({ default: false, index: true })
  isTestRecord: boolean;
}

export const ServiceTicketSchema = SchemaFactory.createForClass(ServiceTicket);
ServiceTicketSchema.index(
  { agencyId: 1, legacySmartSuiteId: 1 },
  { unique: true, sparse: true },
);
ServiceTicketSchema.index({ agencyId: 1, householdId: 1, status: 1 });
