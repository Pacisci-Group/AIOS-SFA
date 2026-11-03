import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  DEFAULT_WORKWEEK,
  HOLIDAY_SUGGESTION_TYPES,
  type HolidayProposalStatus,
  type HolidaySuggestionType,
  type Weekday,
} from '@sfa/shared';
import { HydratedDocument, Types } from 'mongoose';
import { ObjectIdType } from '../../common/mongo/object-id';

export type AgencyCalendarDocument = HydratedDocument<AgencyCalendar>;

/** One suggested holiday inside a {@link HolidayProposal}. */
@Schema({ _id: false })
export class HolidayProposalItem {
  /** `YYYY-MM-DD`. */
  @Prop({ required: true, trim: true })
  date: string;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ type: String, required: true, enum: HOLIDAY_SUGGESTION_TYPES })
  type: HolidaySuggestionType;

  @Prop({ default: false })
  substitute: boolean;
}
export const HolidayProposalItemSchema =
  SchemaFactory.createForClass(HolidayProposalItem);

/**
 * Next year's holidays as the Q4 job proposed them (PAC-161).
 *
 * Embedded rather than its own collection: there is at most one per agency
 * per year, it is read only from the settings page and the notification's
 * deep link, and the job's "one proposal per agency per year" guarantee is a
 * single conditional `$push` on `proposals.year`.
 */
@Schema({ _id: false })
export class HolidayProposal {
  @Prop({ required: true })
  year: number;

  @Prop({
    type: String,
    required: true,
    enum: ['pending', 'confirmed', 'dismissed'],
    default: 'pending',
  })
  status: HolidayProposalStatus;

  @Prop({ type: Date, required: true })
  proposedAt: Date;

  @Prop({ type: [HolidayProposalItemSchema], default: [] })
  items: HolidayProposalItem[];

  @Prop({ type: Date, default: null })
  decidedAt: Date | null;

  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  decidedBy: Types.ObjectId | null;
}
export const HolidayProposalSchema =
  SchemaFactory.createForClass(HolidayProposal);

/**
 * The agency calendar's settings: one document per agency (PAC-161).
 *
 * The *days* — holidays, closures, special working days — are rows in
 * `agencyCalendarDays`; this holds what is true of the whole calendar: which
 * weekdays the office is open, where the agency is (so `date-holidays` can
 * suggest), and the Q4 proposals.
 *
 * ## Agency-level, not a `TenantRecord`
 *
 * `agencyId` is a **string**, the same convention as `TenantRecord`, so a
 * raw-driver query written like every other tenant query matches. There is no
 * `branchId` — the epic settles "nothing per-branch in v1", and a calendar
 * with a branch would be a lie the scope filter could act on. `createdBy` /
 * `updatedBy` are declared so `authorshipPlugin` stamps them.
 */
@Schema({ timestamps: true, collection: 'agencyCalendars' })
export class AgencyCalendar {
  @Prop({ required: true, unique: true })
  agencyId: string;

  /** Weekdays the office is open, Sunday = 0. */
  @Prop({ type: [Number], default: () => [...DEFAULT_WORKWEEK] })
  workweek: Weekday[];

  /** ISO 3166-1 alpha-2 as `date-holidays` keys it; null until set. */
  @Prop({ type: String, trim: true, uppercase: true, default: null })
  country: string | null;

  /** A `date-holidays` state/province code, e.g. `OK`; null for none. */
  @Prop({ type: String, trim: true, uppercase: true, default: null })
  region: string | null;

  @Prop({ type: [HolidayProposalSchema], default: [] })
  proposals: HolidayProposal[];

  createdAt?: Date;
  updatedAt?: Date;

  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  createdBy?: Types.ObjectId | null;

  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  updatedBy?: Types.ObjectId | null;
}

export const AgencyCalendarSchema =
  SchemaFactory.createForClass(AgencyCalendar);
