import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  EMPLOYEE_PROFILE_EVENT_KINDS,
  type ActivityChange,
  type EmployeeProfileEventKind,
} from '@sfa/shared';
import { HydratedDocument, Types } from 'mongoose';
import { ObjectIdType } from '../../common/mongo/object-id';

export type EmployeeProfileEventDocument =
  HydratedDocument<EmployeeProfileEvent>;

/**
 * The before/after audit log of an employee profile (PAC-162): one row per
 * admin action, with the fields it changed as display-ready
 * `ActivityChange`s (the `activities/change-log.ts` discipline — a row is
 * written once and read forever, so it stores labels and names, not ids).
 *
 * Its own collection rather than an array on the profile: the profile is
 * read on every `effectiveRules` call and must stay small, while this is
 * read on one page. `assignments[]` stays embedded because it is what that
 * hot read needs.
 */
@Schema({ timestamps: true, collection: 'employeeProfileEvents' })
export class EmployeeProfileEvent {
  @Prop({ required: true, index: true })
  agencyId: string;

  @Prop({ type: ObjectIdType, ref: 'EmployeeProfile', required: true })
  profileId: Types.ObjectId;

  @Prop({ type: ObjectIdType, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: Date, required: true })
  at: Date;

  /** Null for a system write (the migration, a removal hook with no request). */
  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  actorId: Types.ObjectId | null;

  @Prop({ type: String, required: true, enum: EMPLOYEE_PROFILE_EVENT_KINDS })
  kind: EmployeeProfileEventKind;

  @Prop({ type: [Object], default: [] })
  changes: ActivityChange[];

  @Prop({ type: String, default: null })
  reason: string | null;

  createdAt?: Date;
  updatedAt?: Date;

  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  createdBy?: Types.ObjectId | null;

  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  updatedBy?: Types.ObjectId | null;
}

export const EmployeeProfileEventSchema =
  SchemaFactory.createForClass(EmployeeProfileEvent);

EmployeeProfileEventSchema.index({ profileId: 1, at: -1 });
