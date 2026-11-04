import type { PolicyRef, WorkWeekDay } from './hr-policy';
import type { TimeOffPolicyRules } from './time-off-policy';
import type { UserAvailability } from './user-availability';

/**
 * People (PAC-162): the agency directory with onboarding in its status, and
 * the per-person profile — the wire contract between `GET /users`,
 * `GET /users/:userId/profile`, `/hr/people/*` and the People pages.
 *
 * ## Two statuses, one derived
 *
 * A **person's** status on the list ({@link PeopleStatus}) is derived on the
 * server from the account (`isActive` / `deactivatedAt`) *and* the employee
 * profile: Invited → Pending onboarding → Active, plus Deactivated. The
 * **profile's** own status ({@link EmployeeProfileStatus}) is the HR fact
 * underneath it: `pending` until an HR admin completes onboarding, `active`
 * after, `terminated` once the person is removed. The list never shows the
 * profile status directly — a removed person reads Deactivated whatever the
 * profile says, and an invited person reads Invited even if HR onboarded
 * them before they accepted.
 *
 * ## The profile stores only facts no policy holds
 *
 * Hire date, termination date, date of birth. The schedule is the person's
 * Work week policy, the holidays their Holiday policy, the balances their
 * ledger rows — the profile read assembles them, it does not copy them.
 */

export const PEOPLE_STATUSES = [
  'invited',
  'pending_onboarding',
  'active',
  'deactivated',
] as const;
export type PeopleStatus = (typeof PEOPLE_STATUSES)[number];

export const PEOPLE_STATUS_LABELS: Record<PeopleStatus, string> = {
  invited: 'Invited',
  pending_onboarding: 'Pending onboarding',
  active: 'Active',
  deactivated: 'Deactivated',
};

export const EMPLOYEE_PROFILE_STATUSES = ['pending', 'active', 'terminated'] as const;
export type EmployeeProfileStatus = (typeof EMPLOYEE_PROFILE_STATUSES)[number];

/** Free text — a US agency types `(312) 555-0100`; nothing dials it. */
export const PHONE_MAX_LENGTH = 30;

/** A date of birth before this is a typo. */
export const EARLIEST_DATE_OF_BIRTH = '1900-01-01';

// ── Views ───────────────────────────────────────────────────────────────

/** The account half of a profile: what `GET /users` knows, plus the branch and roles by name. */
export interface PersonUserView {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  /** `firstName lastName`, or the email when both are blank. */
  name: string;
  phone: string | null;
  /** A stable relative path with a cache-buster, or null without a photo. */
  avatarUrl: string | null;
  branch: PolicyRef | null;
  roles: PolicyRef[];
  availability: UserAvailability;
  isActive: boolean;
  /** ISO-8601 when removed from the agency; null otherwise. */
  deactivatedAt: string | null;
  status: PeopleStatus;
}

/**
 * The HR facts. `dateOfBirth` / `showBirthday` are present only when the
 * viewer may see them (the person themself, or an HR admin) — absent, not
 * null, so a client cannot mistake "hidden" for "not set".
 */
export interface PersonEmploymentView {
  status: EmployeeProfileStatus;
  /** `YYYY-MM-DD`; null until onboarding sets it. */
  hireDate: string | null;
  /** `YYYY-MM-DD`; set when the person is removed, cleared by a later onboarding. */
  terminationDate: string | null;
  dateOfBirth?: string | null;
  showBirthday?: boolean;
  /** ISO-8601 when an HR admin pressed Complete; null while pending. */
  onboardingCompletedAt: string | null;
  onboardingCompletedBy: PolicyRef | null;
}

/** One time off policy the person is in, with their current balance. */
export interface PersonTimeOffPolicyView {
  id: string;
  name: string;
  timeOff: TimeOffPolicyRules;
  /** The sum of the person's ledger rows; null on an Unlimited policy. */
  balanceHours: number | null;
}

/** The person's week, as their Work week and Holiday policies say. */
export interface PersonScheduleView {
  /** Null = the default Mon–Fri 9–5 week. */
  workWeek: PolicyRef | null;
  days: WorkWeekDay[];
  /** Σ (end − start) over `days`, two decimals — the hours nobody tracks. */
  hoursPerWeek: number;
  /** Null = no holidays. */
  holiday: PolicyRef | null;
}

/**
 * `GET /users/:userId/profile`. `timeOff` and `schedule` are present only
 * for the person themself (holding `hr:read`) or an HR admin.
 */
export interface PersonProfileView {
  user: PersonUserView;
  employment: PersonEmploymentView;
  timeOff?: { policies: PersonTimeOffPolicyView[] };
  schedule?: PersonScheduleView;
}

// ── Inputs ──────────────────────────────────────────────────────────────

/** `PATCH /hr/people/:userId`. `null` clears; absent leaves alone. */
export interface UpdatePersonFactsInput {
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  /** `YYYY-MM-DD`, not after today on the agency's calendar; clearable only while pending. */
  hireDate?: string | null;
  /** `YYYY-MM-DD`, before today and after 1900. */
  dateOfBirth?: string | null;
  showBirthday?: boolean;
}

export interface OnboardingPolicyChoice {
  policyId: string;
  /** Time off policies only; the policy's default when omitted. */
  startingBalanceHours?: number;
}

/** `POST /hr/people/:userId/onboarding/complete`. */
export interface CompleteOnboardingInput {
  hireDate: string;
  dateOfBirth?: string | null;
  showBirthday?: boolean;
  phone?: string | null;
  policies: OnboardingPolicyChoice[];
}

/** `POST /hr/policies/:policyId/members`. */
export interface EnrolMemberInput {
  userId: string;
  /** Time off policies only; refused for someone who was in the policy before. */
  startingBalanceHours?: number;
}
