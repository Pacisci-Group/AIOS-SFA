# PAC-162 — Employee profiles + HR onboarding: implementation plan

Ticket: https://linear.app/paciscigroup/issue/PAC-162 (sub-story 2 of 5 under the
[PAC-148](https://linear.app/paciscigroup/issue/PAC-148) epic, story §3).
Blocked by PAC-161 (built, in review — PR off `dev` on
`asad/pac-161-hr-foundation`). Blocks PAC-165 (time off + ledger) and PAC-167
(attendance events). Related: PAC-90 / PAC-115 / PAC-117 (branches, roles),
PAC-123 (comp — a *separate* collection later; salary never lives here).

Paths relative to the AIOS-SFA repo root; `api/` = `packages/api/src`,
`web/` = `packages/web/src`, `shared/` = `packages/shared/src`.

## Context

PAC-161 built what every HR engine reads from: the `hr` module and its four
permissions, the agency calendar + `WorkingDaysService`, and `leavePolicies`
read through `LeavePolicyService` (template + overrides → `effectiveRules`,
snapshotted onto posted records). It deliberately left three seams for this
ticket: `LeavePoliciesService.employeesOn` returns `0`,
`LeavePolicyService.effectiveRules(asOf)` ignores `asOf`, and the invite flow
knows nothing about HR.

PAC-162 adds the **per-person record** those engines key on — `employeeProfiles`
— and the flow that creates it: the invite picker, the Onboardings list, the
template-plus-overrides editor with assignment history, schedule templates,
and the optional date of birth collected at the employee's own setup step.
No manager hierarchy, no salary, no requests (PAC-165), no events (PAC-167).

Decisions already made upstream (do not re-litigate): nothing per branch in
v1 (`User.branchId` is the routing fact); Branch Manager *is* the Office
Manager; no default leave policy, no seeded policy, zero policies is a valid
state (Asad, 2026-10-22); `hr:read` / `hr:write` are the module pair,
`agency:hr:admin` / `agency:hr:export` the admin pair; routing is branch-based
through `PermissionHoldersService`; a calendar day is a `YYYY-MM-DD` fact, a
business date is an instant (PAC-159); never hard-delete a record (PAC-155);
notifications go through `notification/requested.v1` and the worker is the
sole writer (PAC-154).

### What exists (verified on `asad/pac-161-hr-foundation`)

| Need | What is there today |
|---|---|
| Policy reader | `api/common/hr/leave-policy.service.ts` — `effectiveRules(agencyId, { leavePolicyId, overrides }, asOf)` (asOf ignored), `snapshot`, `hasActivePolicy`, `activeCount`. `leave-policy.merge.ts` merges by path, arrays whole, returns `overriddenPaths`. `leave-policy.validate.ts` checks the merged whole. |
| Policy CRUD + archive guard | `api/hr/leave-policies.service.ts` — `employeesOn(agencyId, policyId)` is the seam (returns 0); `archive` 409s on it; `toSummary` calls it with `''` for `employeeCount`. |
| Schedule maths | `shared/domain/hr-calendar.ts` already defines `WorkScheduleDay { start, end }` ("HH:mm") and `WorkSchedule = Partial<Record<Weekday, WorkScheduleDay \| null>>` "as PAC-162 will store it"; `api/common/working-days/working-days.ts` has `scheduledMinutes`, `scheduledDaysBetween(calendar, schedule, from, to)`, `parseClock`; `WorkingDaysService.scheduledDaysBetween` wraps it. |
| Recipient resolution | `api/common/access/permission-holders.service.ts` `usersHolding(agencyId, permission, { branchId?, exceptUserId? })` — active, non-platform users; its own `PermissionHoldersModule`. |
| Notifications | `shared/notifications/catalog.ts` (`hr.holidays_proposed` is the HR precedent, category `attendance`), `render.ts` (href must be an app path), `render.spec.ts` fails until a new type has a renderer. Producer pattern: `InngestService.send(notificationRequested, {...})` with a stable `dedupeKey` (`bug-reports.service.ts`, `propose-next-year-holidays.fn.ts`). |
| Invite flow | `UsersService.inviteUser` → `createPendingUser` (validate roles/branch, create inactive user, assign roles) → `issueInvite`. `AgencyProvisioningService` calls `createPendingUser` directly for the owner, inside an undo stack keyed on the email. `revokeInvite` hard-deletes the user row (pre-existing, documented exception). `InviteUserDto` is class-validator; `invite-schema.ts` + `InviteUserDialog.tsx` on the web, with a secondary-read pattern for the branch picker. |
| Employee setup step | `AuthService.acceptInvite(dto)` sets names + password, activates; `AcceptInviteDto` (class-validator) carries optional names; `web/features/agency-setup/InviteWizard.tsx` step 0 is the names form, step 1 the password, then the owner-only setup phases. `InvitePreview` is public — everything on it must pass the forwarded-link test. |
| Own profile | `api/profile/profile.controller.ts` (`/me/*`), `web/features/settings/ProfilePage.tsx` composed of `DetailCard`s; `AuthUser` blob in `api-client.ts`. |
| User lifecycle | `deactivateUser` (moves work, clears tokens, `invalidateUser`), `reactivateUser`, `revokeInvite`, `findPendingInvite`. `User.isActive` + `deactivatedAt` table on the schema. |
| Module toggle | `PlatformService.updateModuleEntitlements` — the one place a super admin enables `hr` on an existing agency. |
| Provisioning paths | `seed/provision-tenant.ts` (migration + demo seed), `AgencyProvisioningService` (panel), `hr_module` migration (d) — all call `ensureAgencyCalendar`; the pattern to copy for profiles. |
| Dates | `common/dates/business-date-rules.ts` (`assertNotInFuture`, `assertNotBefore`, `assertNotAfter`, judged as agency days), `agencyTodayIso(timeZone)`, `AccessContext.timeZone`. |
| Change log precedent | `api/activities/change-log.ts` — a declared `ChangeFieldSpec[]` + `ChangeSnapshot` diff, display-ready values, pure and unit-tested. |
| Web HR | `web/features/hr/settings/` (`HrSettingsPage` tabs: calendar · policies · hr-policy; `LeavePolicyEditor.tsx` + `leave-policy-form.ts` `toForm` / `fromForm` / `newPolicyForm`), `web/lib/hr-api.ts` (`hrKeys`), `nav-items.ts` sections (no HR section yet), `settings-sections.ts`. |
| Tests | `test/hr-settings.e2e-spec.ts` (owner / manager / producer tokens, `seedTestData` has `managerEmail` + `managerUserId`), `test/event-log.e2e-spec.ts` (how an emitted event is asserted: the `eventLog` collection), unit specs beside `common/hr/*`. Bruno `HR/` (seq 1–17), `Users/`, `Auth/`, `Profile/`. |
| Legacy | `docs/smartsuite-tables/The Users Table.md` has **no hire date and no date of birth** (it has `Employee Status` Active / Inactive / Terminated / Leave). Nothing to carry over; migrated users start `pending`. |

## Decisions

1. **One collection, `employeeProfiles`, one document per user per agency.**
   Agency-level like `agencyCalendars` (string `agencyId`, no `branchId` — the
   branch is resolved through the user, never copied), `userId` ObjectId,
   unique on `{ agencyId, userId }`. `createdBy` / `updatedBy` declared so the
   authorship plugin stamps them. Not a `TenantRecord` (that base requires a
   `branchId` the scope filter would act on).

2. **Status is `pending | active | terminated`, and the transitions are:**
   `pending → active` (activate), `active → terminated` (terminate),
   `terminated → active` (rehire: activate again with a new hire date, history
   kept), `pending → terminated` (the person was removed before being
   onboarded). A profile is never deleted except when its invite is revoked
   (decision 9).

3. **Current fields + an append-only `assignments[]` whose last entry always
   equals the current fields.** The profile carries the rules-shaped facts
   (`leavePolicyId`, `overrides`, `scheduleTemplateId`, `scheduleOverride`,
   `allocations`) as top-level fields because that is what the list filters,
   the archive guards and PAC-165's "what applies now" read; every change to
   any of them is one `updateOne` that `$set`s the fields and `$push`es a
   complete `EmployeeAssignment` entry `{ effectiveFrom, leavePolicyId,
   overrides, scheduleTemplateId, scheduleOverride, allocations, actorId,
   reason, recordedAt }`. "What rules applied on day X" is the last entry
   with `effectiveFrom <= X` (the first entry for anything earlier). One
   history, not one per fact: a schedule change and a policy change on
   different days are two entries, each a full picture, so a reader never
   has to merge two timelines. The ticket's `{ leavePolicyId, overrides,
   effectiveFrom, actor, reason }` is a subset of this.

4. **`effectiveFrom` is an agency day, never in the future, never before the
   hire date, and never before the previous entry's `effectiveFrom`** (equal
   is allowed: a same-day correction appends, and the as-of lookup takes the
   later one). No future-dated assignments in v1 — honouring them would need a
   job to flip "current", and nothing in PAC-165/167 needs it; a change that
   should start next Monday is entered next Monday.

5. **`effectiveRules(asOf)` resolves the *assignment* as of the day and the
   *policy* as it is now.** Policies are not versioned by date (PAC-161 chose
   a `version` counter + snapshots on posted records), so a posted record's
   snapshot is still the only true "rules then". `asOf` picks which policy /
   overrides / schedule / allocations the person was on; the policy's current
   rules are read for it. This is what PAC-161's `asOf` parameter was reserved
   for, and callers do not change.

6. **Schedule: a `workScheduleTemplates` collection, a per-employee override,
   and a workweek fallback so nothing has to exist.** A template is
   `{ agencyId, name, schedule: WorkSchedule, status, version }`, managed on a
   new **Schedules** tab of `/settings/hr`; nothing is seeded (same rule as
   policies). The profile stores `scheduleTemplateId | null` and
   `scheduleOverride: WorkSchedule | null`; the effective schedule is
   `scheduleOverride ?? template.schedule ?? scheduleFromWorkweek(calendar.workweek)`
   (09:00–17:00 on each workweek day — `DEFAULT_SCHEDULE_DAY`). An agency that
   never creates a template still gets correct requested-hours maths in
   PAC-165. Archiving a template 409s while any non-terminated profile
   references it, mirroring the policy guard.

7. **Allocations are a per-type map on the profile, absent = policy default.**
   `allocations: Record<leaveTypeKey, hours>` for balance-bearing types only;
   a missing key means `rules.pto.annualAllocationHours`. Validated against the
   *effective* rules' active `drawsFromBalance` types at write time. Not an
   override of the policy (the policy has one number, the person has one per
   type) and not a ledger row (PAC-165 posts `Annual Allocation` from it).

8. **"Custom" = template + overrides, computed by diff, and the server
   normalises.** The web reuses `LeavePolicyEditor` in an *overrides mode*:
   it renders the merged rules, and on save the client sends
   `diffRules(template, edited)` (new shared pure function, arrays whole, the
   inverse of `mergeRules`). The server merges, runs
   `validateLeavePolicyRules`, **and strips every override path whose value
   equals the template** before storing, so `overriddenPaths` is honest and
   "Custom" badges never lie. "A person whose rules match nobody gets a new
   named policy, never a clone" is a UI action, **Save as new policy**: it
   `POST`s the merged rules as a policy and assigns it with no overrides —
   nothing server-side prevents large override sets; the affordance is what
   steers people.

9. **Profiles are created at the one place users are created, and caught up
   everywhere else by one idempotent helper.** `UsersService.createPendingUser`
   creates the profile (both the invite dialog and the panel's owner invite
   go through it; the owner is an employee too). `EmployeeProfilesService.
   ensureProfilesForAgency(agencyId)` (pending profile for every
   non-deactivated, non-platform user without one) is called by: the
   `employee_profiles` migration (logic copied in, as every migration does),
   `PlatformService.updateModuleEntitlements` when `hr` flips to enabled,
   the SmartSuite migration after its Users step, the demo seed, and
   `reactivateUser` (a user removed before this ticket has no profile).
   `revokeInvite` deletes the profile with the user row — the invite was never
   a person and the row it would point at is gone; this is the same documented
   exception as the user delete, not a new one. **The module being disabled
   does not stop creation on invite** — the row is harmless, and the enable
   hook would only create the same row later.

10. **Invite with a policy → `active` with `hireDate` = the invite day unless
    given.** `InviteUserDto` gains `leavePolicyId?` (must be an active policy
    of the agency, else 400) and `hireDate?` (agency day, not in the future).
    Without a policy the profile is `pending`. The web shows the policy
    picker as a secondary read gated on `agency:hr:admin` (like the branch
    picker on `agency:branches:read`) — an owner who can invite but not
    administer HR invites without one, and the admins are told.

11. **`hr.onboarding_pending` is emitted on invite only, only while the agency
    has an active policy, and is routed branch-first.** Recipients:
    `hr:write` holders in the invitee's branch minus the inviter; if none (or
    the invitee has no branch), `agency:hr:admin` holders minus the inviter;
    if none, nobody. Gated on `hasActivePolicy`: an agency that does not use
    leave must not be told on every invite about an onboarding it cannot do.
    Bulk creation (migration, enable hook, seed) emits nothing — the
    Onboardings list and its counts are the catch-up surface. The policy's
    `routing['onboarding.pending']` row is **not consulted**: no policy
    applies to a person who has none yet, and with several policies there is
    no right one to ask. The row stays in the type (removing it is a shared +
    DTO + stored-document change) and its docblock says it is reserved.
    `dedupeKey` = `hr.onboarding_pending:<profileId>`; email on, push off
    (same reasoning as `hr.holidays_proposed`: a decision, not urgent).

12. **Date of birth lives on the profile, is set by the employee, and is read
    by the employee and `agency:hr:admin` only.** `dateOfBirth: YYYY-MM-DD |
    null`, `showBirthday: boolean` default `true`. `AcceptInviteDto` gains
    both (optional); `acceptInvite` writes them through
    `EmployeeProfilesService.setBirthday`, creating the profile if an older
    invite predates this ticket. The employee edits them later on their own
    profile page through `PATCH /hr/me/profile`; the admin through the
    employee edit. The list endpoint never returns the date; the admin detail
    returns the date, never an age; nothing anywhere computes an age. PAC-169
    reads month/day for opted-in employees through a helper left here
    (`birthdaysFor(agencyId)` — month/day only).

13. **Termination is a date plus an immediate status flip; the date may be in
    the future.** `terminationDate` ≥ `hireDate`; status becomes `terminated`
    when the admin records it, so the list is honest about who is leaving,
    and PAC-165 judges by the *date* ("no request may be dated after it"), not
    by the status alone — the person still works until that day. Removing a
    user from the agency (`deactivateUser`) terminates a non-terminated
    profile on the agency's today with reason "Removed from the agency";
    `reactivateUser` does not un-terminate — an HR admin rehires explicitly.

14. **Every edit is `agency:hr:admin` and audited with before/after in a
    separate `employeeProfileEvents` collection**, not an embedded array:
    `{ agencyId, profileId, userId, at, actorId, kind, changes: ActivityChange[],
    reason }` with `kind` ∈ `created · activated · facts_updated ·
    assignment_changed · terminated · rehired · birthday_updated`. The diff
    uses a declared `ChangeFieldSpec[]` exactly like `activities/change-log.ts`
    (display-ready values, policy and template ids resolved to names at write
    time, so the log reads in a year). `assignments[]` stays embedded because
    it is read on every `effectiveRules` call and is bounded by how often a
    person's rules change; events are read on one page.

15. **Reads: admin or self, nothing in between.** `hr:write` (reviewers) do
    not see profiles in this ticket — PAC-165's reviewer view reads the one
    thing it needs (balance, schedule) through the engine, not this surface.
    `GET /hr/me/profile` is `hr:read`; everything under `/hr/employees` and
    `/hr/schedule-templates` is `agency:hr:admin`; all `@SkipBranch`.

16. **One PR, stacked on `asad/pac-161-hr-foundation`, in two reviewable
    parts** (API-complete, then web), the way PAC-161 was built (Asad,
    2026-10-22, overriding the two-PR draft). Branch
    `asad/pac-162-employee-profiles` off the PAC-161 branch; the GitHub PR
    targets the PAC-161 branch until that merges, then is retargeted to `dev`.
    Nothing in this ticket needs PAC-161 to be merged first except the base.

## Part A — API

### A.1 Shared (`shared/src/domain/hr-employee-profile.ts`, new)

```ts
export const EMPLOYEE_PROFILE_STATUSES = ['pending', 'active', 'terminated'] as const;
export type EmployeeProfileStatus = (typeof EMPLOYEE_PROFILE_STATUSES)[number];

