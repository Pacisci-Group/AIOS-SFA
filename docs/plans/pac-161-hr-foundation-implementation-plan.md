# PAC-161 — HR foundation: implementation plan

Ticket: https://linear.app/paciscigroup/issue/PAC-161 (sub-story 1 of 5 under the
[PAC-148](https://linear.app/paciscigroup/issue/PAC-148) epic; absorbs the former
PAC-163). Blocks PAC-162, and through it PAC-165 / PAC-167 / PAC-169.

Paths relative to the AIOS-SFA repo root; `api/` = `packages/api/src`,
`web/` = `packages/web/src`, `shared/` = `packages/shared/src`.

## Context

PAC-148 turns the app into the agency's system of record for leave and attendance.
Every later sub-story reads from three things this ticket builds: the **`hr`
module and its permissions**, the **agency calendar + one working-day service**,
and the **leave policies** (the epic's "HR Policy" is a view over them, not a
record — decision 9), read through one policy service
whose values are snapshotted onto every record posted under them. It also adds
the two skippable **onboarding phases** (Calendar, HR Policy) and the admin
**settings page** at `/settings/hr`.

Decisions already made in the epic (do not re-litigate): nothing per branch in
v1; Branch Manager *is* the Office Manager (no new template); every number,
threshold and vocabulary is a per-agency setting with SFA's spec values as the
seeded defaults; holidays are **suggested** by the `date-holidays` npm package on
the API, **confirmed** by a person and saved as the agency's own rows, never
auto-inserted; the Q4 job *proposes* next year's holidays; calendar UI for the
employee page (PAC-169) is FullCalendar v7 + its shadcn theme, an explicit
exception to the web "no second component library" rule.

### What exists (verified)

| Need | What is there today |
|---|---|
| Module + permission machinery | `ModuleKey` enum (15 keys, order drives catalog `sortOrder`); page permissions are **only** `{module}:read` / `{module}:write` — enforced by `permission-model.spec.ts`, `allPagePermissionKeys()`, `RolesService.updateLevels`' whitelist and `resolvePermissionSet`'s module filter. Capabilities that are not a page live in the `agency:` namespace (`AgencyPermission`, written up on `ChangeLogsRead`). `grantsAllEnabledModules` expands only `{m}:read/write`. |
| New-module rollout | `migrations/20261007085957-analytics_module.js` — the three-part template: catalog rows (`$set`+`$setOnInsert`), entitlement where absent, Branch Manager grant. `20261006120100-agency_settings_permission_grant.js` — the template for a new `agency:*` pair (catalog rows + owner grant). PAC-149 lesson: a permission with no catalog row 400s Onboard Agency. |
| Agency working day | `Agency.timezone` (PAC-141), `Agency.endOfDayHour` (PAC-149), `AccessContext.timeZone`; helpers `zonedDate` / `zonedDayStart` / `instantWindow` / `agencyTodayIso` (`performance.range.ts`), `businessDateInstant` / `businessDay` (`common/dates/business-dates.ts`), `localClock` (`common/dates/time-zones.ts`). |
| Business-day math | `common/dates/business-days.ts` — weekends + **hard-coded US federal holidays**, on `CalendarDate` triples through UTC anchors (no DST exposure). Built for Manager-view audit aging (PAC-139). Nothing agency-specific. |
| Onboarding | `Agency.setup` (`status`, `completedAt`, `completedByUserId`, `brandingSkipped`), `AgencySetupController` (`GET /agency/setup`, `POST /agency/setup/complete`, gated on `agency:branding:*`), `AGENCY_SETUP_STEPS` (brand → email → carriers → finish) shared by `InviteWizard` and `/welcome/agency`; `RoleLanding` redirects on `user.agencySetupPending`. |
| Settings precedent | `/settings/agency` (`AgencyProfilePage`, `agency:settings:*`, `SettingsPage` shell, `DetailCard`, `useAppForm`), `SETTINGS_SECTIONS` registry feeding hub, sidebar and route guards. |
| Worker | One-cron-every-agency pattern (`set-users-away.fn.ts` + `forEachAgency` + claim-marker on the agency doc); `InngestFunction` registry; lint boundary (`eslint.config.mjs` `FEATURE_DIRS`): the worker imports only `common/`, `inngest/`, schemas. |
| Notifications | `notification/requested.v1` event (`recipientIds`, `type`, `dedupeKey`), shared catalog `NOTIFICATION_TYPES` + `renderNotification` + fixture spec; the only producer is `BugReportsService`. Category `'attendance'` already exists in the union. |
| Provisioning paths | `seed/provision-tenant.ts` (migration + demo seed, find-or-create) and `AgencyProvisioningService` (panel wizard, explicit undo stack). Both run `seedDefaultRoles` + `seedAuditTemplates`; neither seeds anything HR. `Branch.address` (state as free text) is the only address an agency has. |
| Legacy | `timeOffRequests` collection (migrated, no reads) and vocabularies in `shared/domain/time-off.ts` — **untouched here**; PAC-165 migrates them. |
| Tests | `*.unit-spec.ts` via `test/jest-unit.json`; e2e in `test/*.e2e-spec.ts` with `seedTestData` (owner, producer, csr, read-only; **no branch manager user**); worker e2e in `test/worker/`. Bruno `Local.bru` has `managerEmail` = the demo Branch Manager. |

## Decisions for this plan

1. **Four capabilities, modelled on the machinery we have** (settles the ticket's
   sketch `hr:read / hr:review / hr:admin / hr:export`):

   | Ticket name | Built as | Kind | Who holds it by default |
   |---|---|---|---|
   | `hr:read` | `hr:read` | module page permission | every template (Producer, CSR, CRM, Data Team, Branch Manager); Owner via enabled modules |
   | `hr:review` | `hr:write` | module page permission | Branch Manager; Owner via enabled modules |
   | `hr:admin` | `agency:hr:admin` | agency admin capability | Branch Manager, Agency Owner |
   | `hr:export` | `agency:hr:export` | agency admin capability | Branch Manager, Agency Owner |

   Why not four actions on one module: the page model tolerates only
   `read`/`write` (`permission-model.spec`, `updateLevels` would silently drop
   `hr:review` the first time an owner touched the matrix, `resolvePermissionSet`
   would read `hr_admin:` as a module key). Why not a second module key
   `hr_admin`: a super admin toggling "HR admin" separately from "HR" is not a
   product concept, and export would need a third key. The `agency:` namespace is
   exactly the precedent (`ChangeLogsRead`, the white-label pairs, `WorkTransfer`,
   `SettingsRead`) and the role editor already renders that group. Cost: the two
   `agency:hr:*` strings are role-only (not grantable per user), which matches
   "custom roles add it by hand".

   **`hr:read` authorizes "own" writes.** An employee creates their *own* time-off
   request or attendance event (PAC-165/167) holding only `hr:read`; ownership,
   not `:write`, authorizes it. `hr:write` is the reviewer capability over
   *others'* records in the caller's data scope. The catalog description says so
   in words, since the generated labels will read "View HR" / "Edit HR".

