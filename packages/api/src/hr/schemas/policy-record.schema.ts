import { Prop, Schema } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { ObjectIdType } from '../../common/mongo/object-id';

/**
 * What every policy collection holds (PAC-161 v3): a name and the soft
 * archive. Each policy type is its own collection — `holidayPolicies`,
 * `workWeekPolicies`, `timeOffPolicies` (PAC-174) — and extends this with
 * its own rules, so a document can only ever carry the rules of its type.
 *
 * Who is enrolled is **not** here but one level down: all three embed a
 * member list ({@link MemberListPolicyRecord}). A time off policy's
 * per-person facts — the starting balance, when someone joined or left —
 * are `leaveLedger` rows, not enrolment fields, because the balance is
 * derived from the ledger and nothing else (PAC-174).
 *
 * Not a `TenantRecord`: a policy belongs to the agency, not to a branch.
 *
 * ## Archive, never delete
 *
 * Archiving sets `archivedAt` / `archivedBy` and leaves the row (PAC-155).
 * Every reader spells out `archivedAt: null`.
 */
@Schema({ timestamps: true })
export class PolicyRecord {
  /** A string, the `TenantRecord` convention — unlike `User.agencyId`. */
  @Prop({ required: true })
  agencyId: string;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ type: Date, default: null })
  archivedAt: Date | null;

  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  archivedBy: Types.ObjectId | null;

  createdAt?: Date;
  updatedAt?: Date;

  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  createdBy?: Types.ObjectId | null;

  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  updatedBy?: Types.ObjectId | null;
}

/**
 * A policy whose people are an embedded list: Holiday, Work week, Time off.
 *
 * `memberIds` is the list of enrolled users. An agency is tens of people, the
 * list is read whole every time it is shown, and "which policy is this person
 * in" is a multikey lookup on the same field (each collection indexes
 * `{ agencyId, memberIds }`). A person is in at most one active policy per
 * collection — per `timeOffType` for time off, Custom excepted; the service
 * enforces it by moving them.
 */
@Schema({ timestamps: true })
export class MemberListPolicyRecord extends PolicyRecord {
  @Prop({ type: [ObjectIdType], ref: 'User', default: [] })
  memberIds: Types.ObjectId[];
}
