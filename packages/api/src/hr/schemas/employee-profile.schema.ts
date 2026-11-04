import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  EMPLOYEE_PROFILE_STATUSES,
  type EmployeeProfileStatus,
} from '@sfa/shared';
import { HydratedDocument, Types } from 'mongoose';
import { ObjectIdType } from '../../common/mongo/object-id';

export type EmployeeProfileDocument = HydratedDocument<EmployeeProfile>;

/**
 * When an HR admin completed the person's onboarding (PAC-162). A
 * sub-document rather than two flat fields: the employee-side onboarding
 * Asad wants later (documents to upload, a to-do list) keeps its state here
 * beside these, not in a second collection.
 */
@Schema({ _id: false })
export class EmployeeOnboardingRow {
  @Prop({ type: Date, default: null })
  completedAt: Date | null;

  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  completedBy: Types.ObjectId | null;
}
export const EmployeeOnboardingRowSchema =
  SchemaFactory.createForClass(EmployeeOnboardingRow);

/**
 * The per-person HR record (PAC-162) — one per user per agency, created the
 * moment the user is (invite, migration, seed) and never deleted except with
 * a revoked invite's user row.
 *
 * ## Only facts no policy holds
 *
 * Hire date, termination date, date of birth, and the onboarding stamp. The
 * person's week is their Work week policy, their holidays their Holiday
 * policy, their balances their `leaveLedger` rows — the profile read
 * (`UsersService.personProfile`) assembles those; nothing is copied here
 * (the PAC-91 lesson about denormalised copies nothing keeps in step). No
 * schedule override, no rule override, no assignment history, no salary
 * (PAC-123 references `userId` from its own collection) and no manager
 * (there is no hierarchy, PAC-117).
 *
 * ## Status
 *
 * `pending` until an HR admin presses Complete onboarding, `active` after,
 * `terminated` once the person is removed from the agency. Reactivating a
 * removed person puts them back to `pending`: re-joining is an onboarding,
 * and Complete clears the old `terminationDate`. The *list* status a person
 * shows (Invited · Pending onboarding · Active · Deactivated) is derived from
 * this and the account together — `common/hr/people-status.ts`.
 *
 * ## Dates are calendar days
 *
 * `YYYY-MM-DD`, like a holiday row: a hire date names a day, it did not
 * happen at an instant, and it must not move when the agency changes its
 * zone. PAC-159's instant rule is for events (a sale, a quote). "Today" —
 * the bound every date is judged against — is today on the agency's
 * calendar (`agencyTodayIso`).
 *
 * ## Agency-level, string `agencyId`, no `branchId`
 *
 * Same convention as the policies: a string `agencyId` (unlike
 * `User.agencyId`, an ObjectId) and no branch — the branch is a fact about
 * the *user* and is read through `userId`.
 */
@Schema({ timestamps: true, collection: 'employeeProfiles' })
export class EmployeeProfile {
  @Prop({ required: true })
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

  /** `YYYY-MM-DD`; null until onboarding sets it. */
  @Prop({ type: String, default: null })
  hireDate: string | null;

  /** `YYYY-MM-DD`; the day the person was removed; cleared by a later onboarding. */
  @Prop({ type: String, default: null })
  terminationDate: string | null;

  /** `YYYY-MM-DD`; readable by the person and `agency:hr:admin` only, never as an age. */
  @Prop({ type: String, default: null })
  dateOfBirth: string | null;

  /** Whether the calendar (PAC-169) may show the month and day. */
  @Prop({ default: true })
  showBirthday: boolean;

  @Prop({
    type: EmployeeOnboardingRowSchema,
    default: () => ({ completedAt: null, completedBy: null }),
  })
  onboarding: EmployeeOnboardingRow;

  createdAt?: Date;
  updatedAt?: Date;

  /** Authorship plugin; null from the migration, the seed and the worker. */
  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  createdBy?: Types.ObjectId | null;

  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  updatedBy?: Types.ObjectId | null;
}

export const EmployeeProfileSchema =
  SchemaFactory.createForClass(EmployeeProfile);

/** One profile per person per agency; the profile read's lookup. */
EmployeeProfileSchema.index({ agencyId: 1, userId: 1 }, { unique: true });

/** The People list's status facet (pending vs active). */
EmployeeProfileSchema.index({ agencyId: 1, status: 1 });