2. **A calendar day is a calendar fact, stored as `YYYY-MM-DD`**, not an instant.
   PAC-159's rule (store the instant, bucket at read) is for when something
   *happened*; a holiday names a day the way `ProducerGoal.month` names a month,
   and does not move when the agency changes zone. The zone enters only at the
   boundary: "today", "which agency day does this instant fall on"
   (`businessDay`), and the Q4 job's "is it October yet" (`localClock`).

3. **Nothing inserts a holiday row without a person ticking it.** The migration
   and both provisioning paths create the calendar with its **workweek and
   country/region only**. Holiday rows come from the onboarding Calendar step,
   the settings "Import holidays for YEAR" dialog, or confirming a Q4 proposal.
   (Alternative considered: seed US `public` holidays for existing agencies in the
   migration. Rejected: date-holidays marks Columbus Day and Washington's Birthday
   `public` and most private employers are open; an unreviewed set over-counts
   closures and every requested-hours figure after it. Cheap to flip — see
   open question 1.)

4. **Two collections for the calendar.** `agencyCalendars` (one per agency:
   workweek, country, region, proposals) and `agencyCalendarDays` (one row per
   date). Rows are tiny but accrue forever (never deleted, PAC-155 rule), need a
   partial unique index on the active row per date, and PAC-169 queries them by
   range — none of which an embedded array does well.

5. **Working-day and policy services live in `common/`** (`common/working-days/`,
   `common/hr/`) so PAC-165's worker jobs can import them without crossing the
   lint boundary. The HTTP module `api/src/hr/` is the only feature directory; it
   goes into `FEATURE_DIRS` in `eslint.config.mjs`.

6. **`effectiveRules` takes the shape PAC-162 will store**, not an employee
   document: `{ leavePolicyId, overrides? }` plus `asOf`. In this ticket `asOf`
   is accepted and ignored (there is no assignment history yet); the merge is
   pure and unit-tested here so PAC-162 only adds the lookup.

7. **Recipients of a permission are resolved by one helper in `common/access/`**
   (`PermissionHoldersService`). The Q4 job needs "every `agency:hr:admin` holder
   in the agency"; PAC-165 needs "every `hr:write` holder in the employee's
   branch minus the submitter". Both read the same join collections the loader in
   `PermissionsService.loadAccessData` reads, and the worker may not import that
   service.

8. **One PR, base `dev`** (Asad, 2026-10-22). Part A below is everything under
   the UI (shared, migration, services, endpoints, worker job, notification
   type, Bruno, e2e); Part B is the web (settings page, onboarding phases,
   CLAUDE.md line). Build A first so the API can be exercised through Bruno
   before the pages exist, but ship both in the same PR.

9. **No `hrPolicies` collection** (Asad, 2026-10-22). The ticket's "one per
   agency, three slots" record would have held a copy of `leavePolicies.isDefault`
   (a denormalised fact nothing keeps in step — the AGENTS.md rule), a skip flag
   that already lives on `Agency.setup.hrPolicySkipped`, and two constant
   `reserved` placeholders. "HR Policy" stays a product concept: `GET /hr/policy`
   and the settings tab **assemble** it from the leave policies and the setup
   flag, and PAC-123 creates its own collections for compensation and the
   handbook when it arrives.

10. **No default policy, and no policy is ever seeded** (Asad, 2026-10-22). An
    agency may hold zero leave policies, and the app must work in that state:
    it simply does not use the feature. `leavePolicies` has no `isDefault`;
    nothing is preselected anywhere; a policy is chosen per employee during
    employee onboarding (PAC-162). **No policy → no leave requests and no
    employee onboarding records** — PAC-165 refuses a request for a profile
    without a policy, and PAC-162 creates no pending profiles for an agency with
    no active policy. The migration and both provisioning paths seed the
    **calendar only**. `DEFAULT_LEAVE_POLICY_RULES` survives as what a *new*
    policy is pre-filled with, not as a row. A policy **cannot be archived
    while any employee is on it**; archiving the last one is allowed.

## Code layout

```
shared/src/
  enums/module-key.enum.ts                  + ModuleKey.Hr = 'hr' (appended last → sortOrder 150/151)
  permissions/permission.constants.ts       + AgencyPermission.HrAdmin / HrExport (+ docblock)
  permissions/permission-catalog.ts         + PAGES row for Hr
  permissions/permission-catalog.definitions.ts + ADMIN_COPY for the two agency keys
  permissions/default-role-templates.ts     + grants (table above)
  permissions/permission-model.spec.ts      + 'hr permissions' describe block
  domain/agency-onboarding.ts               + Hr in ONBOARDING_DEFAULT_MODULES; AgencySetupView gains two flags
  domain/hr-calendar.ts                     calendar types, day kinds, WorkSchedule, views + inputs
  domain/hr-leave-policy.ts                 LeavePolicyRules, enums, DEFAULT_LEAVE_POLICY_RULES, views + inputs
  domain/hr-policy.ts                       HrPolicyView — assembled on read, never stored
  notifications/catalog.ts, render.ts, render.spec.ts  + 'hr.holidays_proposed'

api/src/
  common/working-days/
    working-days.ts                         pure core on CalendarDate + a CalendarSnapshot
    working-days.unit-spec.ts
    working-days.service.ts                 loads the snapshot, exposes the five methods
    holiday-suggestions.ts                  date-holidays wrapper (pure, cached per country/region)
    holiday-suggestions.unit-spec.ts
    working-days.module.ts
  common/hr/
    leave-policy.merge.ts                   mergeRules(template, overrides) — pure
    leave-policy.merge.unit-spec.ts
    leave-policy.service.ts                 effectiveRules(), snapshot()
    ensure-agency-calendar.ts               ensureAgencyCalendar(models, agencyId, hints) — used by both provisioning paths
    hr.common.module.ts
  common/access/permission-holders.service.ts  usersHolding(agencyId, permission, { branchId?, exceptUserId? })
  hr/
    schemas/agency-calendar.schema.ts       agencyCalendars
    schemas/agency-calendar-day.schema.ts   agencyCalendarDays
    schemas/leave-policy.schema.ts          leavePolicies
    dto/*.ts                                zod DTOs (+ unit specs for the tricky ones)
    agency-calendar.controller.ts / .service.ts
    leave-policies.controller.ts / .service.ts
    hr-policy.controller.ts / .service.ts
    hr.module.ts
  agency-setup/                             + calendarSkipped / hrPolicySkipped
  platform/agency-provisioning.service.ts   + ensureAgencyCalendar step with undo
  seed/provision-tenant.ts                  + ensureAgencyCalendar
  seed/demo/                                + demo closures/holidays for the demo agency (optional, small)
  inngest/events/hr.events.ts               (contract only — see §1.9)
  worker/functions/propose-next-year-holidays.fn.ts
  worker/worker.module.ts                   + the function, the three schemas, WorkingDaysModule
  migrations/<ts>-hr_module.js
  eslint.config.mjs                         + 'hr' in FEATURE_DIRS

web/src/
  lib/hr-api.ts
  features/hr/settings/HrSettingsPage.tsx   /settings/hr (tabs: Calendar · Leave policies · HR policy)
  features/hr/settings/calendar/*           YearGrid, WorkweekCard, CalendarDayDialog, HolidayImportDialog, ProposalBanner
  features/hr/settings/policies/*           LeavePolicyList, LeavePolicyEditor (+ sections), HrPolicySlots
  features/agency-setup/CalendarStep.tsx, HrPolicyStep.tsx, AgencySetupSteps.tsx (+2 steps)
  features/settings/settings-sections.ts    + HR entry (agency:hr:admin)
  app/App.tsx                               + /settings/hr route behind agency:hr:admin
  packages/web/CLAUDE.md                    + FullCalendar exception line

bruno/HR/*.bru                              every endpoint, with a Login as Manager
docs/SESSION-HANDOFF.md                     + §25 handoff
```

