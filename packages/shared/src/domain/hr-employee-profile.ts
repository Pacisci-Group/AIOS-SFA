import type { ActivityChange } from './activity';
import type { CalendarActorView, Weekday, WorkSchedule, WorkScheduleDay } from './hr-calendar';
import type {
  DeepPartial,
  EffectiveLeaveRules,
  LeavePolicyRules,
} from './hr-leave-policy';

/**
 * Employee profiles + HR onboarding (PAC-162) — the per-person record every
 * HR engine keys on, and the wire contract for `/hr/employees/*`,
 * `/hr/me/profile` and `/hr/schedule-templates/*`.
 *
 * ## One document per user per agency
 *
 * `employeeProfiles` holds what HR knows about a person that the `users` row
 * does not: their status with HR, the leave policy they are on and the
 * **overrides** that make their rules "custom", their schedule and
 * allocations, hire / anniversary / termination dates, and an optional date
 * of birth. Name, email, branch and roles stay on the user and are resolved
 * through `userId` — never copied.
 *
 * ## Current fields + an append-only history
 *
 * The rule-shaped fields (`leavePolicyId`, `overrides`, `scheduleTemplateId`,
 * `scheduleOverride`, `allocations`) are stored twice on purpose: once as
 * the current values the lists filter and the archive guards count, and once
 * more as the **last entry of `assignments[]`**, a full picture effective from
 * a day. Every change writes both in one update, so they cannot drift, and
 * "which rules applied on day X" is one lookup
 * ({@link EmployeeAssignmentView}). `effectiveFrom` is an agency day, never
 * in the future.
 *
 * ## "Custom" is template + overrides, never a clone
 *
 * `overrides` carries only the paths that differ from the policy (arrays
 * whole, the inverse of the API's `mergeRules`); the server strips any path
 * whose value equals the template, so `overriddenPaths` is honest. A person
 * whose rules match nobody is given a **new named policy** through the
 * editor's "Save as new policy", not a large override set.
 *
 * ## Date of birth
 *
 * Set by the employee (at the setup step, or on their own profile), read by
 * the employee and `agency:hr:admin` only, shown as a date and never as an
 * age, absent from every list. PAC-169's calendar reads month and day for
 * employees who opted in (`showBirthday`).
 *
 * ## No salary
 *
 * `comp` is a reserved slot for PAC-123 to store a *reference* to its own
 * collection. Nothing about pay lives in this document.
 */

export const EMPLOYEE_PROFILE_STATUSES = [
  'pending',
  'active',
  'terminated',
] as const;
export type EmployeeProfileStatus = (typeof EMPLOYEE_PROFILE_STATUSES)[number];

export const EMPLOYEE_PROFILE_STATUS_LABELS: Record<
  EmployeeProfileStatus,
  string
> = {
  pending: 'Pending onboarding',
  active: 'Active',
  terminated: 'Terminated',
};

/**
 * Hours per **balance-bearing** leave type (`LeaveTypeRule.key`). A missing
 * key means the policy's `pto.annualAllocationHours`. Not an override of the
 * policy — the policy has one number, the person has one per type.
 */
export type LeaveAllocations = Record<string, number>;

/** What a user row looks like from inside HR: display only, resolved on read. */
export interface EmployeeUserView {
  name: string | null;
  email: string;
  branchId: string | null;
  branchName: string | null;
  /** Display names; never branch on them. */
  roleNames: string[];
  /** The account's own state — distinct from the HR `status`. */
  accountStatus: 'active' | 'invited' | 'deactivated';
}

/** One entry of the assignment history, newest first on the detail view. */
export interface EmployeeAssignmentView {
  /** `YYYY-MM-DD`, an agency day. */
  effectiveFrom: string;
  leavePolicyId: string;
  /** Resolved at read time; `null` when the policy row is gone. */
  leavePolicyName: string | null;
  overrides: DeepPartial<LeavePolicyRules>;
  /** Dotted paths the overrides change, e.g. `pto.annualAllocationHours`. */
  overriddenPaths: string[];
  scheduleTemplateId: string | null;
  scheduleTemplateName: string | null;
  scheduleOverride: WorkSchedule | null;
  allocations: LeaveAllocations;
  actor: CalendarActorView | null;
  reason: string | null;
  /** ISO instant — when the entry was written, not when it took effect. */
  recordedAt: string;
}

/** Where the effective weekly schedule came from. */
export type EffectiveScheduleSource = 'override' | 'template' | 'workweek';

export interface EffectiveScheduleView {
  templateId: string | null;
  templateName: string | null;
  override: WorkSchedule | null;
  /** Override → template → the agency workweek at {@link DEFAULT_SCHEDULE_DAY}. */
  effective: WorkSchedule;
  source: EffectiveScheduleSource;
  /** Minutes per week the effective schedule adds up to. */
  weeklyMinutes: number;
}