/** Hours per balance-bearing leave type; a missing key = the policy's annual allocation. */
export type LeaveAllocations = Record<string, number>;

export interface EmployeeAssignmentView {
  effectiveFrom: string;              // YYYY-MM-DD, agency day
  leavePolicyId: string; leavePolicyName: string;
  overrides: DeepPartial<LeavePolicyRules>;
  overriddenPaths: string[];
  scheduleTemplateId: string | null; scheduleTemplateName: string | null;
  scheduleOverride: WorkSchedule | null;
  allocations: LeaveAllocations;
  actor: CalendarActorView | null;    // reuse hr-calendar's actor shape
  reason: string | null;
  recordedAt: string;                 // ISO instant
}

export interface EmployeeProfileView {
  id: string; userId: string; status: EmployeeProfileStatus;
  user: { name: string | null; email: string; branchId: string | null; branchName: string | null; roleNames: string[]; accountStatus: 'active' | 'invited' | 'deactivated' };
  hireDate: string | null; workAnniversary: string | null;   // MM-DD
  terminationDate: string | null;
  dateOfBirth: string | null; showBirthday: boolean;         // admin + self only
  leavePolicy: { id: string; name: string; version: number } | null;
  overrides: DeepPartial<LeavePolicyRules>;
  effective: EffectiveLeaveRules | null;                     // null while pending
  schedule: { templateId: string | null; templateName: string | null; override: WorkSchedule | null; effective: WorkSchedule; source: 'override' | 'template' | 'workweek' };
  allocations: LeaveAllocations;
  effectiveAllocations: LeaveAllocations;                    // every balance-bearing type filled in
  assignments: EmployeeAssignmentView[];                     // newest first
  events: EmployeeProfileEventView[];                        // newest first, last 50
  createdAt: string; updatedAt: string;
}