---

## Part A — module, calendar, policies, services, job (API-complete)

### 1.1 Shared — module key, permissions, templates

- `ModuleKey.Hr = 'hr'`, appended last, with the same "appended on purpose"
  docblock as `Analytics`; the `hr_module` migration copies the resulting
  `150`/`151`.
- `AgencyPermission.HrAdmin = 'agency:hr:admin'`, `HrExport = 'agency:hr:export'`,
  appended last. `adminDefinitions` gives them `1000 + index` — `1019`/`1020`
  with today's 19 entries; **copy the value `PERMISSION_CATALOG` actually yields**
  into the migration rather than trusting this number. Docblock: what each gates, the
  `agency:` namespace reasons (point at `ChangeLogsRead`), and the ⚠ that
  existing owners get them from the migration, not the template.
- `ADMIN_COPY` entries (the parity spec's "written copy" test fails without them):
  - *Administer HR* — "Edit leave policies and the agency calendar, confirm
    holidays, open HR onboardings and correct balances and points."
  - *Export HR data* — "Download HR datasets (requests, attendance, balances,
    points) through Data Export, with the same field restrictions as the screens."
- `PAGES` row: label **HR**, description "Your own time off, attendance and leave
  rules, and the agency calendar. Edit lets a reviewer decide requests and record
  or classify attendance events for their branch." (The read half is what every
  employee needs; say so.)
- `DEFAULT_ROLE_TEMPLATES`: Producer, CSR, CRM, Data Team `+ hr:read`; Branch
  Manager `+ hr:read, hr:write, agency:hr:admin, agency:hr:export`; Owner
  unchanged (template spread + `grantsAllEnabledModules`). Each with the standard
  "existing agencies get it from the `hr_module` migration" comment.
