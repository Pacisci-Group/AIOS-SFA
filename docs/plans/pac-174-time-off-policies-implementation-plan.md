# PAC-174 — Time Off Policy: implementation plan

Ticket: https://linear.app/paciscigroup/issue/PAC-174 — sub-story 2 of 5 under
the [PAC-148](https://linear.app/paciscigroup/issue/PAC-148) epic (story v2).
Scoped 2026-11-04 from `docs/plans/pac-174-gusto-time-off-policy-research.md`
(§13 is the scope; §1–§12 is what Gusto does). The ticket is the spec; its
"Decided 2026-11-04" table is closed and nothing below reopens it. Written
2026-11-04. Blocked by PAC-161 (PR #163, in review); blocks PAC-162 / PAC-165;
unblocks PAC-123 on the model side.

Paths are relative to the repo root; `api/` = `packages/api/src`,
`web/` = `packages/web/src`, `shared/` = `packages/shared/src`.

## 0. Where things stand

- **The branch to build on is `asad/pac-161-agency-holiday-calendar`** (13
  commits over `dev`, PR #163 against `dev`, in review). Everything HR lives
  there and nothing HR is on `dev`: `hr` module + permissions + the
  `hr_module` migration; `holidayPolicies` / `workWeekPolicies` on a shared
  `PolicyRecord` → `MemberListPolicyRecord` base (`api/hr/schemas/`);
  `HrPoliciesController` / `HrPoliciesService` (`/hr/policies`, every route
  `agency:hr:admin`, `@SkipBranch`); zod DTOs; `WorkingDaysModule`
  (`api/common/working-days/`) registering the two policy models;
  `web/features/hr/policies/` with the Gusto-style `PolicyWizardPage`
  (`PolicyStepBar`, `PeopleStep`, per-type `STEPS`), the HR policies page
  with three type cards (the `time_off` card already counts and filters, its
  create button says "Coming soon"); Bruno `HR/` (12 requests); e2e
  `api/test/hr-policies.e2e-spec.ts`; the demo seed enrols the team in
  "Paid holidays" and "Standard week".
- **`time_off` is a declared placeholder**: `HR_POLICY_TYPES` has it,
  `CREATABLE_POLICY_TYPES` does not; `HrPoliciesService.list` hard-codes its
  count to zero; `policy-display.ts` has its card meta with
  `createPath: null`; `summarizePolicy` falls through to the work-week branch
  for anything not `holiday`.
- **Nothing this ticket depends on exists yet**: no `leaveLedger`, no
  `employeeProfiles` / `hireDate` anywhere (api, shared, web), no HR Inngest
  function, no `WorkerModule` import of `WorkingDaysModule`. The migrated
  `timeOffRequests` collection (`api/time-off-requests/schemas/`) has a
  schema only — legacy string `status` / `type`, `producerId`, no policy link.
- **The wizard is `useState`, not TanStack Form.** `PolicyWizardPage` keeps a
  `Draft` object and hand-rolled `problemOn(step)` validation; only
  `CustomHolidayForm` uses `useAppForm`. The per-step TanStack pattern the
  request asks for already exists in
  `web/features/platform/onboard/OnboardAgencyPage.tsx` (`validateStep`,
  `stepHasErrors`, `ONBOARD_STEPS[].fields` path roots) and its
  `steps/ReviewStep.tsx` (`withForm`, one `FormSection` per step with an
  Edit action) — copy those, not the Sold wizard.
- **Two docblocks on the branch say the opposite of this plan** and are
  corrected by it: `policy-record.schema.ts` ("time off policies keep
  enrolment in its own collection … each enrolment carries a start date and
  starting balance") and the PAC-161 plan's v3 section ("`timeOffEnrollments`
  collection"). The ticket's decisions — move-on-enrol exactly as Holiday /
  Work week, one `Allocation` ledger row per person at activation, re-adding
  resumes the balance — make the embedded `memberIds` list the right shape
  (§2, decision 3).
- **Delete is the existing soft archive.** The ticket says `deletedAt`
  (PAC-155); the branch has `archivedAt` / `archivedBy` on `PolicyRecord`, a
  `POST …/archive` route and an Archive dialog, and PAC-155 has no convention
  yet. This plan keeps `archive` and does not mint a second soft-delete
  field (§2, decision 9; assumption §7.2).
- `docs/plans/pac-174-gusto-time-off-policy-research.md` is **untracked**;
  the first commit adds it with this plan.
- `gh` fails on a TLS error inside the sandbox; run it with the sandbox off.

## 1. What this ticket builds

| Piece | State |
|---|---|
| Shared vocabulary: `timeOffType` keys, compensation, accrual types / frequencies (offered + reserved), reset kinds, the rules + view + input types, type meta and the three suggested presets | **New** (`shared/domain/time-off-policy.ts`) |
| Pure maths: monthly twelfth, capped allocation, reset-due and reset rows, carryover; auto-approval and usage-waiting-period evaluators | **New** (`shared/domain/time-off-accrual.ts`, `time-off-rules.ts`) + specs |
| `timeOffPolicies` collection on `MemberListPolicyRecord` with the ticket's flat model (reserved fields stored null) | **New** schema |
| `leaveLedger` collection, append-only, with the kinds PAC-174 writes **and** the kinds PAC-165 will write (enum reserved), its indexes, and a `LeaveLedgerService` (post / post-once / balances) under `common/` | **New** — PAC-174 owns the collection (§2, decision 5) |
| `HrPoliciesService` third branch: create (allocation rows), update (locks, enrolment diff → allocation / removed rows), archive guard (Submitted requests), `people()` per `timeOffType`, `list` real count, views with balances | **Changed** |
| DTOs: `time_off` branch of the create union, `timeOff` on update, `startingBalanceHours`, reserved values refused | **Changed** |
| `TimeOffRequest.policyId` (optional link PAC-165 fills; the archive guard queries it) | **Changed** (additive) |
| Inngest `accrue-time-off`: monthly accrual on the 1st, yearly reset with carryover cap, hire-anniversary reset, agency time zone, idempotent | **New** (`api/worker/functions/`) |
| Web: type picker, five-step TanStack wizard inside `PolicyWizardPage`, Review with per-section Edit, activated policy page with inline drawers, Suggested policies strip, list summary, `PeopleStep` per time-off type, two new field components (`SwitchField`, `RadioGroupField`) | **New / changed** |
| Bruno `HR/` requests + README rows; demo-agency PTO + Sick policies with allocation rows | **New** |
| Migration | **None needed** (§2, decision 11) |

Not in this ticket: hire date and the People page (PAC-162); the request
flow, balance display to employees, `Used` / `Reversal` / `Manual adjustment`
rows and the available-vs-current maths (PAC-165); payments and the
per-pay-period schedule (PAC-123); time tracking and `hours_worked`
(PAC-167); notifications (PAC-127 inventory — activating a policy triggers
none); server-side wizard drafts; milestones; balance edits from a profile.

## 2. Decisions

Fixed by the ticket and **not re-litigated**: the type picker and five types
(+ Holidays routing to the Holiday policy); one policy per `timeOffType` per
person with move-on-enrol, Custom exempt; Fixed amount / Unlimited offered,
`hours_worked` / `per_pay_period` reserved and hidden; Yearly / Monthly
(full twelfth on the 1st, two decimals); reset on hire anniversary or a fixed
MM-DD (default 01-01); compensation and Unlimited locked after activation;
Unpaid Time Off fixed Unpaid, the rest default Paid; usage waiting period on
a nullable `hireDate`, negative balances with no floor, `payOutOnTermination`
stored only; max balance, carryover cap (0 = none), Sick-only annual usage
cap, no milestones; auto-approval per policy, off by default, two rules,
approves only; starting balance per person or bulk, default = yearly total
for Yearly else 0, mid-year joiners get the full total; no onboarding step,
no seeded policies for the migrated agency, client-side wizard state; soft
delete keeping history, blocked by Submitted requests; removal writes a
ledger row, re-adding resumes the balance; ledger append-only, balance
derived.

1. **One branch, one PR, stacked on PAC-161.** Branch
   `asad/pac-174-time-off-policies` off `asad/pac-161-agency-holiday-calendar`;
   PR opened with that branch as base; retargeted to `dev` when #163 merges
   (GitHub does it when the base branch is deleted, as #124 on #122 did).
   Merge-based stacking as PAC-154 settled on: a fix landing on #163 is
   merged *up* into this branch, never rebased under it. Commits in the
   order of §4, each green on its own.

2. **`CREATABLE_POLICY_TYPES` gains `time_off`, and the service's "one
   collection per type" shape absorbs it.** `store(type)` returns the third
   model, `activeRows` / `find` loop all three, `list` counts for real,
   `toSummary` grows a `time_off` branch. The shared unions
   (`HrPolicySummary`, `CreateHrPolicyInput`) grow a
   `{ type: 'time_off'; timeOff: TimeOffPolicyRules }` member; the DTO's
   `discriminatedUnion` a third literal.

3. **Enrolment is the embedded `memberIds` list; the starting balance is a
   ledger row.** `TimeOffPolicy extends MemberListPolicyRecord`, so
   `releaseFromOthers`, `assertMembers`, `people()`, `liveMembers`,
   `PeopleStep` and the `{ agencyId, memberIds }` index are reused as they
   are. The only difference from Holiday / Work week is the key of the
   one-per-person rule: `releaseFromOthers` for `time_off` adds
   `timeOffType: row.timeOffType` to its filter and **returns early for
   `custom`**. There is no enrolment start date to store: the `allocation`
   row's `effectiveAt` is when the person joined, and re-adding needs no
   row because the balance is the sum of what is already there. The
   `policy-record.schema.ts` docblock is corrected in the same commit.

4. **The stored model is the ticket's §4 table, flat, on the policy
   document** (PAC-123's engineer reads the ticket, so the names match):
   `timeOffType`, `description` (nullable), `compensation`, `accrualType`,
   `hoursPerYear`, `accrualFrequency`, `resetDateKind`
   (`hire_anniversary | fixed`), `resetMonthDay` (`MM-DD`, null unless
   fixed), `accrualRate` / `accrualRateUnit` (reserved, null),
   `maxBalanceHours`, `maxAccruedPerYearHours` (reserved, null),
   `carryoverCapHours`, `annualUsageCapHours`, `waitingPeriodDays`,
   `accrualWaitingPeriodDays` (reserved, null), `allowNegativeBalance`,
   `payOutOnTermination`, `autoApprove: { enabled, maxCalendarDays,
   minNoticeHours }`. Invariants, checked by the service (not zod — they
   need the stored row on PATCH): Unlimited nulls every accrual field and
   `payOutOnTermination` is false; `unpaid` type ⇒ `compensation: 'unpaid'`;
   `annualUsageCapHours` only on `sick`; `carryoverCapHours` null on
   `hire_anniversary` + `yearly`; `resetMonthDay` present iff `fixed`;
   `fixed_amount` requires `hoursPerYear > 0`; a reserved enum value
   (`hours_worked`, `per_pay_period`) is a **400 "not available yet"** at
   the DTO (`z.enum(OFFERED_…)`), while the shared enum and the Mongoose
   `enum` keep the full list so PAC-123 / PAC-167 add no migration to
   offer them. The ticket's "minimum notice (days or hours)" is stored as
   `minNoticeHours`; the UI offers days and converts.

5. **PAC-174 owns `leaveLedger`; PAC-165 only adds writers.** Schema
   `api/hr/schemas/leave-ledger.schema.ts`, collection `leaveLedger`, not a
   `TenantRecord` (no branch): `agencyId` (string), `policyId`
   (`ObjectIdType`, ref `TimeOffPolicy`), `userId` (`ObjectIdType`), `kind`
   ∈ `LEAVE_LEDGER_KINDS = allocation · used · reversal · manual_adjustment ·
   carryover · expiration · removed_from_policy`, `hours` (signed, two
   decimals), `effectiveAt` (an instant — agency-local midnight of the
   business day through `businessDateInstant`, PAC-159 rule), `periodKey`
   (string | null — the job's idempotency key, e.g. `accrual:2027-01`,
   `reset:2027-01-01`), `reason` (string | null), `source: { kind:
   'activation' | 'enrollment' | 'accrual' | 'reset' | 'request' | 'admin',
   id: ObjectId | null }`, `reversesId` (null; PAC-165's reversal link),
   `createdBy` / `updatedBy` (authorship; null from the worker = system).
   Indexes: `{ agencyId, policyId, userId, effectiveAt }` (balances and the
   per-person history), and **unique partial `{ policyId, userId, kind,
   periodKey }` with `partialFilterExpression: { periodKey: { $type:
   'string' } }`** — queried with `periodKey: { $type: 'string' }` where it
   must be hit (memory `partial-index-queries-need-type`). The job writes
   through `updateOne({ policyId, userId, kind, periodKey }, { $setOnInsert:
   row }, { upsert: true })`, which is what makes a re-run or a second
   replica a no-op. `LeaveLedgerService` (`api/common/time-off/`) exposes
   `post(rows)`, `postOnce(row)` and `balances(policyId, userIds) →
   Map<userId, hours>` (`$group` sum, rounded to two decimals). **What
   PAC-165 adds:** the `used` / `reversal` / `manual_adjustment` writers,
   `source.kind: 'request'` rows with a `requestId`, the reserved/pending
   ("available hours") maths and the per-period split helper. It must not
   redeclare the schema or the indexes.

6. **Activation = `POST /hr/policies`.** There is no draft state server-side
   (decided), so "locked after activation" means immutable after create:
   `update` 400s when `timeOff.compensation` or `timeOff.accrualType`
   differ from the stored row ("Paid / unpaid and Unlimited are locked once
   a policy is active. Delete it and create a new one."). On create, after
   `releaseFromOthers`, one `allocation` row per member, `source:
   { kind: 'activation', id: policyId }`, `effectiveAt` = today in the agency
   zone, hours = `startingBalanceHours[userId]` ?? default (yearly total for
   `yearly`, 0 otherwise, none at all for Unlimited). A 0-hour row is still
   written: it is the "added to policy" event the ticket's "one Allocation
   row per person" asks for, and PAC-162's profile reads it.

7. **Enrolment edits diff the list.** On `PATCH` with `memberIds`: added
   people get an `allocation` row (`source.kind: 'enrollment'`) only if they
   have **no ledger rows in this policy**; a re-added person gets nothing and
   their balance resumes (a `startingBalanceHours` entry for them is
   refused with a 400 naming the person — the UI never offers it, it shows
   "resumes at X h"). Removed people get a `removed_from_policy` row (0 h,
   `effectiveAt` today). The people moved out by `releaseFromOthers` get the
   same removal row in their old policy (the move is a removal there).
   Balances in the view come from `LeaveLedgerService.balances`;
   `PolicyMemberView` gains `balanceHours?: number | null` (null on
   Unlimited; absent on the other two types).

8. **`people()` reports the current policy per `timeOffType`.**
   `PolicyPersonView.policies` keeps its `holiday` / `work_week` entries and
   gains `timeOff: Partial<Record<TimeOffTypeKey, { id, name }>>`, with
   `custom` never listed (nobody moves out of a Custom policy).

9. **Delete is the existing `POST …/archive`**, now guarded: a `time_off`
   policy with any `timeOffRequests` row `{ agencyId, policyId: row._id,
   status: 'Submitted' }` is a **409** ("N requests are waiting for a
   decision. Decide them first."). `TimeOffRequest` gains an optional
   `policyId: ObjectIdType` so the query is typed; PAC-165 writes it and
   defines the status vocabulary — the guard matches the literal
   `'Submitted'`, which is also the migrated rows' value (they carry no
   `policyId`, so none ever matches). The UI keeps the Archive dialog and
   wording, with the ticket's consequences spelled out ("Balances and
   history are kept").

10. **One job, every agency, every half hour.** `AccrueTimeOffFn`
    (`api/worker/functions/accrue-time-off.fn.ts`, id `accrue-time-off`,
    `cron('*/30 * * * *')`, `concurrency 1`, `retries 0`, `handle(step, now)`
    public for tests) copies `set-users-away.fn.ts`: `forEachAgency`, the
    agency read with `.lean()` defaults (`timezone ?? DEFAULT_AGENCY_TIME_ZONE`),
    `today = agencyTodayIso(now, timeZone)`. Per active `fixed_amount`
    policy, per live member:
    - **Monthly accrual** when `today` is the 1st and `accrualFrequency ===
      'monthly'`: `allocation` of `cappedAllocation(twelfth, balance,
      maxBalanceHours)` with `periodKey: accrual:YYYY-MM`, `reason:
      'max_balance'` when it was clipped (still written at 0 h so the period
      is claimed).
    - **Reset** when `resetDueOn(policy, hireDate, today)`: `fixed` ⇒
      `resetMonthDay === MM-DD` of today; `hire_anniversary` ⇒ the person's
      hire date MM-DD (Feb 29 → Feb 28) matches and the hire year is
      earlier; `hireDate` null ⇒ never due (decided). Rows, all keyed
      `reset:YYYY-MM-DD`: `expiration` −balance and `carryover`
      +`min(balance, carryoverCapHours ?? balance)` (the period closes and
      reopens; the pair nets to the hours lost, zero when nothing is lost,
      and keeps "per period" sums honest for PAC-165); then, for
      `yearly`, `allocation` of `cappedAllocation(hoursPerYear, newBalance,
      maxBalanceHours)` keyed `accrual:YYYY-MM-DD`. A negative balance carries
      over negative (no floor; it accrues back toward zero, as Gusto).
    - Idempotent by construction (decision 5): no date marker on the agency
      is needed, and a tick the worker slept through is caught up by the
      next one *the same day* only — a whole missed day is a known gap,
      logged, not back-filled (the periodKey says which period is missing;
      an admin adjustment is PAC-165's tool).
    - `hireDate` comes through one seam, `hireDatesFor(agencyId, userIds)`
      in `api/common/time-off/hire-dates.ts`, which **returns null for
      everyone today** with a docblock telling PAC-162 to read
      `employeeProfiles.hireDate` there. The job, the service and the
      evaluators take `hireDate: string | null`.
    - Models the worker needs (`TimeOffPolicy`, `LeaveLedger`, `Agency`,
      `User`) are registered by a new `TimeOffModule`
      (`api/common/time-off/time-off.module.ts`, exporting
      `LeaveLedgerService`, `TimeOffAccrualService` and `MongooseModule`),
      imported by `HrModule` and `WorkerModule`; the ESLint worker boundary
      allows `common/` and schemas, never `hr/hr-policies.service.ts`.

11. **No migration.** Two brand-new collections and their indexes are
    `autoIndex`'s job (README: "You do not need one to add a brand-new
    collection or index"); `TimeOffRequest.policyId` is optional and
    unread by anything until PAC-165; the `time_off` count needs no data;
    the `hr_module` catalog text still describes the module. The one thing
    that *would* need one — changing an existing index's options — does
    not occur.

12. **Enforcement that belongs to the request flow is built here as pure
    evaluators, called by PAC-165.** `shared/domain/time-off-rules.ts`:
    `usageAllowedFrom(hireDate, waitingPeriodDays) → ISO date | null`,
    `exceedsAnnualUsageCap(policy, usedThisPeriod, requested)`,
    `evaluateAutoApproval(policy, { firstDay, lastDay, submittedAt,
    balanceAfter, recordedByManager }) → { approve: boolean; reason }`
    implementing the ticket's rules (calendar days first-through-last
    inclusive of weekends, minimum notice against the first day, never for
    manager-recorded time, never when it would go negative unless
    `allowNegativeBalance`). Unit-tested here; nothing in PAC-174 calls them
    at runtime.

13. **Web: the time-off wizard is TanStack Form, and lives inside
    `PolicyWizardPage`.** `PolicyWizardPage` keeps its routing role: at
    `/settings/hr-policies/new/time-off` it renders `TimeOffTypePicker`
    (no `?type=`) or `TimeOffWizard` (`?type=pto|sick|unpaid|bereavement|custom`,
    optional `&preset=1`); at `/settings/hr-policies/:policyId` it renders
    `TimeOffPolicyPage` when the loaded policy is `time_off`, the existing
    `Wizard` otherwise. The Holiday and Work week wizards are not migrated
    to TanStack in this ticket (out of scope; their `Draft` idiom stays).
    `TimeOffWizard` = `useAppForm({ defaultValues, validators: { onBlur:
    timeOffPolicySchema } })` with one zod schema
    (`features/hr/policies/time-off/time-off-form.ts`, `superRefine` for
    the cross-field invariants of decision 4 so the API and the form agree),
    `TIME_OFF_STEPS` as data with `fields` path roots, the
    `validateStep` / `stepHasErrors` / `submitAll` trio from
    `OnboardAgencyPage.tsx` (both spike traps: discard `validateField`'s
    return, never `validateAllFields`), `PolicyStepBar` + "Step X of 5",
    `WizardFooter`. The Accrual step is dropped from the step list while
    `accrualType === 'unlimited'` (the bar reads 4). Every field goes
    through `form.AppField` and a registered component with its path on
    `name`; two components are added to `components/form/fields/` and
    `useAppForm`: `SwitchField` (the Settings toggles, auto-approve) and
    `RadioGroupField` (compensation, accrual type, frequency, reset kind —
    `ChoiceRow`-style option rows with a caption). Enrolment: `memberIds:
    string[]` set through `form.setFieldValue` from `PeopleStep`, and
    `startingBalanceHours: Record<string, number>` rendered as a
    `NumberField` per ticked person (`name={`startingBalanceHours.${id}`}`)
    with "Edit all balances" writing one value into every key — an object
    keyed by id, not an array field (memory
    `tanstack-array-field-reset-trap`). Review: a `withForm` component,
    five `FormSection`s (Basic setup · Settings · Accrual · Enrollment ·
    Auto-approve requests) each with a ghost Edit → `goToStep`, the
    auto-approve fields editable inline on Review as Gusto has them, then
    **Activate**. The preset only changes `defaultValues`.

14. **The activated policy page is the Review layout with drawers.**
    `TimeOffPolicyPage`: `SettingsPage` (back to `?type=time_off`), the
    five sections read-only, each Edit opening a right `Sheet`
    (`components/ui/sheet`, the `ResolvePanel` idiom) hosting the same
    `withForm` step fragment on its own `useAppForm` seeded from the policy;
    Save sends only that section's fields via `updateHrPolicy(id, {
    timeOff: {…} })` or `{ memberIds, startingBalanceHours }`. Locked fields
    render disabled with the lock hint. The Enrollment section is a table
    (name · branch · balance · remove) + "Add people" opening `PeopleStep`
    in the sheet; a re-added person shows "resumes at X h" instead of a
    balance input. Archive stays in the ⋯ menu and the list page; the 409
    message is shown verbatim. Light + dark through tokens only; nothing
    hard-coded.

15. **Suggested policies strip** at the bottom of `HrPoliciesPage`, from
    `SUGGESTED_TIME_OFF_POLICIES` in shared (PTO · 80 h/yr yearly on Jan 1,
    Sick · 40 h/yr, Unpaid Time Off · unlimited): three small cards with
    "Add policy" → `/settings/hr-policies/new/time-off?type=…&preset=1`.
    Always shown (Gusto's behaviour); gated with
    `usePermissions().can(AgencyPermission.HrAdmin)` like the create
    buttons (the route gate already holds, the hook gate is the convention).
    `POLICY_TYPE_META.time_off.createPath` becomes
    `/settings/hr-policies/new/time-off`; "Coming soon" / "Soon" /
    "arrive in a later release" copy goes. `summarizePolicy` grows a branch:
    "80 h a year · all at once on Jan 1 · Paid", "40 h a year · 3.33 h on
    the 1st · Sick, 40 h usage cap", "Unlimited · Unpaid". `PeopleStep`
    takes `timeOffType?` and words the move line from
    `POLICY_TYPE_META[type].singular` + the type label.

16. **Demo seed, not the migration.** `demo-seed.service.ts#seedHrPolicies`
    adds "Paid time off" (pto, 80 h, yearly, Jan 1, carryover 40, max 120)
    and "Sick leave" (sick, 40 h, monthly, usage cap 40) for the demo
    agency, enrolling the team with allocation rows (`source.kind:
    'activation'`), keyed on `{ agencyId, name, archivedAt: null }` like the
    others. The migrated agency gets nothing (decided). Bruno's `HR/` folder
    stays self-contained and creates its own policies regardless.

## 3. Code layout

```
shared/src/domain/
  time-off-policy.ts            TIME_OFF_TYPE_KEYS (pto|sick|unpaid|bereavement|custom), TimeOffTypeKey,
                                TIME_OFF_TYPE_META (label, defaultName, defaultCompensation, compensationLocked),
                                COMPENSATIONS, ACCRUAL_TYPES + OFFERED_ACCRUAL_TYPES, ACCRUAL_FREQUENCIES +
                                OFFERED_ACCRUAL_FREQUENCIES, RESET_DATE_KINDS, WAITING_PERIOD_PRESETS,
                                TimeOffPolicyRules, SUGGESTED_TIME_OFF_POLICIES, DEFAULT_RESET_MONTH_DAY = '01-01'
                                (⚠ `time-off.ts` already exports a legacy `TimeOffType` — the SmartSuite label
                                vocabulary on migrated requests — hence the `…Key` names here)
  time-off-accrual.ts (+ .spec)  monthlyAccrualHours(hoursPerYear) → 2dp; cappedAllocation(hours, balance, max);
                                resetDueOn(policy, hireDate, today); anniversaryMonthDay(hireDate, year);
                                resetRows(balance, carryoverCap) → { expiration, carryover }
  time-off-rules.ts (+ .spec)    usageAllowedFrom, exceedsAnnualUsageCap, evaluateAutoApproval (decision 12)
  leave-ledger.ts                LEAVE_LEDGER_KINDS, LeaveLedgerKind, LEAVE_LEDGER_SOURCE_KINDS
  hr-policy.ts                   CREATABLE_POLICY_TYPES += time_off; HrPolicySummary / CreateHrPolicyInput gain the
                                time_off member; UpdateHrPolicyInput.timeOff?: Partial<TimeOffPolicyRules>,
                                startingBalanceHours?: Record<string, number>; PolicyMemberView.balanceHours?;
                                PolicyPersonView.policies.timeOff
shared/src/index.ts              export * for the new files

api/src/hr/schemas/
  time-off-policy.schema.ts      TimeOffPolicy extends MemberListPolicyRecord, collection timeOffPolicies, the flat
                                model (decision 4), enums from shared; indexes {agencyId, archivedAt}, {agencyId, memberIds}
  leave-ledger.schema.ts         LeaveLedger (decision 5) + the two indexes
  policy-record.schema.ts        docblock: enrolment is embedded on all three; balance lives in leaveLedger
api/src/common/time-off/
  time-off.module.ts             registers TimeOffPolicy, LeaveLedger (+ Agency, User for the sweep); exports services
  leave-ledger.service.ts        post, postOnce (upsert on periodKey), balances
  time-off-accrual.service.ts    sweepAgency(agencyId, now): the per-agency body of the job (decision 10)
  time-off-policy.validate.ts    the cross-field invariants of decision 4 (pure, unit-tested)
  hire-dates.ts                  hireDatesFor(agencyId, userIds) → all null; PAC-162 fills it
api/src/hr/
  hr-policies.service.ts         third store, time_off create/update/archive paths, balances in views, people().timeOff
  dto/hr-policy.dto.ts           time_off create branch, timeOff + startingBalanceHours on update, OFFERED_* enums
  hr.module.ts                   imports TimeOffModule
api/src/time-off-requests/schemas/time-off-request.schema.ts   + policyId?: ObjectIdType (ref TimeOffPolicy)
api/src/worker/
  functions/accrue-time-off.fn.ts   AccrueTimeOffFn — cron, forEachAgency → TimeOffAccrualService.sweepAgency
  worker.module.ts               + TimeOffModule, + AccrueTimeOffFn
api/src/seed/demo/demo-seed.service.ts / demo-seed.module.ts   + two time-off policies with allocation rows
api/test/
  hr-policies.e2e-spec.ts        + `time off policies` describe block (§5)
  worker/accrue-time-off.e2e-spec.ts   inlineStep harness, run twice

web/src/components/form/fields/SwitchField.tsx, RadioGroupField.tsx   + registered in hooks/form.ts
web/src/features/hr/policies/
  PolicyWizardPage.tsx           routes time-off to the picker / wizard / policy page (decision 13)
  PeopleStep.tsx                 timeOffType prop, type-aware move wording, policies.timeOff lookup
  HrPoliciesPage.tsx             SuggestedPoliciesStrip; copy
  policy-display.ts              time_off createPath + summarizePolicy branch + formatters (hours, reset date)
  time-off/
    time-off-form.ts             zod schema + TimeOffPolicyFormValues + defaults(typeKey, preset?) + fromPolicy()
    time-off-steps.ts            TIME_OFF_STEPS: id, label, fields roots; visible(values) for the Accrual step
    TimeOffTypePicker.tsx        six cards (five types + Holidays → /settings/hr-policies/new/holiday)
    TimeOffWizard.tsx            useAppForm, validateStep, step bodies, Activate
    steps/BasicSetupStep.tsx · SettingsStep.tsx · AccrualStep.tsx · EnrollmentStep.tsx · ReviewStep.tsx (withForm)
    TimeOffPolicyPage.tsx        activated view + Sheet drawers (decision 14)
    SuggestedPoliciesStrip.tsx
web/src/lib/hr-api.ts            types only (the six calls are unchanged)

bruno/HR/                        + Create Time Off Policy (PTO) · (Unlimited unpaid) · (Reserved accrual type, 400) ·
                                 (Unpaid type as paid, 400) · Update Time Off Policy (Enrol with balance) ·
                                 (Change compensation, 400) · Create Time Off Policy (Same type, moves) ·
                                 Archive Time Off Policy (×2, + Again 404) · List HR Policies tests counts.time_off;
                                 README rows
docs/plans/pac-174-time-off-policies-implementation-plan.md   this file; the research doc committed beside it
```

## 4. Build order (one PR, each a commit; gate before the next)

0. **Branch + docs.** `git switch -c asad/pac-174-time-off-policies` from
   `asad/pac-161-agency-holiday-calendar`; add this plan and the research
   doc. No code.
1. **Shared vocabulary + pure maths.** `time-off-policy.ts`, `leave-ledger.ts`,
   `time-off-accrual.ts`, `time-off-rules.ts` + specs; the `hr-policy.ts`
   union changes; `index.ts`. Gate: `npm test -w @sfa/shared`,
   `npm run build -w @sfa/shared` (the API and web typechecks read
   `shared/src`, but e2e / Bruno / seeds read `dist` — build before every
   later gate; memory `shared-build-before-e2e-and-bruno`).
2. **API model + service.** Schemas, `TimeOffModule`, `LeaveLedgerService`,
   `time-off-policy.validate.ts` (+ unit spec), the service's third branch,
   DTOs, `TimeOffRequest.policyId`, `HrModule`. Gate: `npm run build -w
   @sfa/api` (lint is eslint-only — memory `api-lint-does-not-typecheck`),
   `npm run test:unit -w @sfa/api`, `npm run test:e2e -w @sfa/api --
   hr-policies` (sandbox off, no live `api:dev` on `sfa_test`, nothing else
   running e2e — memories `sandbox-blocks-localhost-ports`,
   `e2e-runs-share-one-database`).
3. **Accrual job.** `TimeOffAccrualService.sweepAgency`, `AccrueTimeOffFn`,
   `hire-dates.ts`, `WorkerModule`. Gate: unit specs + `npm run test:e2e -w
   @sfa/api -- accrue-time-off`.
4. **Bruno + demo seed.** The requests of §3, README rows,
   `seedHrPolicies`. Gate: `npm run api:seed:demo:dev` then `cd bruno && npx
   @usebruno/cli run "HR" --env Local` against the running API on port 4000
   (sandbox off); the full collection afterwards, reading failures against
   the known negative / no-Resend / no-Inngest cases.
5. **Web: fields, picker, wizard, review.** `SwitchField`,
   `RadioGroupField`, the `time-off/` folder minus the policy page,
   `PolicyWizardPage` routing, `policy-display.ts`, `PeopleStep`. Gate:
   `npm run lint -w @sfa/web` (tsc) + build; browser walk on
   `localhost:5173` as the demo Branch Manager (memory
   `local-web-preview-host`): picker → PTO preset → the five steps →
   Review Edit jumps → Activate → list shows the row with its summary and
   `counts.time_off` ticks; Unlimited hides Accrual and the bar reads 4;
   the Unpaid card locks compensation; an invalid step blocks Continue
   with the error on the field; light + dark.
6. **Web: activated page, drawers, suggested strip.** `TimeOffPolicyPage`,
   `SuggestedPoliciesStrip`, `HrPoliciesPage`. Gate: open the seeded "Paid
   time off": each section's drawer saves only its fields; compensation
   and Unlimited disabled with the hint; enrol one more person with a
   balance → the table shows it; remove and re-add → "resumes at"; the
   409 on Archive after inserting a raw `timeOffRequests` row
   `{ policyId, status: 'Submitted' }` through mongosh; suggested cards
   pre-fill Step 1.
7. **As-built + PR.** Append the "As built" section here (plan vs built,
   verification runs, open-point defaults), open the PR against
   `asad/pac-161-agency-holiday-calendar` with the UI calls (§6) listed,
   bind it with the ccd_pr tools, comment the Linear ticket with the PR
   link. Do not touch `docs/SESSION-HANDOFF.md`.

## 5. Tests

**Unit (shared, `npm test -w @sfa/shared`)**
- `time-off-accrual.spec.ts`: 80 h → 6.67 h a month, 100 h → 8.33, two
  decimals, never negative; `cappedAllocation(6.67, 118, 120)` = 2, at the
  cap = 0, no cap = full; `resetDueOn`: fixed `01-01` on 2027-01-01 true /
  2027-01-02 false; anniversary 2024-02-29 due on 2027-02-28 and
  2028-02-29; hire date this year not due; null hire date never due;
  `resetRows(50, 40)` → expiration −50, carryover +40; cap null → +50; cap
  0 → +0; balance −10 → expiration +10, carryover −10.
- `time-off-rules.spec.ts`: `usageAllowedFrom(null, 30)` = null (not
  blocked), `('2027-01-15', 30)` = `2027-02-14`; `evaluateAutoApproval`:
  off → manual; 3 calendar days Fri–Sun against max 3 → approve, 4 → manual;
  notice 48 h required, submitted 47 h before → manual; balance after −1 →
  manual unless `allowNegativeBalance`; `recordedByManager` → never; both
  rules null while enabled → approve.

**Unit (api, `npm run test:unit -w @sfa/api`)**
- `time-off-policy.validate.unit-spec.ts`: the invariants of decision 4,
  one case each, including "unlimited nulls accrual fields" normalisation
  and the lock comparison on PATCH.
- `hr-policy.dto.unit-spec.ts`: `hours_worked` and `per_pay_period` are
  400 with the "not available yet" message; `resetMonthDay` format;
  `startingBalanceHours` values ≥ 0 with two decimals, keys are ObjectIds.

**e2e (`hr-policies.e2e-spec.ts`, new `time off policies` block)**
- Producer 403 on the new bodies (reuses the `it.each`).
- Create PTO (yearly, Jan 1, 80 h, two members, one explicit balance 20)
  → 201, `type: 'time_off'`, rules echoed, `members[].balanceHours` 20 and
  80 (the default), `counts.time_off: 1`; two `allocation` rows in
  `leaveLedger` with `source.kind: 'activation'`, `effectiveAt` = agency
  midnight today (read the Test Agency's zone).
- Create Unlimited → no rows, `balanceHours: null`, Accrual fields null.
- Create a second PTO policy enrolling one of the first's members → the
  person is in the new one only; the old policy has a `removed_from_policy`
  row for them; `people().timeOff.pto` names the new policy; a Custom
  policy enrolling the same person moves nobody.
- Create `unpaid` with `compensation: 'paid'` → 400; `sick` with
  `annualUsageCapHours` → 201, `pto` with it → 400; `hire_anniversary` +
  `yearly` + carryover → 400.
- PATCH compensation → 400 locked; PATCH `accrualType: 'unlimited'` → 400;
  PATCH `hoursPerYear: 96` + `carryoverCapHours: 0` → 200.
- PATCH `memberIds` removing one → `removed_from_policy` row; re-adding →
  no new `allocation` row, balance unchanged; re-adding with a
  `startingBalanceHours` entry → 400.
- Archive with a raw `timeOffRequests` row `{ agencyId, policyId, status:
  'Submitted' }` → 409; with it set to `'Approved'` → 204; the archived
  policy's rows remain.
- The document holds only its own fields (no `holidays`, no `days`) and
  `accrualRate` / `accrualWaitingPeriodDays` are null.

**e2e (worker, `accrue-time-off.e2e-spec.ts`)**: a monthly 120 h policy
with two members on `now` = 2027-03-01 02:00 in the agency zone (and 23:30
UTC the day before for a US zone, which is still 2027-02-28 locally →
nothing); run twice → one `accrual:2027-03` row per person, 10 h; a member
at 118 h with max 120 gets 2 h and `reason: 'max_balance'`; a yearly fixed
Jan 1 policy with balance 50, carryover cap 40 on 2027-01-01 → expiration
−50, carryover +40, allocation +80, balance 120; run again → unchanged;
`hire_anniversary` with the null-returning seam → no rows; an archived
policy → nothing.

**Browser (steps 5–6)** as listed in §4; the Bruno run in step 4.

## 6. UI calls to put to the owner in the PR (we own UI/UX)

- The Holidays card on the type picker leaves the time-off wizard for the
  Holiday policy wizard (decided), with a one-line caption saying why.
- The wizard's bar reads 4 steps on Unlimited rather than showing a greyed
  Accrual step.
- Minimum notice is entered in days (hours stored); hours are not offered.
- Auto-approve rules sit on Review, as Gusto puts them, not on Settings.
- Suggested policies are always shown, even when a policy of that type
  exists (Gusto's behaviour); the card says "You already have N" in that
  case.
- The activated page's Enrollment drawer shows a resumed balance read-only
  for a re-added person instead of a balance input.

## 7. Assumptions (the request asked for this list)

1. **Enrolment is the embedded `memberIds` list**, not the
   `timeOffEnrollments` collection the PAC-161 v3 note promised; the
   ticket's rules leave nothing for a separate row to hold (decision 3).
2. **"Delete" is the existing soft `archive`** (`archivedAt` / `archivedBy`,
   `POST …/archive`), not a new `deletedAt` — PAC-155 has no convention yet
   and two soft-delete fields on one base would be the defect PAC-155 is
   meant to end (decision 9).
3. **Reserved enum values are refused with a 400** at the DTO rather than
   stored, so a client cannot create a policy nothing can accrue (decision
   4).
4. **A re-added person's starting balance is refused**, not applied as an
   extra allocation; the balance resumes as decided (decision 7).
5. **The reset writes an expiration/carryover pair every time** (closing
   and reopening the period), not only when hours are lost; the net is the
   same and the period sums stay meaningful (decision 10).
6. **A whole missed day of the job is not back-filled**; the next day's
   tick posts the next period, and the gap is visible by `periodKey`.
7. **The demo agency gets two seeded time-off policies**; "no seeded
   policies" is read as the migrated agency only (decision 16).
8. **Minimum notice is stored in hours and entered in days** (ticket:
   "days or hours").
9. **`hireDate` is read through a null-returning seam** that PAC-162 fills;
   the job skips anniversary resets and the evaluators skip the waiting
   period for everyone until then (decided behaviour, assumed location).
10. **The Holiday and Work week wizards stay on their `useState` draft**;
    only the time-off steps are TanStack Form.
11. **`PolicyRecord` stays non-`TenantRecord`** (no `branchId`), as the
    branch chose for the other two types; `leaveLedger` follows it.
12. **No notification is sent** on activation, enrolment or accrual —
    PAC-127's inventory decides those, and nothing in the ticket asks.

## 8. Follow-ups this ticket leaves ready (not in scope)

- **PAC-162**: `hireDatesFor` to read `employeeProfiles.hireDate`; the
  profile's Time off section reads `LeaveLedgerService.balances` and the
  per-person rows; "Add to policy / Remove from policy" calls the same
  `PATCH memberIds`.
- **PAC-165**: `used` / `reversal` / `manual_adjustment` writers on
  `LeaveLedgerService`; `TimeOffRequest.policyId` + the status vocabulary
  the archive guard matches; `evaluateAutoApproval` / `usageAllowedFrom` /
  `exceedsAnnualUsageCap` at submit; available-hours maths over `balances`.
- **PAC-123**: reads `compensation`, `payOutOnTermination`,
  `accrualFrequency`; offers `per_pay_period` by moving it into
  `OFFERED_ACCRUAL_FREQUENCIES` and adding the pay-schedule accrual to
  `TimeOffAccrualService`.
- **PAC-167**: `hours_worked` the same way.
- Server-side wizard drafts, milestones — if admins ask.

## 9. Known traps (read before building)

- `lint -w @sfa/api` is eslint-only and autofixes `api.e2e-spec.ts`; use
  `build -w @sfa/api` for types and diff the finding count.
- Build `@sfa/shared` before e2e, Bruno and the demo seed — they read
  `dist`; a stale build looks like a code bug.
- e2e runs share `sfa_test`: no second run, no live `api:dev` on it; some
  suites clean up only in `afterAll`.
- `api:dev` applies migrations on boot — irrelevant here (none), but stop
  it before any `db:migrate:create` if one turns out to be needed.
- The sandbox blocks localhost ports and `npm install`; e2e, Bruno and
  curl need it off.
- `.lean()` applies no schema defaults: default `autoApprove`,
  `allowNegativeBalance`, `payOutOnTermination` in the mapper, and
  `agency.timezone` in the job.
- `User.agencyId` is an ObjectId; policy and ledger `agencyId` are strings.
- The partial unique index on `periodKey` is only used when the query says
  `periodKey: { $type: 'string' }`.
- `authorshipPlugin` does not cover `bulkWrite`; the ledger writes through
  `updateOne` upserts and `insertMany`, both covered.
- `validateField`'s return is unreliable on a mounted field; read
  `getFieldMeta().errors`. `validateAllFields` skips unmounted steps; use
  `form.validate('submit')` for Activate.
- TanStack array fields ignore `form.reset`; the balances are an object
  keyed by user id, and the drawer forms remount by `key`.
- `gh` needs the sandbox off (TLS); `git` chained commands too.