export interface EmployeeListItem { /* id, userId, status, user{…}, hireDate, terminationDate, leavePolicy{id,name}|null, customRuleCount, scheduleTemplateName, pendingSince (createdAt) — no DOB */ }
export interface EmployeeListResponse { page; pageSize; total; totalPages; items: EmployeeListItem[]; counts: Record<EmployeeProfileStatus, number>; activePolicyCount: number }

export interface ActivateEmployeeInput { leavePolicyId: string; overrides?: DeepPartial<LeavePolicyRules>; scheduleTemplateId?: string | null; scheduleOverride?: WorkSchedule | null; allocations?: LeaveAllocations; hireDate: string; workAnniversary?: string | null; effectiveFrom?: string; reason?: string }
export interface SetEmployeeAssignmentInput { leavePolicyId: string; overrides?: …; scheduleTemplateId?: …; scheduleOverride?: …; allocations?: …; effectiveFrom?: string; reason: string }
export interface UpdateEmployeeFactsInput { hireDate?: string; workAnniversary?: string | null; dateOfBirth?: string | null; showBirthday?: boolean }
export interface TerminateEmployeeInput { terminationDate: string; reason: string }
export interface MyHrProfileView { status; hireDate; workAnniversary; terminationDate; dateOfBirth; showBirthday; leavePolicyName; effective: EffectiveLeaveRules | null; schedule: {…effective, source}; effectiveAllocations }
export interface UpdateMyHrProfileInput { dateOfBirth?: string | null; showBirthday?: boolean }