- `ONBOARDING_DEFAULT_MODULES` `+ ModuleKey.Hr` (a disabled module would filter
  every template's `hr:read` away and only a super admin can enable it).
- `web/features/platform/onboard/module-catalog.ts` is a `Record<ModuleKey, …>`,
  so the Super Admin wizard fails to compile until it gets an `[ModuleKey.Hr]`
  entry (label "HR", one-line description, pre-selected). Do it with the key so
  the web build never goes red mid-branch.
- `permission-model.spec.ts`: Branch Manager holds all four; Producer/CSR/CRM/
  Data Team hold exactly `hr:read`; Owner reaches `hr:*` through enabled modules
  and `agency:hr:*` through the admin spread; no template names a non-`read|write`
  `hr:` string.

### 1.2 Shared — domain types and defaults

`shared/domain/hr-calendar.ts`

```ts
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;                 // Sunday = 0, as Date#getUTCDay
export const DEFAULT_WORKWEEK: readonly Weekday[] = [1, 2, 3, 4, 5];
export type CalendarDayKind = 'holiday' | 'closure' | 'special_working_day';
export type CalendarDaySource = 'onboarding' | 'import' | 'manual' | 'proposal';
export interface AgencyCalendarDayView { id; date: string; kind; label; source; reason: string | null; createdAt; createdBy: { id; name } | null }
export interface AgencyCalendarView { workweek: Weekday[]; country: string | null; region: string | null; timeZone: string; days: AgencyCalendarDayView[]; workingDaysByMonth: Record<'YYYY-MM', number>; pendingProposal: HolidayProposalView | null }
export interface HolidaySuggestion { date: string; name: string; type: 'public' | 'bank' | 'school' | 'optional' | 'observance'; substitute: boolean; preChecked: boolean; alreadyInCalendar: boolean }
export interface HolidayProposalView { year: number; status: 'pending' | 'confirmed' | 'dismissed'; proposedAt; items: Omit<HolidaySuggestion, 'preChecked'>[] }
/** PAC-162 stores this on the profile; 161 only computes with it. */
export interface WorkSchedule { [weekday in Weekday]?: { start: 'HH:mm'; end: 'HH:mm' } | null }
export interface ScheduledDay { date: string; working: boolean; scheduledMinutes: number; reason: 'workweek' | 'weekend' | 'holiday' | 'closure' | 'special_working_day' | 'not_scheduled' }
```

Inputs: `UpdateAgencyCalendarInput { workweek?, country?, region? }`,
`AddCalendarDaysInput { source: 'import' | 'manual'; days: { date; kind; label; reason? }[] }`,
`RemoveCalendarDayInput { reason }`, `ConfirmHolidayProposalInput { dates: string[] }`.

`shared/domain/hr-leave-policy.ts` — the §2 table as a typed object, every value
a setting, SFA's defaults in `DEFAULT_LEAVE_POLICY_RULES`:

```ts
export interface LeavePolicyRules {
  leaveTypes: { key: string; label: string; drawsFromBalance: boolean; active: boolean }[];   // [Paid ✓ balance, Unpaid ✗]
  reasons: { timeOff: string[]; attendance: string[] };                                        // illness, emergency, transportation, family, weather, appointment, other
  requests: {
    partialDayIncrementMinutes: number;                                                        // 15
    coverageNote: 'off' | 'optional' | 'required';                                             // optional
    acknowledgmentText: string;
    validation: { overlap: ValidationMode; closure: ValidationMode; nonScheduledDay: ValidationMode; advanceNotice: ValidationMode; blackout: ValidationMode };  // all 'warn'
    advanceNoticeDays: number | null;                                                          // null (open with David)
    blackoutRanges: { from: string; to: string; label: string }[];                             // []
  };
  pto: {
    annualAllocationHours: number;                                                             // 80 (10 days) — SFA value to confirm
    resetBasis: 'calendar_year' | 'fiscal_year' | 'hire_anniversary';                          // calendar_year
    fiscalYearStart: 'MM-DD' | null;                                                           // null
    proration: 'none' | 'months' | 'days';                                                     // none
    carryover: { mode: 'off' | 'capped' | 'unlimited'; capHours: number | null; expiryDays: number | null };  // off
    negativeBalance: { mode: 'block' | 'floor' | 'allow'; floorHours: number | null };         // block
    reserveApprovedFutureLeave: boolean;                                                       // true
    employeeCancelCutoffHours: number;                                                         // 24
  };
  reminders: { reminderBusinessDays: number; escalationBusinessDays: number; upcomingLeaveLeadBusinessDays: number };  // 1, 2, 1
  attendance: { tardyGraceMinutes: number; eventTypes: ('call_in' | 'tardy' | 'leaving_early' | 'other')[] };  // 7, all four
  points: {
    enabled: boolean;                                                                          // true
    earningClassifications: ('unexcused' | 'no_call_no_show')[];                              // both
    ladders: { tardy: number[]; absence: number[] };                                           // [1,2,3,4] / [2,3,4] — last value repeats
    mapping: { noCallNoShow: 'absence'; leavingEarly: 'tardy' };
    sequences: 'separate' | 'combined';                                                        // separate
    resetBasis: 'work_anniversary' | 'calendar_year' | 'rolling_12_months';                    // work_anniversary
    thresholds: { points: number; recipients: RoutingRecipient[]; guidance: string }[];        // 5, 10
  };
  routing: Record<NotificationTrigger, RoutingRecipient[]>;                                    // §9 defaults
}
export type ValidationMode = 'off' | 'warn' | 'block';
export type RoutingRecipient = 'employee' | 'branch_reviewers' | 'hr_admins' | 'adjusting_admin';
export type NotificationTrigger = 'timeoff.submitted' | 'timeoff.changes_requested' | 'timeoff.approved' | 'timeoff.declined' | 'timeoff.cancelled_by_admin' | 'timeoff.overdue' | 'timeoff.upcoming' | 'attendance.submitted' | 'attendance.classified' | 'pto.adjusted' | 'points.threshold' | 'onboarding.pending' | 'calendar.holidays_proposed';
```

Plus `LeavePolicyView` (rules + `id`, `name`, `status: 'active' | 'archived'`, `updatedAt`, `version`, `employeeCount` — `0` until PAC-162), `UpsertLeavePolicyInput`, `EffectiveLeaveRules`
(`rules` + `{ policyId; policyName; policyVersion; overriddenPaths: string[] }`) and
`LeavePolicySnapshot` (what a posted record stores: `{ policyId; policyName;
policyVersion; takenAt; rules }`). A `version` integer on the policy, bumped on
every PATCH, is what makes "which rules was this record posted under" answerable
without diffing.

`shared/domain/hr-policy.ts`: `HrPolicyView { leaveAndAttendance: { status: 'configured' | 'skipped' | 'none'; activePolicyCount }; compensation: { status: 'reserved' }; employeeHandbook: { status: 'reserved' } }` — **assembled** by `HrPolicyService.view(agencyId)` from `Agency.setup.hrPolicySkipped` and `leavePolicies`; nothing is stored (decision 9).

### 1.3 Schemas (`api/src/hr/schemas/`)

All three are **agency-level** records: `agencyId: string` (indexed, same string
convention as `TenantRecord` so a raw query does not silently miss), no
`branchId`, plus `createdBy`/`updatedBy` declared so `authorshipPlugin` stamps
them (it keys on those paths existing). `@SkipBranch()` on every controller.

- `agencyCalendars` — `{ agencyId (unique), workweek: number[], country: string | null, region: string | null, proposals: [{ year, status, proposedAt, items: [{ date, name, type, substitute }], decidedAt, decidedBy }] }`. One doc per agency; `proposals` is bounded (one per year).
- `agencyCalendarDays` — `{ agencyId, date: 'YYYY-MM-DD', kind, label, source, reason: string | null, removedAt: Date | null, removedBy, removeReason, legacySmartSuiteId? }`. Indexes: `{ agencyId, date }` **unique partial** on `removedAt: null` (query it with `removedAt: null` spelled out — partial-index rule); `{ agencyId, removedAt, date }` for range reads. Removing is a soft remove with a required reason (never a delete).
- `leavePolicies` — `{ agencyId, name, status, version, rules: LeavePolicyRules (as a typed sub-schema, `strict`), archivedAt }`. Index: `{ agencyId, status, name }`. No default flag (decision 10); zero rows is a valid state.

New collections and indexes need no migration (`autoIndex`), except the seeded
docs for existing agencies (§1.8).

### 1.4 `common/working-days/` — the one working-day service

`working-days.ts` (pure, no Mongo, no zone):

```ts
export interface CalendarSnapshot { workweek: ReadonlySet<Weekday>; days: ReadonlyMap<string /*YYYY-MM-DD*/, CalendarDayKind> }
export function isWorkingDay(cal, date: CalendarDate): boolean            // special_working_day wins over weekend/holiday; holiday|closure lose to nothing
export function dayReason(cal, date): ScheduledDay['reason']
export function workingDaysInMonth(cal, year, month): number
export function workingDaysBetween(cal, from, to): number                 // inclusive [from, to]; 0 when to < from — documented, because business-days.ts's is half-open
export function addBusinessDays(cal, date, n): CalendarDate               // same stepping rule as business-days.ts
export function scheduledDaysBetween(cal, schedule: WorkSchedule, from, to): ScheduledDay[]   // one entry per calendar day; minutes 0 on non-working or unscheduled days
```

`working-days.service.ts` (Nest, `@Injectable`): `snapshot(agencyId, yearsHint?)`
reads `agencyCalendars` + active `agencyCalendarDays` (optionally bounded to a
year span) into a `CalendarSnapshot`, falling back to `DEFAULT_WORKWEEK` for an
agency with no doc yet (never throws — a fresh database must still work); the
five methods above bound to a snapshot; `todayFor(timeZone)` → `CalendarDate`
via `zonedDate`. Export `WorkingDaysModule` (Mongoose features for the two
calendar schemas).

Unit tests (`working-days.unit-spec.ts`), using `CalendarDate` fixtures:
- a Mon–Fri workweek: `workingDaysInMonth(2026, 11)` with Thanksgiving + the Friday as rows → 19;
- a holiday, a closure and a `special_working_day` on a Saturday each flip
  `isWorkingDay` the right way;
- `addBusinessDays` steps over a holiday and from a weekend start;
- the **DST boundary**: `workingDaysBetween` across 2026-03-07→2026-03-09 and
  2026-10-31→2026-11-02 counts the same as a plain week (the maths is on UTC
  anchors, so this pins that it stays so);
- `scheduledDaysBetween` with a partial schedule (Mon/Wed/Fri 09:00–13:00) over a
  week containing a Wednesday holiday → 2 working entries of 240 minutes, the
  Wednesday `reason: 'holiday'` with 0, Tuesday `not_scheduled`;
- a four-day workweek (Tue–Fri) agency.

**Not touched:** `common/dates/business-days.ts` keeps serving Manager-view
audit aging. Moving that onto the agency calendar is a follow-up (see end).

### 1.5 `common/working-days/holiday-suggestions.ts` — `date-holidays`

- Add `date-holidays` to `packages/api` (**API only** — ~several MB of rules and
  `moment-timezone`; the browser never sees it). ISC licence; ships its own
  `types/`. `import Holidays from 'date-holidays'` (`esModuleInterop` is on).
  Pin the version in the PR and record it in the handoff.
- `suggestHolidays({ country, region, year, timeZone })`: `new Holidays(country,
  region ?? undefined, undefined, { timezone: timeZone, types: ['public', 'bank',
  'school', 'optional', 'observance'] })` cached per `(country, region)`;
  `getHolidays(year)` → map each to `{ date: h.date.slice(0, 10), name, type,
  substitute: !!h.substitute, preChecked: type === 'public' }`. The `date` string
  is the holiday's own local calendar day, which is what we want; `start`/`end`
  are ignored. A multi-day rule contributes its start day only (documented).
  Substitute days ("Christmas Day (substitute day)") are kept and pre-checked
  with their type — they *are* the closure.
- `listCountries()` / `listRegions(country)` from `getCountries()` /
  `getStates(country)` for the pickers; `regionFromStateName(country, text)`
  maps a `Branch.address.state` ("Oklahoma", "OK", "ok") onto a date-holidays
  region code, or `null`.
- Unit spec: US 2026 contains `2026-07-03` (Independence Day substitute) and
  `2026-11-26` as `public`, `2026-02-14` as `observance` unchecked; `US`/`ok`
  adds nothing invalid; one non-US country (`CA`, `on`) returns Canada Day and
  Boxing Day; an unknown region throws a typed `UnknownHolidayRegionError` the
  controller maps to 400.

### 1.6 `common/hr/` — leave policies and defaults

- `leave-policy.merge.ts`: `mergeRules(template: LeavePolicyRules, overrides: DeepPartial<LeavePolicyRules> | null)` — deep merge **by path, arrays replaced whole** (an override of `leaveTypes` is the full list, never an element patch), returning `{ rules, overriddenPaths }`. Unit spec: scalar override, nested override, array replacement, empty/null overrides → `overriddenPaths: []`, unknown path ignored.
- `leave-policy.service.ts`: `effectiveRules({ leavePolicyId, overrides }, asOf)` → `EffectiveLeaveRules` (404 if the policy is archived or belongs to another agency); `snapshot(effective, takenAt)` → `LeavePolicySnapshot`; `hasActivePolicy(agencyId)` (the gate PAC-162 and PAC-165 ask before creating a profile or a request). No default lookup — there is none (decision 10). Every engine reads through this and only this.
- `ensure-agency-calendar.ts`: `ensureAgencyCalendar(models, agencyId, { country?, regionHint?: string })` — find-or-create the `agencyCalendars` doc (`DEFAULT_WORKWEEK`, `country ?? 'US'`, `region = regionFromStateName(country, regionHint)`). Idempotent; returns the id. Called from `provisionTenant` (after `seedAuditTemplates`) and from `AgencyProvisioningService` (new step with an undo that deletes the doc by `agencyId` **string**). It seeds **no policy**.

### 1.7 API module `api/src/hr/`

All controllers: `@RequireModule(ModuleKey.Hr)`, `@SkipBranch()`, `@UseGuards(PermissionsGuard)`. Zod DTOs in `dto/`, errors are `BadRequest`/`Conflict`/`NotFound` with form-ready messages.

| Method + path | Permission | Notes |
|---|---|---|
| `GET /hr/calendar?year=2026` | `hr:read` | `AgencyCalendarView` for the year (days in the year ± the surrounding ones a month grid shows, `workingDaysByMonth`, `pendingProposal`). Every employee: PAC-169's page reads this. |
| `PATCH /hr/calendar` | `agency:hr:admin` | `workweek` (1–7 distinct weekdays, non-empty), `country` (must be in `listCountries()`), `region` (must be in `listRegions(country)` or null). Changing country clears region. |
| `POST /hr/calendar/days` | `agency:hr:admin` | Bulk add; `source: 'manual'` requires `reason` on every row, `'import'` forbids it. Duplicate active date → **409** naming the date (nothing in the batch is written — validate all, then `insertMany`). Returns the created rows. **PAC-165 seam:** `AgencyCalendarService.addDays` is the one method that learns of a new non-working day; the "flag approved leave" hook goes there. |
| `DELETE /hr/calendar/days/:id` | `agency:hr:admin` | Body `{ reason }` (required). Soft remove; a removed row is a 404 on a second call. |
| `GET /hr/calendar/holiday-suggestions?country&region&year` | `agency:hr:admin` | Runs `date-holidays` on the API; marks `alreadyInCalendar`. 400 for an unknown country/region, year bounded to current−1…current+2. |
| `GET /hr/calendar/holiday-regions?country` | `agency:hr:admin` | Countries (no `country`) or regions for one. |
| `POST /hr/calendar/proposals/:year/confirm` | `agency:hr:admin` | Body `{ dates: string[] }` ⊆ the proposal's items; writes the chosen rows with `source: 'proposal'` (skipping dates already present), marks the proposal `confirmed`. `POST …/dismiss` marks it `dismissed`. Both idempotent on a decided proposal (200, no change). |
| `GET /hr/policy` | `agency:hr:admin` | The assembled `HrPolicyView` (decision 9); reads two collections, writes nothing. |
| `GET /hr/leave-policies` | `agency:hr:admin` | Active first, then archived. An empty list is normal (decision 10). |
| `POST /hr/leave-policies` | `agency:hr:admin` | `{ name, rules?: partial }` — missing sections fill from `DEFAULT_LEAVE_POLICY_RULES`; `version: 1`. Name unique per agency among active (409). |
| `GET /hr/leave-policies/:id` | `agency:hr:admin` | Full rules. |
| `PATCH /hr/leave-policies/:id` | `agency:hr:admin` | Partial rules (deep, arrays whole), `name`; bumps `version`. Validation: ladders non-empty positive integers; thresholds ascending unique `points`; `partialDayIncrementMinutes` ∈ {5,10,15,30,60}; at least one active leave type; every `eventTypes` entry known; `fiscalYearStart` required iff `resetBasis === 'fiscal_year'`; `floorHours` required iff `negativeBalance.mode === 'floor'`; carryover cap/expiry iff `capped`. |
| `POST /hr/leave-policies/:id/archive` | `agency:hr:admin` | 409 while any employee is on it ("Move N employees to another policy first"). The check runs through `LeavePoliciesService.employeesOn(policyId)`, which returns `0` in this ticket and reads `employeeProfiles` once PAC-162 exists — the seam is here, not in the controller. Archiving the last policy is allowed. |
| `POST /agency/setup/complete` (existing) | `agency:branding:write` | Body gains `calendarSkipped?`, `hrPolicySkipped?`; stored on `Agency.setup`; `AgencySetupView` echoes them. |

`agency-setup.service.ts` `complete()` records the two new flags; `toView`
defaults them to `false`. The two wizard phases write through the `/hr/*`
endpoints directly as the branding steps do — the owner holds `agency:hr:admin`
from the template, so no new setup permission.

DTO unit specs for `AddCalendarDaysInput` (reason rule, date shape, duplicate
dates inside one batch) and the leave-policy rule validators.

### 1.8 Migration `migrations/<ts>-hr_module.js`

Scaffold with `npm run db:migrate:create -- hr_module` **with `api:dev` stopped**
(a running watch server records the empty scaffold as applied). Copy of the
analytics migration's shape, extended; every key/label/number copied in, not
imported.

`up`:
1. **Catalog rows** — `hr:read` (150) / `hr:write` (151) as the module template writes them; `agency:hr:admin` / `agency:hr:export` (sort orders copied from `PERMISSION_CATALOG` at the time — 1019/1020 today) as the settings-grant migration writes agency rows (`kind: 'agency'`, `assignableToUser: false`, `group: 'Agency administration'`, with the `ADMIN_COPY` text).
2. **Entitlement** — `modules.hr = { enabled: true, enabledAt }` where the key is absent.
3. **Grants**, upserted on `{ roleId, permissionKey }` with `source: 'template'`:
   `branch_manager` ← all four; `agency_owner` ← the two `agency:hr:*`;
   `producer`, `csr`, `crm`, `data_team` ← `hr:read`. (A delta from the ticket's
   "grant Branch Manager": without `hr:read` on the employee templates no
   existing employee could open HR at all.)
4. **Calendar per existing agency** — for every `agencies` row with no
   `agencyCalendars` doc: insert it with `workweek: [1,2,3,4,5]`, `country: 'US'`,
   `region` from the default branch's `address.state` through a copied
   state-name→code table (null when unresolvable). **No holiday rows**
   (decision 3) and **no leave policy** (decision 10). Guarded by existence so
   a retry writes nothing twice.
5. Log counts for each part.

`down`: revoke the grants from those six role slugs (lossy for a hand-added
grant, as the precedent says), unentitle where no `enabledBy`, deprecate the four
catalog rows. **Leaves the seeded calendar/policy docs in place** and says so —
they are data, and the collections are unknown to older code.

Rehearse on a copy of the dev database (and the local prod dump), then
`npm run db:migrate:status`; confirm Onboard Agency still passes (`POST
/platform/agencies` e2e) — that is the PAC-149 failure mode this guards.

### 1.9 Worker — Q4 proposal job + notification type

- Shared catalog: `'hr.holidays_proposed': { category: 'attendance', defaultChannels: { email: true, push: false } }`; renderer → title "Next year's holidays are ready to confirm", body "{count} suggested holidays for {year} from {countryName}{, regionName}. Review and confirm them in HR settings.", `href: '/settings/hr?tab=calendar&proposal={year}'`; fixture in `render.spec.ts`.
- `common/access/permission-holders.service.ts`: `usersHolding(agencyId, permission, { branchId?, exceptUserId? }): Promise<ObjectId[]>` — active, non-platform users of the agency whose resolved set contains `permission`: roles via `userRoles`→`roles`(same agency)→`rolePermissions`, plus `userPermissions` grants minus revokes, plus `grantsAllEnabledModules` expansion for module keys (and `agency:*` only through rows). Reuses `resolvePermissionSet` per user over one aggregate. Unit-tested against an in-memory fixture; also covered by the worker e2e below.
- `worker/functions/propose-next-year-holidays.fn.ts` — id `propose-next-year-holidays`, `cron('0 6 * * *')` (daily, UTC), `concurrency 1`, `retries 0`, `handle(step, now)` lifted for tests. Per active agency (`forEachAgency`): read `timezone` + calendar; `localClock(now, tz)`; skip unless local month ≥ 10, calendar has a `country`, and no proposal for `year + 1` exists. **Claim first**: `updateOne({ _id, 'proposals.year': { $ne: nextYear } }, { $push: { proposals: { year, status: 'pending', proposedAt: now, items } } })`; `modifiedCount === 0` → someone else did. Then `usersHolding(agencyId, 'agency:hr:admin')` → if any, `inngest.send(notificationRequested, { type: 'hr.holidays_proposed', recipientIds, agencyId, actorId: null, entity: { kind: 'holidayProposal', id: `${agencyId}:${nextYear}` }, data: { year, count, countryName, regionName }, dedupeKey: `hr.holidays_proposed:${agencyId}:${nextYear}` })`. Idempotent by construction: one proposal per agency per year, one notification per proposal.
- Register in `worker.module.ts` (function, the three HR schemas, `WorkingDaysModule`, `PermissionHoldersService` + the three join schemas it reads).
- `test/worker/propose-next-year-holidays.e2e-spec.ts`: an agency in October with a US calendar gets one proposal and one `notification/requested.v1` to the owner (and not to the producer); a second tick writes nothing; an agency in September is skipped; an agency with `country: null` is skipped; a confirmed proposal for that year blocks a new one.
- `inngest/events/hr.events.ts`: **only a comment stub in this ticket** — the
  "closure added → flag approved leave" event belongs with its consumer
  (PAC-165); sending an event nothing consumes would leave rows for the
  event-log sweep to replay forever.

### 1.10 Tests, Bruno, lint

- `test/hr-settings.e2e-spec.ts`: 403s — producer on every admin endpoint, producer 200 on `GET /hr/calendar`; module off → 403 on all (the `ModuleGuard`); calendar CRUD, 409 on a duplicate active date, soft remove then re-add works, `workingDaysByMonth` reflects a closure; suggestions for US + `ok` and 400 for `US`/`zz`; proposal confirm writes only the chosen dates and is idempotent; policy create/patch bumps `version`, invalid ladder/threshold 400s, archiving the last policy succeeds and the list is then empty, `GET /hr/policy` reports `status: 'none'` with no policies; `GET /agency/setup` echoes the two flags after `complete`.
- Extend `test/agency-onboarding.e2e-spec.ts`: a panel-onboarded agency has a calendar and **no** leave policy; rollback removes the calendar.
- `seedTestData`: add a **Branch Manager** user (`test-manager@sfa.local`) so reviewer/admin cases do not have to use the owner — PAC-162/165 need one anyway.
- Bruno `bruno/HR/`: `Login as Manager` (captures `managerAccessToken`), then one request per endpoint above with real `docs` blocks (module, permission, params, response, errors); run `cd bruno && npx @usebruno/cli run --env Local` with the sandbox off.
- `eslint.config.mjs`: `'hr'` in `FEATURE_DIRS`. `npm run lint -w @sfa/api`, `npm run build -w @sfa/api` (lint does not type-check), `npm run build -w @sfa/shared` **before** e2e/Bruno.

---

## Part B — web: settings page, onboarding phases, CLAUDE.md

### 2.1 API client and queries — `web/lib/hr-api.ts`

`getAgencyCalendar(year)`, `updateAgencyCalendar`, `addCalendarDays`,
`removeCalendarDay`, `getHolidaySuggestions`, `getHolidayRegions`,
`confirmHolidayProposal`, `dismissHolidayProposal`, `getHrPolicy`,
`listLeavePolicies`, `getLeavePolicy`, `createLeavePolicy`, `updateLeavePolicy`,
`archiveLeavePolicy`; keys `hrKeys.calendar(year)`,
`hrKeys.policies`, `hrKeys.policy(id)`. Types from `@sfa/shared`.

### 2.2 `/settings/hr` — `features/hr/settings/HrSettingsPage.tsx`

`SettingsPage` (`width="wide"`, icon `CalendarDays`, caption "Calendar and leave
rules"), `?tab=calendar|policies|hr-policy` in the URL (shadcn `Tabs`). Entry in
`SETTINGS_SECTIONS` ("HR — Your working week, holidays and closures, and the
leave policies your team is on", `AgencyPermission.HrAdmin`); route in `App.tsx`
under `<RequirePermission permission="agency:hr:admin">`. Light + dark, tokens
only, `NOT_AVAILABLE` for a missing value, every clickable thing a `Button`.

**Calendar tab**
- `WorkweekCard` — seven toggle buttons (Mon first in display, stored as
  `Weekday`), country/region comboboxes (from `holiday-regions`), Save. Changing
  country clears region.
- `ProposalBanner` — when `pendingProposal` exists: "{n} holidays suggested for
  {year}" with **Confirm all**, **Review…** (opens the import dialog pre-filled
  from the proposal's items) and **Dismiss**. Deep-linked from the notification
  (`?proposal=YEAR` opens Review).
- `YearGrid` — year switcher; twelve mini month grids (hand-rolled, 7-column
  `grid`, not FullCalendar — the settings grid is a picker, the employee page is
  the calendar); each month header shows "{n} working days"; cells: non-working
  weekday muted, holiday `bg-primary/10`, closure `bg-destructive/10`, special
  working day `bg-success/10`, with a legend. Click a day → `CalendarDayDialog`:
  add (kind, label, **reason required**) or, on an existing row, remove with a
  reason; the dialog shows source and who added it.
- **Import holidays for {year}** → `HolidayImportDialog`: country/region/year,
  checkbox list grouped *Public* (checked) / *Other observances* (unchecked),
  rows already in the calendar disabled with "Already added", Import N → `POST
  /hr/calendar/days` with `source: 'import'`.

**Leave policies tab**
- `LeavePolicyList` — name, version, employees on it (0 until PAC-162),
  updated; New policy; row → editor. Archive (disabled while employees are on
  it, with the count as the tooltip). **Empty state** when the agency has none:
  "No leave policies yet. Until you add one, nobody can request time off and no
  employee onboarding is opened." with a New policy button — this is a
  legitimate state, not an error (decision 10).
- `LeavePolicyEditor` — `useAppForm` over a zod schema mirroring the API DTO
  (`validators: { onBlur }`), one `FormSection` per §2 area in the table's
  order: Leave types · Reasons · Requests · PTO · Reminders · Attendance ·
  Points · Routing. Array fields (leave types, reason lists, ladders,
  thresholds, blackout ranges) are seeded before mount and re-seeded by **remount
  on save** (the array-field `reset` trap in
  `docs/tanstack-form-spike-findings.md`). Conditional fields follow the DTO
  rules (fiscal-year start, floor hours, carryover cap). Routing is a matrix of
  trigger × recipient checkboxes. Save → PATCH; toast; the list refreshes.

**HR policy tab** — `HrPolicySlots`: three cards. Leave & Attendance shows the
active policy count (or "Not set up") and a link to the tab; Compensation and Employee Handbook render
"Reserved — coming with PAC-123" (muted, no action).

### 2.3 Onboarding — two new skippable phases

`AGENCY_SETUP_STEPS` gains, after `carriers` and before `finish`:
- `calendar` — "Your calendar": "The days your office is closed, so time off
  and attendance are counted on real working days." `CalendarStep` = the
  `WorkweekCard` controls (country/region pre-filled from the saved calendar,
  which provisioning derived from the branch address) + the suggestion checkbox
  list for the current and next year inline (public pre-checked) + an "Add a
  custom day" row. **Continue** saves the ticked rows (`source: 'onboarding'`)
  and the workweek; **Skip for now** saves nothing and sets `calendarSkipped`.
- `hr-policy` — "Your leave policies": "Add a leave policy if your team will
  request time off and report attendance here. You can add one per role, or one
  for everyone. Skip this and the app simply won't use that feature until you
  add one under Settings." `HrPolicyStep` starts **empty**: **Add a policy**
  opens the editor pre-filled from `DEFAULT_LEAVE_POLICY_RULES` with the name
  "Company policy" suggested; added policies list with Edit; **Skip for now**
  creates nothing and sets `hrPolicySkipped`. Either way the agency is in a
  working state — with no policy, HR is a calendar and nothing more
  (decision 10).

`completeAgencySetup({ skipped, calendarSkipped, hrPolicySkipped })`;
`InviteWizard` and `AgencySetupPage` pass the three flags. Step counters update
on their own ("Step 6 of 7"). `/welcome/agency` shows the same steps.

### 2.4 Nav, CLAUDE.md, verification

- No sidebar entry for HR yet — the employee-facing pages come with PAC-165/169;
  the settings hub card is the only UI entry in this ticket.
- `packages/web/CLAUDE.md`: add, under the "do not introduce a second component
  library" bullet, the explicit exception: *"**One exception, decided in PAC-148:
  the HR calendar page (PAC-169) uses FullCalendar v7 React with its shadcn
  theme — free standard plugins only (day grid, time grid, list, interaction),
  never the premium scheduler.** It renders inside our tokens and must stay
  light+dark clean. Do not remove it as a stray dependency, and do not reach for
  it anywhere else — the settings year grid is hand-rolled on purpose."*
- Verify in the browser pane at `localhost:5173` (Asad's dev servers): owner →
  `/settings/hr`, import US 2026 holidays, add a closure with a reason, remove
  it, see the empty policies state, create a policy, edit its increment and a
  ladder, create a second, archive the first; producer → the hub card is absent and `/settings/hr`
  redirects; a panel-onboarded owner walks the two new phases and skips one.
  Light + dark screenshots. `npm run lint -w @sfa/web`.

---

## Verification checklist (ticket "Done when")

- [ ] Migration on a dev DB with existing agencies: module on, four catalog rows, Branch Manager holds four, employees hold `hr:read`, owners hold `agency:hr:*`, every agency has a calendar and **no** leave policy, **Onboard Agency still passes**.
- [ ] Unit: working-day maths across a holiday, closure, special day and DST boundary; `scheduledDaysBetween` with a partial schedule; suggestions for US and one non-US country; merge rules.
- [ ] Onboarding phases skippable; settings page edits every §2 value; Bruno request for every endpoint, collection run green.
- [ ] Web CLAUDE.md carries the FullCalendar exception line.
- [ ] Worker: one proposal per agency per year, admins notified once.

## Open questions (assumptions built in; none blocking)

1. **Seed no holiday rows for existing agencies** (decision 3). If David would rather the migration pre-fill US public holidays for 2026–2027, it is one block in the migration — the import dialog is the same either way.
2. **`hr:write` reads "Edit HR" in the matrix.** The description explains it is the reviewer capability. If that confuses owners, the alternative is a dedicated label override in `moduleDefinitions` for this key — a small shared change, not a model change.
3. **PTO default `annualAllocationHours`.** The spec gives the mechanics, not SFA's number; 80 hours is the placeholder a new policy is pre-filled with until David confirms (editable per policy either way).
4. **Advance-notice days** default `null` (= off) per the epic's "blank until he says".
5. **Q4 means October 1 on the agency's calendar**, checked daily. If David wants a later month (November), it is one constant.
6. **Data Team holds `hr:read`.** Every template does, because every account is an employee. Say if a role should not.

## Follow-ups this ticket makes possible (not in scope)

- Move Manager-view audit aging (`common/dates/business-days.ts`, hard-coded US federal holidays) onto `WorkingDaysService` so "business days" means the agency's own calendar everywhere. Needs a decision on whether aging should change for agencies that observe fewer holidays.
- PAC-162: employee profiles reference `leavePolicyId` + `overrides`; `effectiveRules` gains the assignment-history lookup by `asOf`; `employeesOn(policyId)` reads `employeeProfiles` so the archive guard bites; **no pending profiles are created for an agency with no active policy** (`hasActivePolicy`), and the invite picker offers no preselection.
- PAC-165: a request for a profile with no policy is refused (`hasActivePolicy` / the profile's `leavePolicyId`); "the agency does not use leave" is a first-class state, not an error path.
- PAC-165: the "new closure flags approved leave" hook in `AgencyCalendarService.addDays`; the `hr/calendar.day-added.v1` event and its consumer; the first `notificationRequested` producers that resolve `hr:write` holders per branch through `PermissionHoldersService`.
- PAC-169: FullCalendar page reads `GET /hr/calendar`; CSV datasets gated on `agency:hr:export`.

## Known traps to carry into implementation

- `api:dev` applies a migration the moment the file exists — stop it before `db:migrate:create` and rehearse on a dump copy, never the shared dev DB.
- `agencyId` is a **string** on `TenantRecord`-style records and an **ObjectId** on `users`/`roles`/`branches`; the HR docs use the string form, so the provisioning undo and the migration must filter with the string (the audit-templates undo already carries this ⚠).
- Querying the partial unique index needs `removedAt: null` spelled out, or Mongo collection-scans.
- `.lean()` applies no schema defaults: a `.lean()` read of `Agency.setup` on an older agency has no `calendarSkipped`; `toView` must default it.
- `bulkWrite`/`insertMany` on the day rows: `insertMany` goes through the authorship plugin, `bulkWrite` does not — use `insertMany`, or spread `authorshipForInsert()`.
- The API lint autofixes and already fails on a clean tree (`api.e2e-spec.ts`); diff the error count, and use `build` to catch type errors.
- Build `@sfa/shared` before e2e and Bruno — they read `dist`.
- date-holidays returns `date` as `'YYYY-MM-DD HH:mm:ss'`; slice, never `new Date()` it (that would re-interpret the local string in the server zone).

---

## As built (22 Oct 2026) — where the build departed from the plan

| Topic | Plan | Built | Why |
|---|---|---|---|
| Region codes | lower-case (`ok`) | **upper-case** (`OK`, `IL`) | That is what `date-holidays` 3.37 keys `getStates()` by; the DTO upper-cases input. |
| Unknown country/region | package throws | package **does not throw** (quietly computes the national set, or nothing) | `isKnownCountry` / `isKnownRegion` guard every entry point; `UnknownHolidayRegionError` is ours. |
| Lint on `hasOwnProperty.call` | — | `Object.keys(...).includes` | `strictBindCallApply` is off, so `.call` returns `any` and the boundary lint refuses the return. |
| `PermissionHoldersService` module | registered ad hoc | its own `PermissionHoldersModule` (schemas only) | Imported by both `HrModule` (future) and `WorkerModule` without duplicating six `forFeature` rows. |
| `hr.events.ts` | comment stub | **not created** | A file with only a comment is noise; the event lands with its consumer in PAC-165. |
| Demo seed | optional closures | calendar only, region `IL` | Same rule as every path: no holiday row without a person. |
| Bruno | one folder | `HR/` 17 requests, all green; `Auth/Forgot Password (Public)` 500s locally, pre-existing | — |
