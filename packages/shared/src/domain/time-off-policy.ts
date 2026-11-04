import type { CustomHoliday, HolidayKey } from './us-holidays';
import type { Weekday } from './work-week';

/**
 * Time off policies (PAC-161 v3, PAC-174) — the wire contract between
 * `/hr/policies/*` and Settings → Time off.
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
 * - `time_off` — one kind of leave (PTO, Sick, …) with its hours. Shaped by
 *   PAC-174; listed here so the page can count and filter it already.
 *
 * ## At most one Holiday and one Work week policy per person
 *
 * Two holiday lists for one person would not say which one applies, so
 * enrolling someone in a second policy of the same type **moves** them: the
 * save takes them out of the other one. Somebody in no Work week policy works
 * Mon–Fri ({@link DEFAULT_WORK_WEEK_DAYS}); somebody in no Holiday policy has
 * no holidays.
 */

export const TIME_OFF_POLICY_TYPES = ['holiday', 'work_week', 'time_off'] as const;
export type TimeOffPolicyType = (typeof TIME_OFF_POLICY_TYPES)[number];

/** The types that can be created today; `time_off` arrives with PAC-174. */
export const CREATABLE_POLICY_TYPES = ['holiday', 'work_week'] as const;
export type CreatablePolicyType = (typeof CREATABLE_POLICY_TYPES)[number];

export const TIME_OFF_POLICY_TYPE_LABELS: Record<TimeOffPolicyType, string> = {
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

export type TimeOffPolicySummary = PolicyBase &
  (
    | { type: 'holiday'; holiday: HolidayPolicyRules }
    | { type: 'work_week'; workWeek: WorkWeekPolicyRules }
  );

export type TimeOffPolicyView = TimeOffPolicySummary & {
  members: PolicyMemberView[];
};

export interface TimeOffPoliciesResponse {
  /** Active policies, newest first. */
  policies: TimeOffPolicySummary[];
  /** Active policies per type, whatever `type` filter was asked for. */
  counts: Record<TimeOffPolicyType, number>;
}

/** Who can be enrolled, and where each person is today. */
export interface PolicyPersonView extends PolicyMemberView {
  /** The person's current policy of each single-enrolment type. */
  policies: Partial<Record<CreatablePolicyType, { id: string; name: string }>>;
}

export interface PolicyPeopleResponse {
  people: PolicyPersonView[];
}

// ── Inputs ──────────────────────────────────────────────────────────────

export type CreateTimeOffPolicyInput =
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
    };

/** Every field optional; `holiday` / `workWeek` must match the policy's type. */
export interface UpdateTimeOffPolicyInput {
  name?: string;
  holiday?: HolidayPolicyRules;
  workWeek?: WorkWeekPolicyRules;
  /** The whole enrolment list, replacing the stored one. */
  memberIds?: string[];
}
