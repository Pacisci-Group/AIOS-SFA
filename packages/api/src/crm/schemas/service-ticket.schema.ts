import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  SERVICE_TICKET_ACTIVITY_TYPES,
  SERVICE_TICKET_CATEGORIES,
  SERVICE_TICKET_PRIORITIES,
  SERVICE_TICKET_STATUSES,
} from '@sfa/shared';
import type {
  ServiceTicketActivityType,
  ServiceTicketCategory,
  ServiceTicketPriority,
  ServiceTicketStatus,
} from '@sfa/shared';
import { HydratedDocument, Types } from 'mongoose';

export type ServiceTicketDocument = HydratedDocument<ServiceTicket>;

/** A single entry in a ticket's activity timeline. */
@Schema({ _id: true, timestamps: false })
export class ServiceTicketActivityEntry {
  @Prop({ type: String, enum: SERVICE_TICKET_ACTIVITY_TYPES, required: true })
  type: ServiceTicketActivityType;

  @Prop({ trim: true })
  author?: string;

  @Prop({ required: true, trim: true })
  content: string;

  @Prop({ type: Date, required: true, default: () => new Date() })
  at: Date;
}

export const ServiceTicketActivitySchema = SchemaFactory.createForClass(
  ServiceTicketActivityEntry,
);

@Schema({ timestamps: true, collection: 'service_tickets' })
export class ServiceTicket {
  @Prop({ type: Types.ObjectId, ref: 'Agency', required: true, index: true })
  agencyId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Branch', index: true, default: null })
  branchId?: Types.ObjectId | null;

  /** Human-facing ticket reference, unique within an agency (e.g. RENEW-280). */
  @Prop({ required: true, trim: true })
  ticketNumber: string;

  @Prop({ required: true, trim: true })
  clientName: string;

  @Prop({ type: String, enum: SERVICE_TICKET_CATEGORIES, required: true })
  category: ServiceTicketCategory;

  @Prop({
    type: String,
    enum: SERVICE_TICKET_STATUSES,
    required: true,
    default: 'open',
  })
  status: ServiceTicketStatus;

  @Prop({
    type: String,
    enum: SERVICE_TICKET_PRIORITIES,
    required: true,
    default: 'medium',
  })
  priority: ServiceTicketPriority;

  /** Denormalized display name of the assigned rep. */
  @Prop({ trim: true, default: '' })
  assignedRep: string;

  /** The user this ticket belongs to (drives `own` data-scope filtering). */
  @Prop({ type: Types.ObjectId, ref: 'User', index: true, default: null })
  assignedUserId?: Types.ObjectId | null;

  @Prop({ trim: true, default: '' })
  policyNumber: string;

  @Prop({ trim: true, default: '' })
  policyType: string;

  @Prop({ trim: true, default: '' })
  household: string;

  @Prop({ trim: true, default: '' })
  phone: string;

  @Prop({ trim: true, default: '' })
  email: string;

  @Prop({ type: Date, required: true, default: () => new Date() })
  openedAt: Date;

  @Prop({ type: Date, required: true, default: () => new Date() })
  lastActivityAt: Date;

  @Prop({ type: [ServiceTicketActivitySchema], default: [] })
  timeline: ServiceTicketActivityEntry[];

  @Prop()
  legacySmartSuiteId?: string;
}

export const ServiceTicketSchema = SchemaFactory.createForClass(ServiceTicket);
ServiceTicketSchema.index(
  { agencyId: 1, ticketNumber: 1 },
  { unique: true },
);
ServiceTicketSchema.index({ agencyId: 1, branchId: 1, status: 1 });
ServiceTicketSchema.index({ assignedUserId: 1, status: 1 });
