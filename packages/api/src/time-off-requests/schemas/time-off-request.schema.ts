import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  TIME_OFF_DAY_MODES,
  TIME_OFF_NOTE_MAX_LENGTH,
  TIME_OFF_REQUEST_SOURCES,
  TIME_OFF_REQUEST_STATUSES,
  TIME_OFF_TIMELINE_ACTIONS,
  type ScheduledDayReason,
  type TimeOffCheckCode,
  type TimeOffDayMode,
  type TimeOffRequestSource,
  type TimeOffRequestStatus,
  type TimeOffTimelineAction,
} from '@sfa/shared';
import { HydratedDocument, Types } from 'mongoose';
import { ObjectIdType } from '../../common/mongo/object-id';
import {
  LEGACY_DEDUPE_INDEX_OPTIONS,
  TenantRecord,
} from '../../common/schemas/tenant-record.schema';

export type TimeOffRequestDocument = HydratedDocument<TimeOffRequest>;

/**
 * One date of the request. There is a row for **every** date from the first
 * day to the last, so a weekend or a holiday inside the range is on record —
 * at zero hours, with the reason it is not a working day.
 */
@Schema({ _id: false })
export class TimeOffRequestDayRow {
  /** `YYYY-MM-DD`. */
  @Prop({ type: String, required: true })
  date: string;

  /** Hours of leave on the date; never above `scheduledHours`. */
  @Prop({ type: Number, required: true })
  hours: number;

  /** What the person's work week and holiday policy scheduled, when frozen. */
  @Prop({ type: Number, required: true })
  scheduledHours: number;

  @Prop({ type: String, required: true })
  reason: ScheduledDayReason;
}
export const TimeOffRequestDayRowSchema =
  SchemaFactory.createForClass(TimeOffRequestDayRow);

/** One thing that happened to the request. Appended, never edited. */
@Schema({ _id: false })
export class TimeOffTimelineEntry {
  @Prop({ type: Date, required: true })
  at: Date;

  /** Null = the system: an automatic approval, the import. */
  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  actorId: Types.ObjectId | null;

  @Prop({ type: String, required: true, enum: TIME_OFF_TIMELINE_ACTIONS })
  action: TimeOffTimelineAction;

  @Prop({ type: String, default: null })
  fromStatus: TimeOffRequestStatus | null;

  @Prop({ type: String, default: null })
  toStatus: TimeOffRequestStatus | null;

  /** The note written with the action — the only place a note is written. */
  @Prop({ type: String, default: null })
  note: string | null;

  /** The limits a recorded entry went over and was saved with anyway. */
  @Prop({ type: [String], default: [] })
  warnings: TimeOffCheckCode[];
}
export const TimeOffTimelineEntrySchema =
  SchemaFactory.createForClass(TimeOffTimelineEntry);

/** The SmartSuite labels of an imported row. Display only; nothing reads them to decide anything. */
@Schema({ _id: false })
export class TimeOffLegacyLabels {
  /** `Submitted` · `Approved` · `Denied` · `Cancelled` — not the lifecycle status. */
  @Prop({ type: String, default: null })
  status: string | null;

  /** `Unpaid` · `PTO` · `Sick` — a label, not a policy. */
  @Prop({ type: String, default: null })
  type: string | null;

  @Prop({ type: String, default: null })
  requestType: string | null;

  @Prop({ type: String, default: null })
  decision: string | null;

  @Prop({ type: String, default: null })
  title: string | null;
}
export const TimeOffLegacyLabelsSchema =
  SchemaFactory.createForClass(TimeOffLegacyLabels);

/**
 * A time off request (PAC-165): a person's leave against a time off policy
 * they are enrolled in, from a draft to a decision.
 *
 * ## Two kinds of row
 *
 * - **A request made in the app** (`source: 'self'`) or **recorded for
 *   someone** (`source: 'recorded'`, created already Approved). It has a
 *   `policyId`, a lifecycle `status`, the per-date `days[]` and a `TOR-`
 *   reference.
 * - **An imported row** (`source: 'legacy'`), from SmartSuite's Time Off
 *   Request table. Decided 2026-11-05: read-only history. It has no policy,
 *   no per-date hours and — deliberately — **no `status`**: its SmartSuite
 *   labels sit under `legacy.*`. Every lifecycle query filters on `status`,
 *   so none can match an imported row by accident; that absence is the
 *   guard, not a filter somebody has to remember.
 *
 * ## Dates
 *
 * `firstDay` / `lastDay` and `days[].date` are **calendar days**
 * (`YYYY-MM-DD`), the hire-date and holiday-row convention: a day off names
 * a day, it did not happen at an instant. The ledger rows an approval posts
 * turn each into the agency-local start of that day.
 *
 * ## Hours
 *
 * `days[]` is frozen when the request is sent: the hours come from the
 * person's work week and holiday policy *at that moment*, so a holiday added
 * next month does not change an approved request. A Draft holds a
 * provisional copy that sending recomputes. `totalHours` is the sum, written
 * in the same update, for the lists.
 *
 * ## Never deleted
 *
 * A discarded draft is stamped `deletedAt` and leaves every read (decided
 * 2026-11-05; PAC-155 will set the app-wide convention). Everything else
 * ends in `declined` or `cancelled` and stays.
 *
 * `branchId` (from `TenantRecord`) is the employee's home branch when the
 * request was made — what a branch-scoped reviewer's data scope is tested
 * against.
 */
