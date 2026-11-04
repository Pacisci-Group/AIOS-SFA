import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  HOLIDAY_KEYS,
  TIME_OFF_POLICY_TYPES,
  type HolidayKey,
  type TimeOffPolicyType,
  type Weekday,
} from '@sfa/shared';
import { HydratedDocument, Types } from 'mongoose';
import { ObjectIdType } from '../../common/mongo/object-id';

export type TimeOffPolicyDocument = HydratedDocument<TimeOffPolicy>;

@Schema({ _id: false })
export class CustomHolidayRow {
  @Prop({ required: true, trim: true })
  id: string;

  @Prop({ required: true, trim: true })
  name: string;

  /** `YYYY-MM-DD`, inclusive. */
  @Prop({ required: true })
  start: string;

  @Prop({ required: true })
  end: string;

  @Prop({ default: false })
  repeatsYearly: boolean;
}
export const CustomHolidayRowSchema =
  SchemaFactory.createForClass(CustomHolidayRow);

/** A Holiday policy's rules — see `shared/domain/us-holidays.ts`. */
@Schema({ _id: false })
export class HolidayRules {
  @Prop({ type: [String], enum: HOLIDAY_KEYS, default: [] })
  holidays: HolidayKey[];

  @Prop({ type: [CustomHolidayRowSchema], default: [] })
  customHolidays: CustomHolidayRow[];
}
export const HolidayRulesSchema = SchemaFactory.createForClass(HolidayRules);

@Schema({ _id: false })
export class WorkWeekDayRow {
  @Prop({ type: Number, required: true, min: 0, max: 6 })
  weekday: Weekday;

  /** `'HH:mm'` on the agency's clock. */
  @Prop({ required: true })
  start: string;

  @Prop({ required: true })
  end: string;
}
export const WorkWeekDayRowSchema =
  SchemaFactory.createForClass(WorkWeekDayRow);

@Schema({ _id: false })
export class WorkWeekRules {
  @Prop({ type: [WorkWeekDayRowSchema], default: [] })
  days: WorkWeekDayRow[];
}
export const WorkWeekRulesSchema = SchemaFactory.createForClass(WorkWeekRules);

/**
 * One time off policy (PAC-161 v3): a type, a name, the rules for that type
 * and the people enrolled. See `shared/domain/time-off-policy.ts` for the
 * model; this is only its storage.
 *
 * ## One collection for every type
 *
 * The Time off page lists, counts and filters all of them together, and the
 * enrolment rule ("at most one per type per person") is one query over
 * `{ agencyId, type, memberIds }`. Only the sub-document for the policy's own
 * type is set; the other is absent.
 *
 * ## Enrolment is embedded
 *
 * `memberIds` is the list of enrolled users. An agency is tens of people, the
 * list is read whole every time it is shown, and "which Holiday policy is
 * this person in" is a multikey lookup on the same field. Not a
 * `TenantRecord`: a policy belongs to the agency, not to a branch.
 *
 * ## Archive, never delete
 *
 * Archiving sets `archivedAt` / `archivedBy` and leaves the row (PAC-155).
 * Every reader spells out `archivedAt: null`.
 */
@Schema({ timestamps: true, collection: 'timeOffPolicies' })
export class TimeOffPolicy {
  /** A string, the `TenantRecord` convention — unlike `User.agencyId`. */
  @Prop({ required: true })
  agencyId: string;

  @Prop({ type: String, required: true, enum: TIME_OFF_POLICY_TYPES })
  type: TimeOffPolicyType;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ type: HolidayRulesSchema })
  holiday?: HolidayRules;

  @Prop({ type: WorkWeekRulesSchema })
  workWeek?: WorkWeekRules;

  @Prop({ type: [ObjectIdType], ref: 'User', default: [] })
  memberIds: Types.ObjectId[];

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

export const TimeOffPolicySchema = SchemaFactory.createForClass(TimeOffPolicy);

/** The page's list and counts. */
TimeOffPolicySchema.index({ agencyId: 1, archivedAt: 1, type: 1 });

/** "Which policy of this type is this person in" — enrolment moves and working days. */
TimeOffPolicySchema.index({ agencyId: 1, type: 1, memberIds: 1 });
