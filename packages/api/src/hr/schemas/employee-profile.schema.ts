import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  EMPLOYEE_PROFILE_STATUSES,
  type DeepPartial,
  type EmployeeProfileStatus,
  type LeaveAllocations,
  type LeavePolicyRules,
  type WorkSchedule,
} from '@sfa/shared';
import { HydratedDocument, Types } from 'mongoose';
import { ObjectIdType } from '../../common/mongo/object-id';

export type EmployeeProfileDocument = HydratedDocument<EmployeeProfile>;

/**
 * One entry of a profile's assignment history (PAC-162): the complete set of
 * rule-shaped facts in force from `effectiveFrom`. Appended, never edited;
 * the profile's top-level fields always equal the last entry.
 */
@Schema({ _id: false })
export class EmployeeAssignment {
  /** `YYYY-MM-DD`, an agency day; never in the future. */
  @Prop({ required: true, trim: true })
  effectiveFrom: string;

  @Prop({ type: ObjectIdType, ref: 'LeavePolicy', required: true })
  leavePolicyId: Types.ObjectId;

  /** Only the paths that differ from the policy; arrays whole. DTO-validated. */
  @Prop({ type: Object, default: {} })
  overrides: DeepPartial<LeavePolicyRules>;

  @Prop({ type: ObjectIdType, ref: 'WorkScheduleTemplate', default: null })
  scheduleTemplateId: Types.ObjectId | null;

  @Prop({ type: Object, default: null })
  scheduleOverride: WorkSchedule | null;

  @Prop({ type: Object, default: {} })
  allocations: LeaveAllocations;

  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  actorId: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  reason: string | null;

  /** When the entry was written — not when it took effect. */
  @Prop({ type: Date, required: true })
  recordedAt: Date;
}
export const EmployeeAssignmentSchema =
  SchemaFactory.createForClass(EmployeeAssignment);

/**
 * The per-person HR record (PAC-162) — one per user per agency.
 *
 * ## Agency-level, string `agencyId`, no `branchId`
 *
 * Same convention as `AgencyCalendar`: a string `agencyId` so a raw-driver
 * query written like every other tenant query matches, and no `branchId`
 * because the branch is a fact about the *user* (`User.branchId`) and is
 * resolved through `userId`, never copied — the PAC-91 lesson about
 * denormalised copies that nothing keeps in step.
 *
 * ## The current fields and `assignments[]` cannot drift
 *
 * `leavePolicyId`, `overrides`, `scheduleTemplateId`, `scheduleOverride` and
 * `allocations` are what the lists filter and the archive guards count. The
 * same five are the body of every `assignments[]` entry, and a change writes
 * both in one `updateOne` (`$set` + `$push`). "What applied on day X" reads
 * the history; "what applies now" reads the fields; the last entry always
 * equals the fields.
 *
 * ## `overrides` / `scheduleOverride` / `allocations` are Mixed
 *
 * For the reason `LeavePolicy.rules` is: the shared type and the zod DTO
 * already define the shape, and a third copy would drift. The DTO is the gate.
 *
 * ## Dates are calendar days
 *
 * A hire date, a termination date or a birthday names a day the way a
 * holiday row does (`YYYY-MM-DD`); it does not move with the agency's zone.
 * PAC-159's instant rule is for things that *happened* at a moment.
 *
 * ## No salary
 *
 * `comp` is reserved for PAC-123 to store a reference to its own collection.
 * Nothing about pay is ever written here.
 */
@Schema({ timestamps: true, collection: 'employeeProfiles' })
export class EmployeeProfile {
  @Prop({ required: true, index: true })
  agencyId: string;

  @Prop({ type: ObjectIdType, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({
    type: String,
    required: true,
    enum: EMPLOYEE_PROFILE_STATUSES,
    default: 'pending',
  })
  status: EmployeeProfileStatus;

  /** `YYYY-MM-DD`; null while pending. */
  @Prop({ type: String, default: null })
  hireDate: string | null;

  /** `MM-DD`; defaults to the hire date's month and day on activation. */
  @Prop({ type: String, default: null })
  workAnniversary: string | null;

  /** `YYYY-MM-DD`; may be in the future (status flips when recorded). */
  @Prop({ type: String, default: null })
  terminationDate: string | null;

  /** `YYYY-MM-DD`; the employee's own, readable by them and `agency:hr:admin`. */
  @Prop({ type: String, default: null })
  dateOfBirth: string | null;

  @Prop({ default: true })
  showBirthday: boolean;

  @Prop({ type: ObjectIdType, ref: 'LeavePolicy', default: null })
  leavePolicyId: Types.ObjectId | null;

  @Prop({ type: Object, default: {} })
  overrides: DeepPartial<LeavePolicyRules>;

  @Prop({ type: ObjectIdType, ref: 'WorkScheduleTemplate', default: null })
  scheduleTemplateId: Types.ObjectId | null;

  @Prop({ type: Object, default: null })
  scheduleOverride: WorkSchedule | null;

  @Prop({ type: Object, default: {} })
  allocations: LeaveAllocations;

  @Prop({ type: [EmployeeAssignmentSchema], default: [] })
  assignments: EmployeeAssignment[];

  /** Reserved for PAC-123 — a reference, never a figure. */
  @Prop({ type: Object, default: null })
  comp: unknown;

  /** Reserved; no reporting hierarchy exists in v1 (PAC-117). */
  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  managerId: Types.ObjectId | null;

  createdAt?: Date;
  updatedAt?: Date;

  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  createdBy?: Types.ObjectId | null;

  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  updatedBy?: Types.ObjectId | null;
}

export const EmployeeProfileSchema =
  SchemaFactory.createForClass(EmployeeProfile);

/** One profile per person per agency. */
EmployeeProfileSchema.index({ agencyId: 1, userId: 1 }, { unique: true });
/** The Onboardings and Employees lists. */
EmployeeProfileSchema.index({ agencyId: 1, status: 1 });
/** `employeesOn(policy)` — the archive guard. */
EmployeeProfileSchema.index({ agencyId: 1, leavePolicyId: 1 });
/** The schedule-template archive guard. */
EmployeeProfileSchema.index({ agencyId: 1, scheduleTemplateId: 1 });
