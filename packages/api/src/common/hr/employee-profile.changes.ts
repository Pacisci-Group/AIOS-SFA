import {
  EMPLOYEE_PROFILE_STATUS_LABELS,
  WEEKDAY_LABELS,
  type ActivityChange,
  type ActivityChangeKind,
  type EmployeeProfileStatus,
  type LeaveAllocations,
  type Weekday,
  type WorkSchedule,
} from '@sfa/shared';

/**
 * The before/after diff an employee-profile event records (PAC-162).
 *
 * The `activities/change-log.ts` discipline, kept local so `common/hr` stays
 * worker-importable: a **declared** list of fields, each read as a
 * display-ready value (names, not ids; a day, not an instant), diffed into
 * `ActivityChange` rows that are written once and read forever. A birthday
 * is logged as set or cleared, never as the date.
 */

/** What a profile looks like to the log — already resolved to display values. */
export interface ProfileDisplaySnapshot {
  status: EmployeeProfileStatus;
  hireDate: string | null;
  workAnniversary: string | null;
  terminationDate: string | null;
  dateOfBirth: string | null;
  showBirthday: boolean;
  leavePolicyName: string | null;
  overriddenPaths: string[];
  scheduleTemplateName: string | null;
  scheduleOverride: WorkSchedule | null;
  allocations: LeaveAllocations;
}

interface FieldSpec {
  field: string;
  label: string;
  kind: ActivityChangeKind;
  read: (snapshot: ProfileDisplaySnapshot) => string | number | string[] | null;
}

function scheduleSummary(schedule: WorkSchedule | null): string[] | null {
  if (!schedule) return null;
  const lines: string[] = [];
  for (const key of Object.keys(schedule).sort()) {
    const weekday = Number(key) as Weekday;
    const day = schedule[weekday];
    lines.push(
      day
        ? `${WEEKDAY_LABELS[weekday].slice(0, 3)} ${day.start}–${day.end}`
        : `${WEEKDAY_LABELS[weekday].slice(0, 3)} off`,
    );
  }
  return lines;
}

function allocationSummary(allocations: LeaveAllocations): string[] | null {
  const keys = Object.keys(allocations).sort();
  if (keys.length === 0) return null;
  return keys.map((key) => `${key}: ${allocations[key]} h`);
}

export const PROFILE_CHANGE_SPEC: FieldSpec[] = [
  {
    field: 'status',
    label: 'Status',
    kind: 'text',
    read: (s) => EMPLOYEE_PROFILE_STATUS_LABELS[s.status],
  },
  {
    field: 'hireDate',
    label: 'Hire date',
    kind: 'date',
    read: (s) => s.hireDate,
  },
  {
    field: 'workAnniversary',
    label: 'Work anniversary',
    kind: 'text',
    read: (s) => s.workAnniversary,
  },
  {
    field: 'terminationDate',
    label: 'Termination date',
    kind: 'date',
    read: (s) => s.terminationDate,
  },
  {
    field: 'dateOfBirth',
    label: 'Date of birth',
    kind: 'text',
    // Set or cleared — never the date. The log is readable by admins only,
    // but a birthday is the employee's and the audit needs no more than this.
    read: (s) => (s.dateOfBirth ? 'Set' : null),
  },
  {
    field: 'showBirthday',
    label: 'Show birthday on the calendar',
    kind: 'text',
    read: (s) => (s.showBirthday ? 'Yes' : 'No'),
  },
  {
    field: 'leavePolicy',
    label: 'Leave policy',
    kind: 'text',
    read: (s) => s.leavePolicyName,
  },
  {
    field: 'customRules',
    label: 'Custom rules',
    kind: 'list',
    read: (s) => (s.overriddenPaths.length ? [...s.overriddenPaths] : null),
  },
  {
    field: 'scheduleTemplate',
    label: 'Schedule template',
    kind: 'text',
    read: (s) => s.scheduleTemplateName,
  },
  {
    field: 'scheduleOverride',
    label: 'Schedule override',
    kind: 'list',
    read: (s) => scheduleSummary(s.scheduleOverride),
  },
  {
    field: 'allocations',
    label: 'Annual allocations',
    kind: 'list',
    read: (s) => allocationSummary(s.allocations),
  },
];

function same(
  a: string | number | string[] | null,
  b: string | number | string[] | null,
): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => item === b[i]);
  }
  return a === b;
}

/** The fields that differ between two snapshots, as display-ready change rows. */
export function diffProfileSnapshots(
  before: ProfileDisplaySnapshot | null,
  after: ProfileDisplaySnapshot,
): ActivityChange[] {
  const changes: ActivityChange[] = [];
  for (const spec of PROFILE_CHANGE_SPEC) {
    const from = before ? spec.read(before) : null;
    const to = spec.read(after);
    if (same(from, to)) continue;
    changes.push({
      field: spec.field,
      label: spec.label,
      kind: spec.kind,
      from,
      to,
    });
  }
  return changes;
}
