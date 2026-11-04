import type { TimeOffPolicyRules, TimeOffTypeKey } from './time-off-policy';
import type { CustomHoliday, HolidayKey } from './us-holidays';
import type { Weekday } from './work-week';

/**
 * HR policies (PAC-161 v3, PAC-174) — the wire contract between
 * `/hr/policies/*` and Workspace Settings → HR policies.
 *
 * ## One shape for every kind of rule
 *
 * A policy is a **set of rules plus the people enrolled in it**, the Gusto
 * model David asked for: different rules for different people is another
 * policy, never a per-person override. Three types:
 *
 * - `holiday` — which holidays the office closes for (recurring by rule, see
 *   `us-holidays.ts`) plus the agency's own.
 * - `work_week` — the days and hours someone works.
 * - `time_off` — one kind of leave (PTO, Sick, …) with its accrual model
 *   (PAC-174, `time-off-policy.ts`).
 *
 * ## At most one policy of a kind per person
 *
 * Two holiday lists for one person would not say which one applies, so
 * enrolling someone in a second policy of the same type **moves** them: the
 * save takes them out of the other one. For time off the "type" is the
 * policy's `timeOffType` (one PTO policy, one Sick policy, …), and a Custom
 * policy never moves anyone. Somebody in no Work week policy works Mon–Fri
 * ({@link DEFAULT_WORK_WEEK_DAYS}); somebody in no Holiday policy has no
 * holidays; somebody in no time off policy cannot request time off.
 */

export const HR_POLICY_TYPES = ['holiday', 'work_week', 'time_off'] as const;
export type HrPolicyType = (typeof HR_POLICY_TYPES)[number];

/** Every type can be created; the alias survives for its call sites. */
export const CREATABLE_POLICY_TYPES = HR_POLICY_TYPES;
export type CreatablePolicyType = HrPolicyType;

/** The types whose one-per-person rule is keyed on the type itself. */
export const MEMBER_LIST_POLICY_TYPES = ['holiday', 'work_week'] as const;
export type MemberListPolicyType = (typeof MEMBER_LIST_POLICY_TYPES)[number];

export const HR_POLICY_TYPE_LABELS: Record<HrPolicyType, string> = {
  holiday: 'Holiday',
  work_week: 'Work week',
  time_off: 'Time off',
};

export const POLICY_NAME_MAX_LENGTH = 80;

// ── Rules ───────────────────────────────────────────────────────────────

export interface HolidayPolicyRules {
  /** Catalog holidays, recurring every year. */
  holidays: HolidayKey[];
  customHolidays: CustomHoliday[];
}

/** One working day of the week, `'HH:mm'` on the agency's clock. */
export interface WorkWeekDay {
  weekday: Weekday;
  start: string;
  end: string;
}

export interface WorkWeekPolicyRules {
  /** One row per working weekday, Sunday-first. Days not listed are off. */
  days: WorkWeekDay[];
}

/** Mon–Fri, 9 to 5: the week of anyone in no Work week policy. */
export const DEFAULT_WORK_WEEK_DAYS: readonly WorkWeekDay[] = (
  [1, 2, 3, 4, 5] as const
).map((weekday) => ({ weekday, start: '09:00', end: '17:00' }));

// ── Views ───────────────────────────────────────────────────────────────

export type PolicyPersonStatus = 'active' | 'invited';

export interface PolicyMemberView {
  id: string;
  name: string;
  email: string;
  branchName: string | null;
  status: PolicyPersonStatus;
  /**
   * Time off policies only: the person's balance in this policy, the sum of
   * their ledger rows; `null` on an Unlimited policy. Absent on the other
   * types.
   */
  balanceHours?: number | null;
}

export interface PolicyRef {
  id: string;
  name: string;
}

interface PolicyBase {
  id: string;
  name: string;
  /** Enrolled people who have not been removed from the agency. */
  memberCount: number;
  /** ISO-8601. */
  createdAt: string;
  updatedAt: string;
}

export type HrPolicySummary = PolicyBase &
  (
    | { type: 'holiday'; holiday: HolidayPolicyRules }
    | { type: 'work_week'; workWeek: WorkWeekPolicyRules }
    | { type: 'time_off'; timeOff: TimeOffPolicyRules }
  );

export type HrPolicyView = HrPolicySummary & {
  members: PolicyMemberView[];
};

export interface HrPoliciesResponse {
  /** Active policies, newest first. */
  policies: HrPolicySummary[];
  /** Active policies per type, whatever `type` filter was asked for. */
  counts: Record<HrPolicyType, number>;
}

/** Who can be enrolled, and where each person is today. */
export interface PolicyPersonView extends PolicyMemberView {
  /** The person's current Holiday and Work week policy. */
  policies: Partial<Record<MemberListPolicyType, PolicyRef>>;
  /** The person's current time off policy per kind; Custom is never listed. */
  timeOffPolicies: Partial<Record<TimeOffTypeKey, PolicyRef>>;
}

export interface PolicyPeopleResponse {
  people: PolicyPersonView[];
}

// ── Inputs ──────────────────────────────────────────────────────────────

export type CreateHrPolicyInput =
  | {
      type: 'holiday';
      name: string;
      holiday: HolidayPolicyRules;
      memberIds: string[];
    }
  | {
      type: 'work_week';
      name: string;
      workWeek: WorkWeekPolicyRules;
      memberIds: string[];
    }
  | {
      type: 'time_off';
      name: string;
      timeOff: TimeOffPolicyRules;
      memberIds: string[];
      /**
       * Starting balance per member, in hours, keyed by user id. A member
       * not listed gets the default (the yearly total on a Yearly policy,
       * otherwise 0). Ignored on Unlimited.
       */
      startingBalanceHours?: Record<string, number>;
    };

/**
 * Every field optional; `holiday` / `workWeek` / `timeOff` must match the
 * policy's type. `timeOff.compensation` and `timeOff.accrualType` may be
 * sent but must equal the stored values — they are locked once active.
 */
export interface UpdateHrPolicyInput {
  name?: string;
  holiday?: HolidayPolicyRules;
  workWeek?: WorkWeekPolicyRules;
  timeOff?: Partial<TimeOffPolicyRules>;
  /** The whole enrolment list, replacing the stored one. */
  memberIds?: string[];
  /**
   * Starting balance for people *newly* added by this save. Refused for
   * someone who was in the policy before: their balance resumes.
   */
  startingBalanceHours?: Record<string, number>;
}