@Schema({ timestamps: true, collection: 'timeOffRequests' })
export class TimeOffRequest extends TenantRecord {
  /** `TOR-2026-007`. Null on an imported row. */
  @Prop({ type: String, default: null })
  reference: string | null;

  @Prop({ type: String, required: true, enum: TIME_OFF_REQUEST_SOURCES })
  source: TimeOffRequestSource;

  /**
   * Whose time off it is. Null only on an imported row whose SmartSuite
   * producer could not be matched to a user.
   */
  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  employeeId: Types.ObjectId | null;

  /** Who created it: the employee, or the person who recorded it for them. */
  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  initiatorId: Types.ObjectId | null;

  /** The policy the hours come out of. Null on an imported row. */
  @Prop({ type: ObjectIdType, ref: 'TimeOffPolicy', default: null })
  policyId: Types.ObjectId | null;

  /** The lifecycle status. Absent on an imported row — see the class docblock. */
  @Prop({
    type: String,
    enum: [...TIME_OFF_REQUEST_STATUSES, null],
    default: null,
  })
  status: TimeOffRequestStatus | null;

  /** `YYYY-MM-DD`. */
  @Prop({ type: String, default: null })
  firstDay: string | null;

  /** `YYYY-MM-DD`. */
  @Prop({ type: String, default: null })
  lastDay: string | null;

  @Prop({ type: String, enum: [...TIME_OFF_DAY_MODES, null], default: null })
  dayMode: TimeOffDayMode | null;

  @Prop({ type: [TimeOffRequestDayRowSchema], default: [] })
  days: TimeOffRequestDayRow[];

  @Prop({ type: Number, default: 0 })
  totalHours: number;

  /**
   * The note as it stands: the employee's to the reviewer, or the recorder's
   * to the employee. Each send copies it onto the timeline.
   */
  @Prop({
    type: String,
    trim: true,
    maxlength: TIME_OFF_NOTE_MAX_LENGTH,
    default: null,
  })
  note: string | null;

  /** The last time it was sent for review; null while it never was. */
  @Prop({ type: Date, default: null })
  submittedAt: Date | null;

  @Prop({ type: Date, default: null })
  decidedAt: Date | null;

  /** Null on an automatic approval. */
  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  decidedBy: Types.ObjectId | null;

  /** Approved by the policy's rules the moment it was sent. */
  @Prop({ type: Boolean, default: false })
  autoApproved: boolean;

  @Prop({ type: [TimeOffTimelineEntrySchema], default: [] })
  timeline: TimeOffTimelineEntry[];

  @Prop({ type: TimeOffLegacyLabelsSchema, default: null })
  legacy: TimeOffLegacyLabels | null;

  /** The SmartSuite producer record the import could (or could not) resolve. */
  @Prop()
  legacyProducerId?: string;

  /** Set when a draft is discarded. Every read filters `deletedAt: null`. */
  @Prop({ type: Date, default: null })
  deletedAt: Date | null;

  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  deletedBy: Types.ObjectId | null;
}

export const TimeOffRequestSchema =
  SchemaFactory.createForClass(TimeOffRequest);

TimeOffRequestSchema.index(
  { agencyId: 1, legacySmartSuiteId: 1 },
  LEGACY_DEDUPE_INDEX_OPTIONS,
);

/** A person's own list, their overlapping dates, their other requested hours. */
TimeOffRequestSchema.index({
  agencyId: 1,
  employeeId: 1,
  status: 1,
  firstDay: 1,
});

/** The team list and "who else is off", inside a branch. */
TimeOffRequestSchema.index({
  agencyId: 1,
  branchId: 1,
  status: 1,
  firstDay: 1,
});

/** The policy archive guard: requests still waiting on a person. */
TimeOffRequestSchema.index({ agencyId: 1, policyId: 1, status: 1 });

/**
 * One reference per agency. Partial on the type, not `sparse`: imported rows
 * and nothing else carry `null`, and a compound sparse index would index
 * them all as `(agencyId, null)`.
 */
TimeOffRequestSchema.index(
  { agencyId: 1, reference: 1 },
  {
    unique: true,
    partialFilterExpression: { reference: { $type: 'string' } },
  },
);
