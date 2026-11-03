import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  CALENDAR_DAY_KINDS,
  CALENDAR_DAY_SOURCES,
  type CalendarDayKind,
  type CalendarDaySource,
} from '@sfa/shared';
import { HydratedDocument, IndexOptions, Types } from 'mongoose';
import { ObjectIdType } from '../../common/mongo/object-id';

export type AgencyCalendarDayDocument = HydratedDocument<AgencyCalendarDay>;

/**
 * One date on an agency's calendar (PAC-161): a holiday, a closure, or a
 * special working day. See `shared/domain/hr-calendar.ts` for why the date is
 * a `YYYY-MM-DD` string and not an instant.
 *
 * ## Its own collection, not an array on `agencyCalendars`
 *
 * Rows are tiny but accrue forever — nothing here is deleted (PAC-155) — and
 * two things want them as rows: the partial unique index that says "one
 * active row per date", and the employee calendar page (PAC-169), which reads
 * a date range. An embedded array would need both enforced in code.
 *
 * ## Soft remove
 *
 * Removing a day sets `removedAt` / `removedBy` / `removeReason`; the row
 * stays, and the date is free for a new row. Every reader filters
 * `removedAt: null` — **spelled out**, because the unique index below is
 * partial on it and a query that does not name the field cannot use it.
 */
@Schema({ timestamps: true, collection: 'agencyCalendarDays' })
export class AgencyCalendarDay {
  @Prop({ required: true, index: true })
  agencyId: string;

  /** `YYYY-MM-DD`. A calendar fact; sorts and ranges as a string. */
  @Prop({ required: true, trim: true })
  date: string;

  @Prop({ type: String, required: true, enum: CALENDAR_DAY_KINDS })
  kind: CalendarDayKind;

  @Prop({ required: true, trim: true })
  label: string;

  @Prop({ type: String, required: true, enum: CALENDAR_DAY_SOURCES })
  source: CalendarDaySource;

  /** Required by the DTO on `manual` rows; null on imported ones. */
  @Prop({ type: String, trim: true, default: null })
  reason: string | null;

  @Prop({ type: Date, default: null })
  removedAt: Date | null;

  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  removedBy: Types.ObjectId | null;

  @Prop({ type: String, trim: true, default: null })
  removeReason: string | null;

  createdAt?: Date;
  updatedAt?: Date;

  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  createdBy?: Types.ObjectId | null;

  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  updatedBy?: Types.ObjectId | null;
}

export const AgencyCalendarDaySchema =
  SchemaFactory.createForClass(AgencyCalendarDay);

/**
 * One **active** row per date per agency. Partial on `removedAt: null` so a
 * removed row frees its date — and so a reader must say `removedAt: null` to
 * ride it (see `partial-index-queries-need-type`: without the predicate Mongo
 * cannot prove the filter and scans).
 */
export const CALENDAR_DAY_ACTIVE_UNIQUE_OPTIONS = {
  unique: true,
  partialFilterExpression: { removedAt: null },
} satisfies IndexOptions;

AgencyCalendarDaySchema.index(
  { agencyId: 1, date: 1 },
  CALENDAR_DAY_ACTIVE_UNIQUE_OPTIONS,
);

/** Range reads for a year grid or the employee calendar page. */
AgencyCalendarDaySchema.index({ agencyId: 1, removedAt: 1, date: 1 });
