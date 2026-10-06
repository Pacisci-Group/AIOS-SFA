import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ObjectIdType } from '../../common/mongo/object-id';

export type WorkTransferDocument = HydratedDocument<WorkTransfer>;

/** The `_id`s one transfer rewrote, per collection. */
@Schema({ _id: false })
export class WorkTransferTouched {
  @Prop({ type: [ObjectIdType], default: [] })
  serviceTickets: Types.ObjectId[];

  @Prop({ type: [ObjectIdType], default: [] })
  onboardings: Types.ObjectId[];

  @Prop({ type: [ObjectIdType], default: [] })
  renewalCycles: Types.ObjectId[];

  @Prop({ type: [ObjectIdType], default: [] })
  households: Types.ObjectId[];

  @Prop({ type: [ObjectIdType], default: [] })
  deals: Types.ObjectId[];

  @Prop({ type: [ObjectIdType], default: [] })
  leads: Types.ObjectId[];

  @Prop({ type: [ObjectIdType], default: [] })
  auditAssignees: Types.ObjectId[];

  @Prop({ type: [ObjectIdType], default: [] })
  auditReviewers: Types.ObjectId[];

  /** Open audits on their sales that had no assignee, now the successor's. */
  @Prop({ type: [ObjectIdType], default: [] })
  auditsClaimed: Types.ObjectId[];

  /** Unresolved audit items whose `producerId` moved. */
  @Prop({ type: [ObjectIdType], default: [] })
  auditItems: Types.ObjectId[];

  @Prop({ type: [ObjectIdType], default: [] })
  shareLinks: Types.ObjectId[];

  @Prop({ type: [ObjectIdType], default: [] })
  rotationsTakenOver: Types.ObjectId[];

  @Prop({ type: [ObjectIdType], default: [] })
  rotationsDeactivated: Types.ObjectId[];
}

const WorkTransferTouchedSchema =
  SchemaFactory.createForClass(WorkTransferTouched);

/**
 * One hand-over of a person's open work to a colleague (PAC-136).
 *
 * The audit trail the hand-written reassignment migrations used to keep in
 * `migrations_reassignment_audit`: who moved what to whom, and the exact
 * records touched. Nothing reads it back yet — it exists so "where did this
 * client's CSR go?" has an answer, and so an undo, if one is ever wanted, can
 * be exact rather than "everything the successor now holds".
 *
 * Not a `TenantRecord`: a transfer belongs to the agency, not to a branch, and
 * the people it names carry ObjectId `agencyId`s like `users` does.
 */
@Schema({ timestamps: true, collection: 'workTransfers' })
export class WorkTransfer {
  @Prop({ type: ObjectIdType, ref: 'Agency', required: true, index: true })
  agencyId: Types.ObjectId;

  @Prop({ type: ObjectIdType, ref: 'User', required: true, index: true })
  fromUserId: Types.ObjectId;

  @Prop({ type: ObjectIdType, ref: 'User', required: true, index: true })
  toUserId: Types.ObjectId;

  /** Who ran it. Null only when there is no request context. */
  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  actorUserId: Types.ObjectId | null;

  @Prop({ type: WorkTransferTouchedSchema, default: () => ({}) })
  touched: WorkTransferTouched;

  createdAt?: Date;
}

export const WorkTransferSchema = SchemaFactory.createForClass(WorkTransfer);