export const EMPLOYEE_PROFILE_EVENT_KINDS = [
  'created',
  'activated',
  'facts_updated',
  'assignment_changed',
  'terminated',
  'rehired',
  'birthday_updated',
] as const;
export type EmployeeProfileEventKind =
  (typeof EMPLOYEE_PROFILE_EVENT_KINDS)[number];

export const EMPLOYEE_PROFILE_EVENT_LABELS: Record<
  EmployeeProfileEventKind,
  string
> = {
  created: 'Profile created',
  activated: 'Activated',
  facts_updated: 'Details updated',
  assignment_changed: 'Rules changed',
  terminated: 'Terminated',
  rehired: 'Rehired',
  birthday_updated: 'Birthday updated',
};

/** One row of the before/after audit log, newest first. */
export interface EmployeeProfileEventView {
  id: string;
  /** ISO instant. */
  at: string;
  kind: EmployeeProfileEventKind;
  actor: CalendarActorView | null;
  reason: string | null;
  changes: ActivityChange[];
}

/** `GET /hr/employees/:userId` — the admin's view of one person. */
export interface EmployeeProfileView {
  id: string;
  userId: string;
  status: EmployeeProfileStatus;
  user: EmployeeUserView;
  /** `YYYY-MM-DD` or null while pending. */
  hireDate: string | null;
  /** `MM-DD`; defaults to the hire date's month and day on activation. */
  workAnniversary: string | null;
  terminationDate: string | null;
  /** `YYYY-MM-DD`. Admin and self only — never on a list. */
  dateOfBirth: string | null;
  showBirthday: boolean;
  leavePolicy: { id: string; name: string; version: number } | null;
  overrides: DeepPartial<LeavePolicyRules>;
  /** Template + overrides; `null` while pending (no policy yet). */
  effective: EffectiveLeaveRules | null;
  schedule: EffectiveScheduleView;
  /** As stored: only the keys an admin set. */
  allocations: LeaveAllocations;
  /** Every active balance-bearing type filled in from the policy default. */
  effectiveAllocations: LeaveAllocations;
  assignments: EmployeeAssignmentView[];
  events: EmployeeProfileEventView[];
  createdAt: string;
  updatedAt: string;
}

/** One row of `GET /hr/employees`. No date of birth here, by design. */
export interface EmployeeListItem {
  id: string;
  userId: string;
  status: EmployeeProfileStatus;
  user: EmployeeUserView;
  hireDate: string | null;
  terminationDate: string | null;
  leavePolicy: { id: string; name: string } | null;
  /** How many rule paths the person's overrides change. */
  customRuleCount: number;
  scheduleTemplateName: string | null;
  /** ISO instant the profile was created — "pending since" on the Onboardings list. */
  createdAt: string;
}

export interface EmployeeListResponse {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  items: EmployeeListItem[];
  /** Whole-agency counts, independent of the filters applied. */
  counts: Record<EmployeeProfileStatus, number>;
  /** The Onboardings page's empty state hinges on this being zero. */
  activePolicyCount: number;
}

/** `POST /hr/employees/:userId/activate` — pending → active, or terminated → active (rehire). */
export interface ActivateEmployeeInput {
  leavePolicyId: string;
  overrides?: DeepPartial<LeavePolicyRules>;
  scheduleTemplateId?: string | null;
  scheduleOverride?: WorkSchedule | null;
  allocations?: LeaveAllocations;
  /** `YYYY-MM-DD`, not in the future. */
  hireDate: string;
  /** `MM-DD`; omitted → derived from `hireDate`. */
  workAnniversary?: string | null;
  /** `YYYY-MM-DD`; omitted → the hire date (first activation) or today (rehire). */
  effectiveFrom?: string;
  reason?: string;
}

/** `PUT /hr/employees/:userId/assignment` — a new history entry on an active profile. */
export interface SetEmployeeAssignmentInput {
  leavePolicyId: string;
  overrides?: DeepPartial<LeavePolicyRules>;
  scheduleTemplateId?: string | null;
  scheduleOverride?: WorkSchedule | null;
  allocations?: LeaveAllocations;
  /** `YYYY-MM-DD`; omitted → today on the agency's calendar. */
  effectiveFrom?: string;
  reason: string;
}

/** `PATCH /hr/employees/:userId` — facts only, never rules. */
export interface UpdateEmployeeFactsInput {
  hireDate?: string;
  workAnniversary?: string | null;
  dateOfBirth?: string | null;
  showBirthday?: boolean;
}

/** `POST /hr/employees/:userId/terminate`. The date may be in the future. */
export interface TerminateEmployeeInput {
  terminationDate: string;
  reason: string;
}

