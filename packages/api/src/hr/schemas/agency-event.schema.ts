import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  AGENCY_EVENT_AUDIENCE_KINDS,
  AGENCY_EVENT_EFFECTS,
  type AgencyEventAudienceKind,
  type AgencyEventEffect,
} from '@sfa/shared';
import { HydratedDocument, Types } from 'mongoose';
import { ObjectIdType } from '../../common/mongo/object-id';

export type AgencyEventDocument = HydratedDocument<AgencyEvent>;

/**
 * Who an event is for. `branchIds` are **strings**, the `TenantRecord`
 * convention, because they are compared with `AccessContext.branchId` and a
 * time off request's stamped `branchId`; `userIds` are ObjectIds like every
 * other link to a user (`memberIds`, `employeeId`). The list a kind does not
 * use is stored empty, so a query on one never matches a leftover.
 */
@Schema({ _id: false })
export class AgencyEventAudienceRow {
  @Prop({ type: String, enum: AGENCY_EVENT_AUDIENCE_KINDS, default: 'agency' })
  kind: AgencyEventAudienceKind;

  @Prop({ type: [String], default: [] })
  branchIds: string[];

  @Prop({ type: [ObjectIdType], ref: 'User', default: [] })
  userIds: Types.ObjectId[];
}
export const AgencyEventAudienceRowSchema = SchemaFactory.createForClass(
  AgencyEventAudienceRow,
);

/**
 * An agency event (PAC-169): a date the agency puts on its own calendar — a
 * company meetup, a Christmas party, an office closure — and what it does to
 * time off. The rules are in `shared/domain/agency-event.ts`.
 *
 * The first thing to store a closure since the agency calendar was removed
 * (PAC-161 v3): holidays are per person, in Holiday policies; a `day_off`
 * event is the agency saying "we are shut" for everyone in its audience.
 *
 * Not a `TenantRecord`: an event belongs to the agency and its audience may
 * span branches, so there is no single `branchId` to stamp.
 *
 * ## Whole days
 *
 * `firstDay` / `lastDay` are `YYYY-MM-DD` on the agency's calendar, like
 * every HR date. `startTime` / `endTime` are shown and nothing else — the
 * effect is always the whole day.
 *
 * ## Soft delete
 *
 * Removing an event sets `deletedAt` / `deletedBy` and leaves the row
 * (PAC-155). Every reader spells out `deletedAt: null`. A removed event stops
 * blocking and closing from that moment; requests sent while it stood keep
 * the hours they froze.
 */
@Schema({ timestamps: true, collection: 'agencyEvents' })
export class AgencyEvent {
  /** A string, the `TenantRecord` convention — unlike `User.agencyId`. */
  @Prop({ required: true })
  agencyId: string;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ type: String, default: null })
  description: string | null;

  /** `YYYY-MM-DD`, inclusive. */
  @Prop({ required: true })
  firstDay: string;

  /** `YYYY-MM-DD`, inclusive; equal to `firstDay` for one day. */
  @Prop({ required: true })
  lastDay: string;

  /** `HH:mm`, shown only. */
  @Prop({ type: String, default: null })
  startTime: string | null;

  @Prop({ type: String, default: null })
  endTime: string | null;

  @Prop({ type: String, enum: AGENCY_EVENT_EFFECTS, default: 'none' })
  effect: AgencyEventEffect;

  @Prop({
    type: AgencyEventAudienceRowSchema,
    default: () => ({ kind: 'agency', branchIds: [], userIds: [] }),
  })
  audience: AgencyEventAudienceRow;

  @Prop({ type: Date, default: null })
  deletedAt: Date | null;

  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  deletedBy: Types.ObjectId | null;

  createdAt?: Date;
  updatedAt?: Date;

  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  createdBy?: Types.ObjectId | null;

  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  updatedBy?: Types.ObjectId | null;
}

export const AgencyEventSchema = SchemaFactory.createForClass(AgencyEvent);

/**
 * The range read: live events whose first day is in a window. An event runs
 * at most `AGENCY_EVENT_MAX_DAYS`, so "overlaps `[from, to]`" is bounded on
 * `firstDay` alone — `from − max … to` — and the index answers it.
 */
AgencyEventSchema.index({ agencyId: 1, deletedAt: 1, firstDay: 1 });
