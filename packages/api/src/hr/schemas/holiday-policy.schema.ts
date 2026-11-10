import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HOLIDAY_KEYS, type HolidayKey } from '@sfa/shared';
import { HydratedDocument } from 'mongoose';
import { MemberListPolicyRecord } from './policy-record.schema';

export type HolidayPolicyDocument = HydratedDocument<HolidayPolicy>;

/** A holiday the agency names itself — see `shared/domain/us-holidays.ts`. */
@Schema({ _id: false })
export class CustomHolidayRow {
  /** Stable within the policy, so the wizard can edit or remove the row. */
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

/**
 * A Holiday policy (PAC-161 v3): the days the office closes for the people
 * enrolled. Stores *which* holidays, never dates — every year's dates are
 * computed from the rule by `holidaysInYear`, so there is nothing to confirm
 * each year.
 */
@Schema({ timestamps: true, collection: 'holidayPolicies' })
export class HolidayPolicy extends MemberListPolicyRecord {
  /** Catalog holidays (`HOLIDAY_KEYS`), recurring every year, catalog order. */
  @Prop({ type: [String], enum: HOLIDAY_KEYS, default: [] })
  holidays: HolidayKey[];

  @Prop({ type: [CustomHolidayRowSchema], default: [] })
  customHolidays: CustomHolidayRow[];
}

export const HolidayPolicySchema = SchemaFactory.createForClass(HolidayPolicy);

/** The HR policies page's list and counts. */
HolidayPolicySchema.index({ agencyId: 1, archivedAt: 1 });

/** "Which Holiday policy is this person in" — enrolment moves and working days. */
HolidayPolicySchema.index({ agencyId: 1, memberIds: 1 });