/** `GET /hr/me/profile` — what an employee sees of their own record. */
export interface MyHrProfileView {
  status: EmployeeProfileStatus;
  hireDate: string | null;
  workAnniversary: string | null;
  terminationDate: string | null;
  dateOfBirth: string | null;
  showBirthday: boolean;
  leavePolicyName: string | null;
  /** Read-only effective rules; `null` while pending. */
  effective: EffectiveLeaveRules | null;
  schedule: EffectiveScheduleView;
  effectiveAllocations: LeaveAllocations;
}

/** `PATCH /hr/me/profile` — the two birthday fields and nothing else. */
export interface UpdateMyHrProfileInput {
  dateOfBirth?: string | null;
  showBirthday?: boolean;
}

export type WorkScheduleTemplateStatus = 'active' | 'archived';

export interface WorkScheduleTemplateView {
  id: string;
  name: string;
  status: WorkScheduleTemplateStatus;
  version: number;
  schedule: WorkSchedule;
  weeklyMinutes: number;
  /** Non-terminated profiles referencing it; what blocks an archive. */
  employeeCount: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface WorkScheduleTemplatesResponse {
  templates: WorkScheduleTemplateView[];
}

/** `POST` needs a name; `schedule` defaults to the agency workweek. `PATCH` takes either. */
export interface UpsertWorkScheduleTemplateInput {
  name?: string;
  schedule?: WorkSchedule;
}

/** The shift a workweek day gets when nobody has said otherwise. */
export const DEFAULT_SCHEDULE_DAY: WorkScheduleDay = {
  start: '09:00',
  end: '17:00',
};

/** The agency workweek as a schedule: {@link DEFAULT_SCHEDULE_DAY} on each open day. */
export function scheduleFromWorkweek(
  workweek: readonly Weekday[],
): WorkSchedule {
  const out: WorkSchedule = {};
  for (const day of workweek) {
    out[day] = { ...DEFAULT_SCHEDULE_DAY };
  }
  return out;
}

/** `'HH:mm'` → minutes since midnight, or `null` when malformed. */
export function clockToMinutes(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Minutes in one shift; zero for a malformed or inverted pair. */
export function shiftMinutes(day: WorkScheduleDay | null | undefined): number {
  if (!day) return 0;
  const start = clockToMinutes(day.start);
  const end = clockToMinutes(day.end);
  if (start === null || end === null || end <= start) return 0;
  return end - start;
}

/** Minutes per week a schedule adds up to. */
export function weeklyMinutes(schedule: WorkSchedule): number {
  let total = 0;
  for (const day of Object.values(schedule)) {
    total += shiftMinutes(day);
  }
  return total;
}

/**
 * By tag, not by prototype: a `structuredClone` result, or a Mongo `.lean()`
 * row under Jest's vm realm, has an `Object.prototype` from another realm.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return (
      a.length === b.length && a.every((item, i) => deepEqual(item, b[i]))
    );
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    return (
      keysA.length === keysB.length &&
      keysA.every((key) => deepEqual(a[key], b[key]))
    );
  }
  return false;
}

function diffInto(
  template: Record<string, unknown>,
  edited: Record<string, unknown>,
): Record<string, unknown> | undefined {
  let out: Record<string, unknown> | undefined;
  for (const key of Object.keys(template)) {
    const base = template[key];
    const value = edited[key];
    if (value === undefined) continue;
    if (isPlainObject(base) && isPlainObject(value)) {
      const nested = diffInto(base, value);
      if (nested !== undefined) {
        out ??= {};
        out[key] = nested;
      }
    } else if (!deepEqual(base, value)) {
      out ??= {};
      out[key] = structuredClone(value);
    }
  }
  return out;
}

/**
 * The inverse of the API's `mergeRules`: the paths of `edited` whose value
 * differs from `template`, nested like the rules, **arrays whole** (a changed
 * leave-type list is the whole list). Keys the template does not have are
 * ignored — they are not rules. `{}` when nothing differs.
 */
export function diffRules(
  template: LeavePolicyRules,
  edited: LeavePolicyRules,
): DeepPartial<LeavePolicyRules> {
  return (diffInto(
    template as unknown as Record<string, unknown>,
    edited as unknown as Record<string, unknown>,
  ) ?? {}) as DeepPartial<LeavePolicyRules>;
}

/** The dotted leaf paths an override object sets, in document order. */
export function overridePaths(
  overrides: DeepPartial<LeavePolicyRules> | null | undefined,
): string[] {
  const paths: string[] = [];
  const walk = (node: Record<string, unknown>, prefix: string) => {
    for (const [key, value] of Object.entries(node)) {
      if (value === undefined) continue;
      const path = prefix ? `${prefix}.${key}` : key;
      if (isPlainObject(value)) walk(value, path);
      else paths.push(path);
    }
  };
  if (overrides) walk(overrides as Record<string, unknown>, '');
  return paths;
}
