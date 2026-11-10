import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { Weekday } from '@sfa/shared';
import { HydratedDocument } from 'mongoose';
import { MemberListPolicyRecord } from './policy-record.schema';

export type WorkWeekPolicyDocument = HydratedDocument<WorkWeekPolicy>;

/** One working day of the week. */
@Schema({ _id: false })
export class WorkWeekDayRow {
  /** Sunday = 0 … Saturday = 6. */
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

/**
 * A Work week policy (PAC-161 v3): the days and hours the people enrolled
 * work. One row per working weekday, sorted; a weekday not listed is a day
 * off. Someone in no Work week policy works Mon–Fri 9–5
 * (`DEFAULT_WORK_WEEK_DAYS`). Read through `WorkingDaysService.forPerson`,
 * which PAC-165 uses to turn a time off request into hours.
 */
@Schema({ timestamps: true, collection: 'workWeekPolicies' })
export class WorkWeekPolicy extends MemberListPolicyRecord {
  @Prop({ type: [WorkWeekDayRowSchema], default: [] })
  days: WorkWeekDayRow[];
}

export const WorkWeekPolicySchema =
  SchemaFactory.createForClass(WorkWeekPolicy);

/** The HR policies page's list and counts. */
WorkWeekPolicySchema.index({ agencyId: 1, archivedAt: 1 });

/** "Which Work week policy is this person in" — enrolment moves and working days. */
WorkWeekPolicySchema.index({ agencyId: 1, memberIds: 1 });