export interface WorkScheduleTemplateView { id; name; status: 'active' | 'archived'; version; schedule: WorkSchedule; employeeCount; createdAt; updatedAt; archivedAt }
export interface UpsertWorkScheduleTemplateInput { name?: string; schedule?: WorkSchedule }

export const DEFAULT_SCHEDULE_DAY: WorkScheduleDay = { start: '09:00', end: '17:00' };
export function scheduleFromWorkweek(workweek: readonly Weekday[]): WorkSchedule;
/** Inverse of the API's mergeRules: only the paths whose value differs, arrays whole. */
export function diffRules(template: LeavePolicyRules, edited: LeavePolicyRules): DeepPartial<LeavePolicyRules>;
export const EMPLOYEE_PROFILE_EVENT_KINDS = [...] as const;
export interface EmployeeProfileEventView { id; at; kind; actor; reason; changes: ActivityChange[] }
```

Plus: `shared/notifications/catalog.ts` gains `'hr.onboarding_pending'`
(`category: 'attendance'`, `{ email: true, push: false }`), `render.ts` the
renderer (title "`<name>` needs HR onboarding", body with branch and role,
`href: /hr/onboardings?user=<userId>`), `render.spec.ts` the case. Export
everything from `shared/src/index.ts`. `diffRules` gets a shared unit spec
that round-trips through a copy of the merge semantics (`mergeRules(t,
diffRules(t, e))` deep-equals `e` for arrays-whole patches).

### A.2 Schemas (`api/hr/schemas/`)

**`employee-profile.schema.ts`** — collection `employeeProfiles`:

| Field | Type | Notes |
|---|---|---|
| `agencyId` | string, required, indexed | string form like the calendar |
| `userId` | ObjectId ref User, required | unique with `agencyId` |
| `status` | enum, default `pending` | |
| `hireDate` | string \| null | `YYYY-MM-DD` |
| `workAnniversary` | string \| null | `MM-DD`; defaults to the hire date's month-day on activate |
| `terminationDate` | string \| null | |
| `dateOfBirth` | string \| null | |
| `showBirthday` | boolean, default true | |
| `leavePolicyId` | ObjectId ref LeavePolicy \| null | |
| `overrides` | `Object`, default `{}` | DTO-validated, stored as-is (same reasoning as `LeavePolicy.rules`) |
| `scheduleTemplateId` | ObjectId ref WorkScheduleTemplate \| null | |
| `scheduleOverride` | `Object` \| null | `WorkSchedule` |
| `allocations` | `Object`, default `{}` | |
| `assignments` | `[EmployeeAssignmentSchema]`, default `[]` | sub-schema, `_id: false`; `effectiveFrom`, the five rule-shaped fields, `actorId`, `reason`, `recordedAt` |
| `comp` | `Object`, default `null` | **reserved**: PAC-123 will store a reference to its own collection; a docblock says salary never lives here |
| `managerId` | ObjectId ref User \| null | reserved, unused in v1 (ticket) |
| `createdBy` / `updatedBy` | ObjectId \| null | |

Indexes: `{ agencyId, userId }` unique; `{ agencyId, status }`;
`{ agencyId, leavePolicyId }`; `{ agencyId, scheduleTemplateId }`.

**`work-schedule-template.schema.ts`** — collection `workScheduleTemplates`:
`agencyId` string, `name` (unique per agency among active, enforced in the
service like policies), `status`, `version`, `schedule` (`Object`),
`archivedAt`/`archivedBy`, authorship. Index `{ agencyId, status, name }`.

**`employee-profile-event.schema.ts`** — collection `employeeProfileEvents`:
`agencyId` string, `profileId`, `userId`, `at`, `actorId | null`, `kind`,
`changes: ActivityChange[]` (`Object[]`), `reason | null`. Index
`{ profileId, at: -1 }`.

### A.3 `api/common/hr/` (worker-importable)

- **`employee-profiles.service.ts`** (`EmployeeProfilesService`, registered in
  `HrCommonModule`, which gains the three schemas + `WorkingDaysModule`):
  - `ensureProfile(agencyId, userId, init?)` — find-or-create; `init` may
    carry `{ leavePolicyId, hireDate, actorId }` → creates `active` with the
    first assignment entry; otherwise `pending`. Returns `{ profile, created }`.
  - `ensureProfilesForAgency(agencyId)` — every user with `agencyId`,
    `isPlatformAdmin != true`, `deactivatedAt: null` and no profile → `pending`.
    Idempotent (existence-guarded insert, unique index as the backstop).
  - `profileFor(agencyId, userId)` — lean read or null.
  - `assignmentAsOf(profile, day)` — pure, exported, unit-tested: last entry
    with `effectiveFrom <= day`, else the first, else null (pending).
  - `effectiveRulesFor(agencyId, userId, asOf)` — profile → `assignmentAsOf`
    → `LeavePolicyService.effectiveRules(agencyId, assignment, asOf)`. 404
    `Employee profile not found`, 409 `… is not active` (pending) — PAC-165's
    "no policy, no requests" gate; a `terminated` profile *does* resolve
    (history must stay readable), the date rule is PAC-165's.
  - `effectiveScheduleFor(agencyId, userId, asOf)` → `{ schedule, source }`
    through `WorkingDaysService.settings(agencyId).workweek` for the fallback.
  - `effectiveAllocationsFor(rules, allocations)` — pure.
  - `setBirthday(agencyId, userId, { dateOfBirth, showBirthday }, actorId)` —
    ensures the profile, writes, records a `birthday_updated` event.
  - `terminateForRemoval(agencyId, userId, actorId, timeZone)` — used by
    `deactivateUser` (decision 13).
  - `deleteForRevokedInvite(agencyId, userId)` (decision 9).
  - `birthdaysFor(agencyId)` → `{ userId, monthDay }[]` for opted-in,
    non-terminated profiles — PAC-169's seam; nothing calls it yet.
  - `employeesOnPolicy(agencyId, policyId)` / `employeesOnScheduleTemplate` —
    counts of non-terminated profiles; `LeavePoliciesService.employeesOn`
    delegates here (the PAC-161 seam closes; `toSummary` passes the real
    `agencyId`).
- **`employee-profile.rules.ts`** — the date rules as agency days through
  `business-date-rules.ts` helpers: hire date not in the future; termination
  ≥ hire; `effectiveFrom` ≤ today, ≥ hire, ≥ previous entry; DOB < today and
  ≥ 120 years ago; `workAnniversary` a real `MM-DD`; a schedule override's
  days parse (`parseClock`) and `end > start`; allocation keys ⊆ the
  effective active balance-bearing leave types, `0 ≤ hours ≤ 8760`.
  Unit-tested.
- **`employee-profile.changes.ts`** — the `ChangeFieldSpec[]` for the event
  log (hire date, anniversary, termination, DOB shown as `set/cleared` never
  the value, show-birthday, policy name, custom-rule count, schedule template
  name, schedule override summary, allocations). Unit-tested like
  `change-log.unit-spec.ts`.

`LeavePolicyService.effectiveRules` is unchanged in signature; its `asOf`
docblock is updated to point at `EmployeeProfilesService.effectiveRulesFor`,
which is what the engines call from now on.

### A.4 HTTP (`api/hr/`)

All `@RequireModule(ModuleKey.Hr)`, `@SkipBranch()`, zod DTOs in `dto/`.
`overrides` reuses `leavePolicyRulesPatchSchema` from `dto/leave-policy.dto.ts`
so an unknown path is a 400, not something `mergeRules` silently ignores.

| Method + path | Permission | Notes |
|---|---|---|
| `GET /hr/employees?status[]&branchId&leavePolicyId&q&page&pageSize` | `agency:hr:admin` | Joined with `users` (name, email, branch, roles via `RoleAssignmentsService.rolesForUsers`) and resolved policy / template names. `q` matches name and email (reuse `USER_SEARCH_FIELDS` + `buildSearchFilter` on the user side, then filter profiles by `userId $in`). Response carries `counts` by status and `activePolicyCount`. Platform admins and deactivated users excluded from `pending`/`active` by construction (they have no profile / are terminated). The Onboardings page is this with `status=pending`. |
| `GET /hr/employees/:userId` | `agency:hr:admin` | `EmployeeProfileView`; `effective` null while pending. 404 for another agency's user. |
| `POST /hr/employees/:userId/activate` | `agency:hr:admin` | `pending → active` or `terminated → active` (rehire: clears `terminationDate`, kind `rehired`). Requires an active policy of the agency; template active or null; validates overrides (merge + validate + strip equal paths), schedule, allocations, dates. Writes the assignment entry (`effectiveFrom` default = hire date for a first activation, today for a rehire), `workAnniversary` default from the hire date, the event. 409 when already active. |
| `PUT /hr/employees/:userId/assignment` | `agency:hr:admin` | Active profiles only (409 otherwise). Same validation; appends; event `assignment_changed` with before/after on the display spec. `reason` required. |
| `PATCH /hr/employees/:userId` | `agency:hr:admin` | Facts only: hire date, anniversary, DOB, show-birthday. A hire-date change after activation re-validates `assignments[0].effectiveFrom ≥ hireDate` (400 naming it). Event `facts_updated`. |
| `POST /hr/employees/:userId/terminate` | `agency:hr:admin` | `{ terminationDate, reason }`; 409 if already terminated. Event `terminated`. Hook for PAC-165: nothing cancels requests here; PAC-165 decides what to do with approved leave past the date. |
| `GET /hr/me/profile` | `hr:read` | `MyHrProfileView`; 404 when the caller has no profile (a platform admin, or a pre-ticket user before the migration) — the web renders "not set up" on 404. |
| `PATCH /hr/me/profile` | `hr:read` | `{ dateOfBirth?, showBirthday? }` only; 400 on anything else. |
| `GET /hr/schedule-templates` | `agency:hr:admin` | Active first, then archived; `employeeCount` each. |
| `POST /hr/schedule-templates` | `agency:hr:admin` | `{ name, schedule? }` — `schedule` defaults to `scheduleFromWorkweek(calendar.workweek)`; name unique among active (409). |
| `GET /hr/schedule-templates/:id` · `PATCH …/:id` | `agency:hr:admin` | Patch bumps `version`. |
| `POST /hr/schedule-templates/:id/archive` | `agency:hr:admin` | 409 while any non-terminated profile references it. |
| `POST /users/invite` (existing) | `agency:users:write` | Body gains `leavePolicyId?`, `hireDate?` (class-validator: `@IsMongoId`, `@Matches(/^\d{4}-\d{2}-\d{2}$/)`). Service validates the policy is active in the agency (400 "Leave policy is invalid for this agency"), creates the profile through `createPendingUser`, emits the notification (decision 11) **after** the invite email is dispatched, in a try/catch that warns and never fails the invite (the bug-report pattern). |
| `POST /auth/accept-invite` (existing, public) | — | Body gains `dateOfBirth?`, `showBirthday?`. Written after the user is activated, before `issueTokens`. `InvitePreview` is **not** extended (nothing new passes the forwarded-link test). |

Controller file: `hr/employee-profiles.controller.ts` (`/hr/employees`,
`/hr/me/profile`), `hr/schedule-templates.controller.ts`. Services:
`hr/employee-profiles.service.ts` (HTTP shapes, joins, events) over the
common service; `hr/schedule-templates.service.ts`. `HrModule` registers them
and imports `PermissionHoldersModule` (not needed here — the notification is
sent from `UsersModule`, which gains `HrCommonModule` + `PermissionHoldersModule`
+ `InngestModule` imports; `AuthModule` gains `HrCommonModule`). No cycle:
`common/hr` imports nothing from `users/` or `auth/` except schemas.

### A.5 Hooks into existing flows

| Where | Change |
|---|---|
| `UsersService.createPendingUser` | After roles are assigned: `ensureProfile(agencyId, user._id, leavePolicyId ? { leavePolicyId, hireDate, actorId } : undefined)`. Returns the user as before. |
| `UsersService.inviteUser` | After `issueInvite`: if the profile is `pending` and `hasActivePolicy`, resolve recipients and `send(notificationRequested, …)`. Needs the branch name for `data` (one `Branch` read — the model is already injected). |
| `AgencyProvisioningService` | The email-keyed undo also deletes the owner's profile (string `agencyId` ⚠). |
| `UsersService.revokeInvite` / `deactivateUser` / `reactivateUser` | Decisions 9 and 13. The termination in `deactivateUser` happens **after** the work move and before `invalidateUser`, inside the same request; failure there must not strand a half-removed user, so it is best-effort with a logged warning (the user is removed either way; the admin can terminate by hand). |
| `AuthService.acceptInvite` | `setBirthday` when either field is present. |
| `PlatformService.updateModuleEntitlements` | When `modules.hr` goes from not-enabled to enabled: `ensureProfilesForAgency`. `PlatformModule` imports `HrCommonModule`. |
| `MigrationService.migrateUsers` (SmartSuite) | `ensureProfilesForAgency(agencyId)` at the end of the step, so a resumed `--from` run is covered. `MigrationModule` imports `HrCommonModule` (it already imports the calendar schema). |
| `DemoSeedService` | See A.7. |
| `LeavePoliciesService.employeesOn` / `toSummary` | Delegate to the common service with the real `agencyId`. The archive 409 now bites; the e2e that archives the last policy must terminate or not create profiles first. |

### A.6 Migration `migrations/<ts>-employee_profiles.js`

Scaffold with `npm run db:migrate:create -- employee_profiles` **with
`api:dev` stopped**. `up`: for every agency with `modules.hr.enabled`, every
`users` row with `agencyId: agency._id` (ObjectId ⚠), `isPlatformAdmin != true`,
`deactivatedAt: null` and no `employeeProfiles` row (`agencyId` **string**,
`userId`) → insert `{ agencyId: String(agency._id), userId, status: 'pending',
hireDate: null, workAnniversary: null, terminationDate: null, dateOfBirth:
null, showBirthday: true, leavePolicyId: null, overrides: {},
scheduleTemplateId: null, scheduleOverride: null, allocations: {},
assignments: [], comp: null, managerId: null, createdBy: null, updatedBy:
null, createdAt, updatedAt }`. Existence-guarded, so idempotent; logs
`[employee-profiles] N profile(s) created across M agencies`. `down`: removes
only rows that are still `pending` with empty `assignments` and no events —
data an admin has touched stays. No index work: `autoIndex` creates the new
collections' indexes on the next boot, and a fresh collection has no
duplicates to trip the unique index.

### A.7 Seeds and tests

- **Demo seed**: after `seedTeam`, create one leave policy **"Standard"**
  (`DEFAULT_LEAVE_POLICY_RULES`, upserted by name) and one schedule template
  **"Mon–Fri 9–5"**, then `ensureProfilesForAgency` and activate every team
  member except two (left `pending` so the Onboardings page demos) with hire
  dates spread over the last three years, one with a `scheduleOverride`
  (four-day week) and one with an override (`pto.annualAllocationHours: 120`).
  This departs from PAC-161's "demo seed: calendar only" line on purpose: a
  *policy* is not a holiday row (the no-human rule is about holidays), the
  demo seed is throwaway data (`seeds-not-backfills`), and without it nothing
  in HR demos. Open question 1 confirms it.
- **e2e `test/hr-employees.e2e-spec.ts`** (owner, manager, producer tokens;
  the policy and template created in `beforeAll`):
  - gating: producer 403 on `/hr/employees`, 200 on `/hr/me/profile` (404 until
    the suite creates their profile), manager admitted everywhere;
  - invite without a policy → `pending`, event-log row `notification/requested.v1`
    with `type: hr.onboarding_pending` whose recipients are exactly the
    branch's `hr:write` holders minus the inviter (assert by id, the
    `withheld branch arm by row` lesson), falls back to admins when the branch
    has none, and is **absent** when the agency has no active policy;
  - invite with a policy → `active`, one assignment, `hireDate` = agency
    today, no notification;
  - activate: validates policy/template/overrides/allocations/dates (400 each,
    naming the field), strips equal override paths, defaults the anniversary,
    writes the event with before/after;
  - assignment history: two entries on different days, `effectiveRulesFor`
    returns the right policy for a day between them, before the first, and
    after the last; an override change does not touch the earlier entry;
  - terminate: future date allowed, past-hire-date refused, status flips,
    `deactivateUser` terminates, `reactivateUser` leaves it, rehire clears;
  - archive guards: a policy / template with a profile on it 409s, after
    termination archives;
  - revoke invite deletes the profile; module enable backfills pending rows;
  - `GET /hr/me/profile` shows the employee their own rules and DOB,
    `PATCH` accepts only the two birthday fields;
  - accept-invite with DOB writes it; list never returns `dateOfBirth`.
- **Unit**: `assignmentAsOf`, `diffRules` (shared), `scheduleFromWorkweek`,
  the date rules, the change spec, the renderer case.
- **`test/helpers/seed-test-data.ts`**: unchanged (profiles are per-suite so
  `hr-settings` keeps archiving its last policy freely).
- **Bruno**: `HR/` seq 18+ — `List Employees`, `List Onboardings (pending)`,
  `Get Employee`, `Activate Employee`, `Activate Employee (No Policy, 400)`,
  `Set Assignment`, `Update Employee Facts`, `Terminate Employee`, `Get My HR
  Profile (as Producer)`, `Update My Birthday`, `Create / List / Update /
  Archive Schedule Template`, `Archive Leave Policy (In Use, 409)`; `Users/`
  — `Invite User (With Leave Policy)`; `Auth/` — `Accept Invite (Public)` with
  the two new fields (today there is no accept-invite request at all — add
  it with the dev-only `inviteToken` from `Invite User`). Every request with a
  real `docs` block; run the collection green against the local API.

## Part B — Web

### B.1 Routes, nav, API client

- `nav-items.ts`: a new **HR** section between *Data* and *Workspace* with
  `Onboardings` (`/hr/onboardings`, `permission: AgencyPermission.HrAdmin`,
  icon `UserRoundPlus`) and `Employees` (`/hr/employees`, same, icon
  `IdCard`). PAC-165 (My Time Off, `hr:read`) and PAC-169 (Calendar) add to
  this section later — leave a comment saying so.
- `App.tsx`: `RequirePermission permission="agency:hr:admin"` around
  `/hr/onboardings`, `/hr/employees`, `/hr/employees/:userId`. Lazy pages
  under `web/features/hr/employees/`.
- `lib/hr-api.ts`: `hrKeys.employees(filters)`, `employee(userId)`,
  `myProfile`, `scheduleTemplates`; functions for every endpoint above;
  `lib/users-api.ts` `InviteUserInput` gains `leavePolicyId?`, `hireDate?`;
  `lib/invite-api.ts` `acceptInvite` takes `{ dateOfBirth?, showBirthday? }`.

### B.2 Onboardings — `/hr/onboardings`

`OnboardingsPage.tsx`: the `GET /hr/employees?status=pending` list with the
counts strip (Pending · Active · Terminated), columns name / email / branch /
role / pending since; real-time search box; row → `/hr/employees/:userId`.
Reads `?user=<id>` from the notification deep link and opens that row.
Empty states: "Everyone is onboarded" vs, when `activePolicyCount === 0`, a
card "Create a leave policy before onboarding anyone" linking to
`/settings/hr?tab=policies` (the agency-without-leave state, said plainly).

### B.3 Employees — `/hr/employees`, `/hr/employees/:userId`

`EmployeesPage.tsx`: same table with status / branch / policy facets and
search, instant filtering (no Apply), paginated like the users directory.

`EmployeePage.tsx` (detail + edit; opened in *onboarding mode* when pending):
- Header: name, email, status badge, account status chip, hire / termination
  dates; actions **Activate** (pending), **Edit rules**, **Terminate**
  (active), **Rehire** (terminated).
- `EmploymentCard` — hire date, anniversary, termination; DOB + show-birthday
  (admin view, date only); edit dialog → `PATCH`.
- `RulesCard` — policy picker (active policies; empty → the create-policy
  CTA), then `LeavePolicyEditor` in **overrides mode**: `mode="overrides"`
  prop, initial form = `toForm(merged)`, every field whose path is in
  `overriddenPaths` gets a "Custom" badge and a *Reset to policy* control
  (sets the field back to the template value); the footer offers **Save
  custom rules** (sends `diffRules`) and **Save as new policy** (creates a
  policy named by the admin from the merged rules, then assigns it with no
  overrides). A one-line note under the picker says what Custom means.
  Effective-from date (default today, capped at today) + reason.
- `ScheduleCard` — template select (incl. "Agency workweek" = none) and a
  7-day grid of start/end inputs for the override, showing the effective
  schedule and its source; weekly hours total.
- `AllocationsCard` — one number per active balance-bearing leave type,
  placeholder = policy default, "Reset" clears the key.
- `AssignmentHistory` — timeline of `assignments` (newest first): policy,
  custom-rule count, template, allocations, actor, reason, effective-from.
- `ChangeLog` — the events with before/after rows (reuse the activity
  change-row rendering from Lead Detail if it is already a component;
  otherwise a small local one on `DataRow`).
- Terminate dialog: date (default today, min hire date) + reason.
  Activate flow for a pending profile = the Rules + Schedule + Allocations +
  hire date on one page with a single **Activate** submit (`POST …/activate`).

### B.4 Schedules tab — `/settings/hr?tab=schedules`

`HrSettingsPage` gains a fourth tab; `features/hr/settings/schedules/
SchedulesTab.tsx` (list + editor, the `PoliciesTab` shape) and
`ScheduleEditor.tsx` (the 7-day grid, shared with `ScheduleCard`).

### B.5 Invite dialog and the setup step

- `InviteUserDialog.tsx` / `invite-schema.ts`: a **Leave policy** select
  (secondary read, `enabled: open && allowed && can("agency:hr:admin")`,
  `retry: false`), default option "Set up later in HR → Onboardings"; when a
  policy is chosen a **Start date** field appears (default agency today via
  `agencyTodayYmd`, max today). Success toast says which it was.
- `InviteWizard.tsx` step 0: under the names, an optional **Date of birth**
  (max yesterday) and a **Show my birthday on the agency calendar** switch
  (default on) with one line of copy: month and day only, never the year.
  Passed to `acceptInvite`.

### B.6 Own profile

`ProfilePage.tsx` gains an `HrProfileCard` (reads `GET /hr/me/profile`;
hidden on 403 — the module is off or the user has no `hr:read` — and renders
"Your HR profile is not set up yet" on 404): hire date, anniversary, policy
name, a read-only **effective rules summary** (`EffectiveRulesSummary.tsx`
under `features/hr/components/` — the key numbers: leave types, allocation
per type, increment, notice, cancel cutoff; PAC-165's My Time Off reuses it),
the effective weekly schedule, and an editable **Birthday** block (DOB +
toggle → `PATCH /hr/me/profile`). Nothing here edits a rule.

### B.7 Done-when for the web

- Light + dark parity, tokens only, `NOT_AVAILABLE` for missing values, every
  clickable thing through `Button`, TanStack Form + zod via `useAppForm` for
  the three forms (employee facts, terminate, schedule template); the
  overrides editor keeps `leave-policy-form.ts` as its single schema.
- `npm run lint -w @sfa/web` clean; build clean.

## Build order

1. Shared types + `diffRules` + notification catalog/render (+ specs); build
   shared.
2. Schemas, `common/hr` service + rules + changes (+ unit specs), `HrCommonModule`.
3. HTTP controllers/services/DTOs; close the two PAC-161 seams.
4. Hooks: invite / accept-invite / removal / reactivate / revoke / module
   enable / provisioning undo / SmartSuite migration.
5. Migration file (rehearse on a dump copy, never the shared dev DB); demo seed.
6. e2e + Bruno; `npm run build -w @sfa/api` (lint does not typecheck).
7. Web: API client → Schedules tab → invite dialog + wizard → Onboardings →
   Employees list → Employee detail → own profile card → nav/routes.
8. Browser verification on `localhost:5173` (dev servers already running):
   invite without policy as owner → Onboardings shows them → manager
   notification arrives → activate with one custom rule → "Custom" badge →
   change log shows before/after → terminate → list facets; accept an invite
   with a DOB → profile card shows it.
9. `docs/SESSION-HANDOFF.md` §26, Linear comment with the decisions above,
   memory note.

## Done when (ticket ↔ plan)

- [ ] Invite with a policy → `active`; without → `pending`; the pending
      notification reaches the branch's `hr:write` holders (admins as the
      fallback) and only while a policy exists; activation records an
      assignment entry. (e2e)
- [ ] `effectiveRulesFor` returns template + overrides as of a day; an
      override change appends history and changes nothing earlier — proven
      here by the as-of e2e, and again in PAC-165 against posted records.
- [ ] A terminated profile carries the date PAC-165 blocks against; the
      removal hook terminates; rehire clears.
- [ ] `employeesOn` counts real profiles; the archive guard bites.
- [ ] Migration creates pending profiles for SFA's active users; enabling
      the module later does the same; the demo seed creates the demo team's
      profiles.
- [ ] DOB + toggle collected at the setup step, editable by the employee,
      visible to admins as a date, never an age, never in the list.
- [ ] Screens: Onboardings, Employees (+ detail with history), Schedules tab,
      own profile card; invite picker.
- [ ] Bruno requests for every endpoint, collection green; e2e green; API
      build + both lints clean.

## Open questions (assumptions built in; none blocking)

1. **Demo seed creates a "Standard" policy and a schedule template** so the
   HR screens demo (decision A.7). If Asad wants the demo tenant to stay
   policy-less like production, the seed leaves everyone `pending` and the
   Onboardings page demos its empty-state CTA instead — one block.
2. **Pending profiles exist even when the agency has no policy** (decision 9),
   with the notification suppressed (decision 11). The alternative in
   PAC-161's follow-up note — no pending profiles until a policy exists —
   makes "who is not onboarded" unanswerable for an agency that adds its
   first policy a month in. Say if the quieter behaviour is preferred.
3. **A termination date may be in the future and flips the status
   immediately** (decision 13). If David wants the status to stay `active`
   until the day, that is a daily job on the agency clock (the
   `set-users-away` pattern) — small, but a job.
4. **`routing['onboarding.pending']` is reserved, not consulted** (decision
   11). Removing it is a shared + DTO + stored-document change; cheap to do
   in PAC-165 if the row is still unused then.
5. **`hireDate` at invite** defaults to the invite day; the dialog exposes it
   only when a policy is picked. If the owner should set it for pending
   invites too, it is one more field.
6. **Reviewers (`hr:write`) see no profiles** (decision 15). PAC-165's
   reviewer view will show balance and schedule for a request's employee
   through its own endpoint; if David wants reviewers to open the full
   profile, that is a permission change on two routes.
7. **`workAnniversary` is editable** separately from the hire date (a
   migrated person's anniversary may predate their record). If one field is
   preferred, drop it and derive.

## Follow-ups this ticket makes possible (not in scope)

- **PAC-165**: `EmployeeProfilesService.effectiveRulesFor` / `effectiveScheduleFor`
  / `effectiveAllocationsFor` are the inputs to requested-hours and the
  allocation job; `terminationDate` is the ceiling on a request's dates;
  `status: 'pending'` → 409 "not onboarded"; `EffectiveRulesSummary` is the
  component My Time Off renders; the `onboarding.pending` routing row can be
  retired there.
- **PAC-167**: `workAnniversary` is the default points-cycle boundary;
  `effectiveScheduleFor` gives scheduled start/end for timing classification.
- **PAC-169**: `birthdaysFor(agencyId)` and `hireDate` for the calendar's
  birthday and anniversary layers; the HR admin hub reads `counts.pending`.
- **PAC-123**: `comp` is reserved on the profile as a *reference slot*; the
  comp collection and its permissions are that epic's.
- `managerId` stays unused until a reporting hierarchy is decided (PAC-117).

## Known traps to carry into implementation

- `agencyId` is a **string** on `employeeProfiles` / `workScheduleTemplates`
  / `employeeProfileEvents` (calendar convention) and an **ObjectId** on
  `users`, `roles`, `branches`. The migration, the provisioning undo and
  every join write both forms deliberately.
- `api:dev` applies a migration the moment the file exists — stop it before
  `db:migrate:create`; a watch-mode restart mid-migration leaves a stale
  `migrations_lock` for five minutes.
- Build `@sfa/shared` before e2e and Bruno (`dist`), and use
  `npm run build -w @sfa/api` to catch type errors — the API lint only
  lints, autofixes `api.e2e-spec.ts`, and already exits 1 on a clean tree
  (diff the error count).
- `mergeRules` ignores unknown override paths; the DTO must reject them
  (`leavePolicyRulesPatchSchema`) or a stale override vanishes silently.
- `structuredClone` + Jest's vm realm: compare plain objects by tag (the
  merge already does; `diffRules` must too).
- `.lean()` applies no defaults — `showBirthday` and `allocations` on a
  migration-written row are present because the migration writes them;
  `toView` still defaults them.
- `Model.bulkWrite` bypasses the authorship plugin; `ensureProfilesForAgency`
  uses `insertMany` (or spreads `authorshipForInsert()`), and migration /
  seed / enable-hook rows read `createdBy: null` = system.
- The e2e database is shared with any live `api:dev` on `sfa_test` — never
  run both; the sandbox blocks localhost ports for e2e/Bruno/curl.
- Never run anything against production; rehearse the migration on the
  local prod dump copy.
