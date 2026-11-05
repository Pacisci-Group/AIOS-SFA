# PAC-165 — Time off requests and leave: implementation plan

Ticket: https://linear.app/paciscigroup/issue/PAC-165 — sub-story 4 of 5 under
the [PAC-148](https://linear.app/paciscigroup/issue/PAC-148) epic. The ticket
(rewritten 2026-11-05, no comments) is the scope; research and decision log:
`docs/plans/pac-165-gusto-time-off-request-research.md` (§10–§11). Written
2026-11-05. Blocked by PAC-174 (#166) and PAC-162 (#168); blocks PAC-167 and
PAC-169.

> **Approved by Asad 2026-11-05.** The Linear ticket is not edited without a
> separate go-ahead (§8 lists what it should say).

Paths are relative to the repo root; `api/` = `packages/api/src`,
`web/` = `packages/web/src`, `shared/` = `packages/shared/src`.

## Context

PAC-174 built time off policies, the append-only `leaveLedger` and the accrual
job; PAC-162 built the People page and the profile that shows a balance.
Nothing yet lets a person *use* the hours: there is no request service,
controller or page, the ledger has no `used` / `reversal` /
`manual_adjustment` writer, and `LeaveLedgerService.balances` sums every row
with no date. PAC-165 adds the Time off page (employee cards and requests,
team review, record-for-someone-else), the request lifecycle, the three
ledger writers and the balance numbers, with Gusto's screens over our
lifecycle.

## 0. Where things stand

- **Build on `asad/pac-162-people-page`** (PR #168 → #166 → #163 → `dev`).
  Everything HR lives on that stack. The PAC-154 notification system is
  already underneath it (all four PRs are ancestors of `dev`).
- **`api/time-off-requests/` holds a schema and nothing else.** `TimeOffRequest
  extends TenantRecord` with legacy fields only: `title`, `startDate`,
  `endDate` (Dates), `requestType`, `hoursRequested`, `status`, `type`,
  `decision` (free strings), `producerId`, `legacyProducerId`, and the
  `policyId` PAC-174 added. Registered in `HrModule`, `MigrationModule`,
  `DemoSeedModule`. Three writers/readers exist: the SmartSuite import
  (`migration.service.ts#migrateTimeOffRequests`), the demo seed
  (`seedTimeOffRequests`, which writes `'Pending'` and swaps `type` /
  `requestType`), and the archive guard (`hr-policies.service.ts:431`,
  literal `'Submitted'`).
- **Local data** (`sfa` database, read 2026-11-05): 36 rows — 30 migrated,
  **all `Submitted`**, dated Feb–Aug 2026 at UTC midnight, no decision, 7
  with an empty type, junk 5-hex titles; 6 demo rows with time-of-day
  instants. Indexes present: `status_1`, `producerId_1`, the legacy dedupe.
- **Ledger** (`api/common/time-off/leave-ledger.service.ts`): `post`,
  `postOnce`, `balances(policyId, userIds)`, `enrolledBefore`. No session
  parameter, no as-of date, no `agencyId` in the `$match` (so the
  `{agencyId, policyId, userId, effectiveAt}` index is unused). `reason` is
  an enum of the job's two values; there is **no free-text field** for a
  manual adjustment's reason. Three callers of `balances`: the accrual job
  (`time-off-accrual.service.ts:128`), the profile
  (`users.service.ts:474`), policy members (`hr-policies.service.ts:515`).
- **Rules built by PAC-174 and unused until now**
  (`shared/domain/time-off-rules.ts`): `usageAllowedFrom`,
  `exceedsAnnualUsageCap`, `evaluateAutoApproval`. Accrual maths the job
  uses (`time-off-accrual.ts`): `monthlyAccrualDue`, `resetDueOn`,
  `resetRows`, `cappedAllocation`, `monthlyAccrualHours`,
  `anniversaryMonthDay`.
- **Hours**: `WorkingDaysService.forPerson(agencyId, userId, {from,to})` →
  `PersonCalendar`; `scheduledDaysBetween(snapshot, schedule, from, to)` →
  `ScheduledDay[]` (`date`, `scheduledMinutes`, `reason: scheduled | weekend
  | holiday | closure | not_scheduled`). It reads the person's **current**
  policies.
- **Scope**: `buildScopeFilter` (`api/common/access/scope-filter.ts`) takes
  no permission and skips the branch clamp when the branch is null; there is
  no helper for "people in my scope". CRM (branch) and Data Team (agency)
  hold `hr:read` only. `User.branchId` is an ObjectId, `access.branchId` a
  string; an owner has no branch.
- **Other pieces to reuse**: `SequenceService.next(key, session)` (atomic
  counters, the `HH-` pattern in `households/household-ref.ts`);
  `TransactionRunner.run` (replica set everywhere, sessions, callback may
  re-run); `agencyTodayIso`, `businessDateInstant`; `@RequirePermissions(a,
  b)` is an AND; `createTestApp()` installs `CapturedInngestService`.
- **Notifications**: a type is one row in `shared/notifications/catalog.ts`
  plus one renderer in `render.ts` plus a fixture in `render.spec.ts`; the
  producer calls `InngestService.send(notificationRequested, …)` with
  explicit `recipientIds`, awaited after the domain write inside try/catch
  (`bug-reports.service.ts:153`). `{recipientId, dedupeKey}` is unique
  forever. No web change per type; no helper resolves "holders of a
  permission in scope".
- **Web**: `features/people/` (profile `TimeOffCard`, `PersonSheet`,
  `StatusFacet`, table + card list, `TablePagination`),
  `features/hr/policies/time-off/time-off-display.ts` (`formatBalance`,
  `summarizeTimeOff`), `lead/ActivityTimeline` (timeline idiom),
  `components/ui/` has sheet, dialog, tabs, calendar, command; date inputs
  are native `type="date"`. Nav comment on People: "here until PAC-165
  opens an HR section".
- `docs/plans/pac-165-gusto-time-off-request-research.md` is **untracked**;
  commit 0 adds it.

## 1. What this ticket builds

| Piece | State |
|---|---|
| Shared vocabulary: statuses, day modes, timeline actions, list groups, check codes; pure maths: per-date hours, balance lines, the forward projection, period start; `TOR-` reference format | **New** (`shared/domain/time-off-request.ts`, `time-off-projection.ts`) + specs |
| Seven notification types in the PAC-154 catalog + renderers | **New** rows |
| `leaveLedger`: free-text `note`; `balances` takes the agency and a required as-of date and returns current + upcoming; `postUsed`, `postReversal`, `postAdjustment`; optional session | **Changed** (additive) |
| Accrual job reads the balance as of the reset day | **Changed** (bug that only appears once `used` rows exist) |
| `timeOffRequests` schema (new model), indexes, soft delete | **Rewritten** |
| Migration `time_off_requests_v2`: existing rows become read-only imported history; stale indexes dropped | **New** |
| SmartSuite import + archive guard + demo seed follow the new shape | **Changed** |
| `TimeOffBalanceService` (four lines + projection inputs) in `common/time-off/` | **New** |
| `TimeOffRequestsService` + `TimeOffController` (`/time-off/*`), DTOs, reviewer resolver, state machine, notifications | **New** |
| `POST /hr/people/:userId/balance-adjustments`; `availableHours` on the profile read | **New / changed** |
| Web: `/time-off` page (My time off · Team), request sheet, view/review sheet, record flow, profile entry points, Adjust balance, HR nav section | **New** (`web/features/time-off/`) |
| Bruno `Time Off/` folder + README; demo seed with a request in every status | **New** |

Not in this ticket (ticket's list, unchanged): reminder / escalation /
upcoming-leave jobs and any new Inngest job; "Admin" and "HR" role templates;
attachments, reason lists, coverage notes, acknowledgments, blackout dates,
policy snapshots; reviewer editing hours, partial decline; payroll and a Paid
status (PAC-123); attendance (PAC-167); the calendar page (PAC-169);
free-form comments.

## 2. Decisions

**Closed before this plan, not reopened**: the six statuses; recording needs
`hr:write` + `agency:users:read`, no new permission, Approved on creation,
never for yourself; role templates elsewhere; no jobs; Gusto's four balance
lines with Available = Current − Other requested; past dates only when
recorded; balance derived from the ledger with an as-of date.

**Confirmed with Asad 2026-11-05 (question dialogs)** — the ticket's seven
defaults and four points found while planning:

| # | Topic | Answer |
|---|---|---|
| A | Own-date overlap | **Hard block** against the person's Submitted, Changes Requested and Approved requests on any policy; Drafts ignored; applies to recorded entries. Compared on dates that carry hours |
| B | Cancelling approved leave | Employee **until the day before it starts**; a reviewer at any time with a required comment |
| C | Recorded entry over the usage cap, below zero, or inside the waiting period | **Warned, allowed**; an employee's own request is blocked |
| D | Negative-balance override | **None**; the policy's Negative balances setting is the only switch |
| E | Discarding a draft | **Soft delete** — the row stays, stamped deleted, and leaves every list. Not `Cancelled` (differs from the ticket) |
| F | Notes | **Only with an action** (send, resend, approve, request changes, decline, cancel, record) |
| G | Legacy rows | **Read-only imported history**: the imported status kept as a label, never in To review, no actions, in no balance (differs from the ticket's status mapping) |
| H | Leave past the next reset | **Project the balance** |
| I | Projection scope | **Every scheduled accrual up to each leave day** — monthly accruals, the reset with its carryover cap, the yearly grant, minus other requested leave |
| J | No in-scope reviewer | **Fallback dropped**: reviewers are the in-scope `hr:write` holders minus the employee; with none the request is sent and waits, and the form says so (differs from the ticket) |
| K | Employee cancels | Reviewers are told **only when approved leave is cancelled**; withdrawing an undecided request notifies nobody |
| L | A day before the policy's last reset | **Refused** for a recorded day and for a cancellation, pointing to the balance adjustment |

Design decisions:

1. **One branch, one PR, stacked.** `asad/pac-165-time-off-requests` off
   `asad/pac-162-people-page`; PR against that branch, not `dev`.
   Merge-based stacking: a fix below is merged *up*, never rebased under.
   Commits in the order of §6, each green on its own.

2. **The request document** (`timeOffRequests`, still a `TenantRecord`):

   | Field | Notes |
   |---|---|
   | `reference` | `TOR-2026-007`, allocated at creation (drafts included) from `SequenceService.next('timeOffRequest:<agencyId>:<year>')`, year on the agency calendar; `null` on imported rows |
   | `source` | `self` · `recorded` · `legacy` |
   | `employeeId` | whose time off (renamed from `producerId`; nullable — the import can fail to resolve a producer) |
   | `initiatorId` | who created it (the employee, or the recorder); null on legacy |
   | `policyId` | required unless `legacy` |
   | `status` | `draft · submitted · changes_requested · approved · declined · cancelled`; **absent on legacy rows**, so no lifecycle query can ever match one |
   | `firstDay`, `lastDay` | calendar days `YYYY-MM-DD` (a leave day names a day; the hire-date and holiday-row convention), replacing the `startDate` / `endDate` instants |
   | `dayMode` | `full` · `partial` |
   | `days[]` | **the per-date hours map**, one element per date from first to last, `_id: false`: `{ date, hours, scheduledHours, reason }` — `reason` is the frozen `ScheduledDayReason`, so a weekend or holiday inside the range is stored at 0 h and shown as such |
   | `totalHours` | Σ `days.hours`, written in the same update (list sort and sums) |
   | `note` | the current note to the reviewer / to the employee |
   | `submittedAt`, `decidedAt`, `decidedBy`, `autoApproved` | lifecycle facts the lists and the notice rule read |
   | `timeline[]` | append-only `{ at, actorId, action, fromStatus, toStatus, note, warnings? }`; actions `created · submitted · resubmitted · auto_approved · approved · changes_requested · declined · cancelled · recorded · imported` |
   | `legacy` | `{ status, type, requestType, decision, title }` — the SmartSuite labels, display only |
   | `deletedAt`, `deletedBy` | soft delete (answer E); every read filters `deletedAt: null` |
   | `branchId` | the employee's **home branch** at creation: `User.branchId`, or the agency's default branch for a person with none (an owner) |

   An array of day rows, not an object keyed by date: each element is one
   day's fact, it stays ordered, and `$elemMatch` can query it. Indexes:
   `{agencyId, employeeId, status, firstDay}` (my list, overlap, other
   requested), `{agencyId, branchId, status, firstDay}` (team list, who
   else is off), `{agencyId, policyId, status}` (archive guard),
   `{agencyId, reference}` unique with `partialFilterExpression: {reference:
   {$type: 'string'}}`, and the existing legacy dedupe. `status` and
   `employeeId` lose their single-field `index: true`.

3. **Hours are computed in one pure function and frozen at send.**
   `requestDays(scheduledDays, dayMode, hoursByDate)` (shared): Full days
   takes each date's scheduled hours; Partial days takes the typed value
   clamped to `0…scheduledHours` (step 0.25) and defaults a missing date to
   its scheduled hours. The service feeds it
   `WorkingDaysService.forPerson` + `scheduledDaysBetween`. A draft stores
   a provisional `days[]`; **submit and resubmit recompute it** and that is
   the frozen copy. Bounds: at least one hour in the range; the range at
   most 366 days long and ending within 730 days of today (§9.5).

4. **Ledger writers on `LeaveLedgerService`, all taking an optional
   session:**
   - `postUsed(request)` — one `used` row per date with hours > 0: `hours:
     −h`, `effectiveAt: businessDateInstant(date, tz)`, `source: {kind:
     'request', id: requestId}`, `periodKey: used:<requestId>:<date>`. The
     existing unique partial index on `{policyId, userId, kind, periodKey}`
     makes a second post impossible at the database, which is what "posts
     `used` exactly once" rests on.
   - `postReversal(request)` — for each `used` row of the request (read by
     `periodKey: {$in}` so the partial index is used) a `reversal` of `+h`
     on the **same `effectiveAt`**, `reversesId` the `used` row,
     `periodKey: reversal:<requestId>:<date>`.
   - `postAdjustment({…, hours, note})` — `manual_adjustment`, signed,
     effective today, `source: {kind: 'admin', id: null}`. The reason goes
     in a new nullable `note` string on the ledger schema (≤ 500 chars).
     Additive: no migration, no index.
   - **A request spanning a reset** is not split or special-cased: its rows
     are dated on the leave days, so the days before the reset sit in the
     closing period and the days from the reset day on sit in the new one.
   - Unlimited policies post `used` rows too (the ledger is the record of
     leave taken, and a Sick usage cap needs it); their balance is never
     read.

5. **The balance read takes an as-of date, required.**
   `balances(agencyId, policyId, userIds, asOf: Date) → Map<userId, {
   current, upcoming }>` in one aggregation: only `used` / `reversal` rows
   are ever dated in the future, so `upcoming` is the sum of those with
   `effectiveAt >= asOf` and `current` is everything else. `agencyId` joins
   the `$match` so the existing index is used. A required argument, not an
   option: an optional one leaves a silently wrong default at the next call
   site. Callers:
   - display (profile, policy members, the four lines): `asOf` = start of
     **tomorrow** on the agency calendar — leave taken today counts as
     taken;
   - **the accrual job**: `asOf` = the `effectiveAt` it already computes
     (start of today), so a reset's expiration and carryover are computed
     from the closing period only and leave on the reset day belongs to the
     new period. Without this, approved January leave would shrink
     December's carryover.

6. **The four lines, defined once** in `TimeOffBalanceService`
   (`api/common/time-off/`, used by the request service and the profile):
   - **Current balance** = `current` above.
   - **Other requested hours** = `upcoming` (approved leave not yet
     happened, from the ledger, so a request straddling today is not
     double-counted) + the `totalHours` of the person's other Submitted and
     Changes Requested requests on the policy. The request being viewed is
     excluded.
   - **This request** = its `totalHours`.
   - **Remaining available balance** = Current − Other − This
     (`balanceLines()` in shared). Card **Available hours** = Current −
     Other. Unlimited → no lines (`null`).

7. **The projection** (answers H, I) is a pure walk,
   `projectLeave(input)` in `shared/domain/time-off-projection.ts`, built
   from the functions the accrual job uses so the two agree by
   construction. From tomorrow to the last known leave day, per day: reset
   if `resetDueOn` (`resetRows` with the carryover cap, then the yearly
   grant through `cappedAllocation`), monthly accrual if `monthlyAccrualDue`
   (same order as the job), then subtract that day's leave (other approved,
   other pending, this request). It returns `lowestBalance` and its date
   over the window from this request's first day to the end, the per-period
   usage, and `crossesAccrual`.
   - **The negative-balance check is `lowestBalance < 0`** (unless the
     policy allows negative balances). With no accrual or reset in the
     window it equals line 4, so a yearly policy inside its year behaves
     exactly as Gusto.
   - A **fifth line**, "Lowest projected balance — X h on {date}", is shown
     only when `crossesAccrual` (it would otherwise repeat line 4).
   - `evaluateAutoApproval` gets `balanceAfterHours: lowestBalance`.
   - **Sick usage cap** per period comes out of the same walk:
     `periodStartFor(rules, hireDate, day)` gives the current period's
     start (fixed MM-DD, or the hire anniversary via `anniversaryMonthDay`;
     **null** when the reset is by anniversary and the hire date is missing
     or its first anniversary has not come — then all usage counts). Used
     this period = ledger `used` + `reversal` net inside the period + other
     pending requests' days in it + this request's days in it; blocked when
     any period this request touches exceeds the cap.
   - It is an estimate: a later policy edit or a missed job day changes the
     real numbers. It only decides whether a request may be *sent*.

8. **Who may see and do what — one helper, no leaks.**
   `coversBranch(dataScope, viewerBranchId, branchId)` (pure, in
   `api/time-off-requests/time-off-access.ts`): agency → true; branch →
   true only when the viewer **has** a branch and it equals the target (a
   branch-scope user with no branch covers nothing — `@SkipBranch()` removes
   the guard that would have 403'd); own → false. Used by the team list
   filter, the single read, every decision, the recordable check and the
   reviewer resolver.
   - Without `hr:write` a caller is **pinned to their own rows** whatever
     their data scope (CRM and Data Team hold `hr:read` with branch / agency
     scope).
   - A request is in a reviewer's scope by its **stamped `branchId`**; a
     person is recordable by their **home branch** (decision 2). Same rule
     both sides, so whoever is notified can open the request.
   - The team list excludes the caller's own requests (they are under My
     time off and cannot be decided by the caller).
   - A reviewer with `hr:write` alone sees the requester's balance lines
     inside the review window (the ticket asks for it); the profile's
     balances stay `agency:hr:admin` or self, as PAC-162 left them.

9. **Reviewers** — `TimeOffReviewersService` in `api/time-off-requests/`
   (not `common/`: `WorkerModule` imports `TimeOffModule` and must not pull
   in `PermissionsModule`): the agency's active users →
   `AccessResolverService.resolve(id)` each (cached; an agency is tens of
   people) → keep those holding `hr:write` (owners hold it through
   `grantsAllEnabledModules`, which a `rolePermissions` query would miss)
   whose scope covers the request's branch → minus the employee and the
   actor. An empty list sends nothing.

10. **Every transition that posts ledger rows runs in
    `TransactionRunner.run`**: a conditional `findOneAndUpdate({_id,
    status: <expected>, deletedAt: null}, …, {session})` claims the
    transition (**first decision wins**; no match → `409` carrying the
    current record), then the ledger writes with the same session, awaited
    one at a time (never `Promise.all` on a session). Notifications are
    sent **after** the commit, in try/catch — the callback can re-run and
    `InngestService.send` writes its outbox row outside the session. The
    runner's no-replica-set fallback cannot undo a status flip; that path
    is a stale dev container only and the docblock says so.

11. **Policy and people changes under live requests** (minimal guards):
    submit, resubmit, approve and record re-check "policy not archived, the
    employee is in `memberIds`, the employee is active" → `409` with the
    reason; decline and cancel always work. Approved upcoming leave is left
    alone when a person is removed from a policy, a policy is archived or a
    user is removed (the ledger keeps the rows, as deactivation already
    does). The archive guard becomes `status: {$in: ['submitted',
    'changes_requested']}, deletedAt: null`. Approval does **not** re-run
    the balance checks: the reviewer sees the live lines and decides.

12. **Old periods are closed** (answer L): on a policy with a balance, a
    recorded day earlier than `periodStartFor(today)` is refused, and so is
    cancelling approved leave that has such a day — "That day is in a
    period that has already been reset. Adjust the balance instead."
    Unlimited policies and a null period start are unaffected.

13. **Legacy rows** (answer G) are stamped `source: 'legacy'` with their
    labels under `legacy.*` and **no `status`**. They appear at the bottom
    of the employee's list ("Imported") and under an *Imported* filter in
    the team view, open read-only, and every action answers `409`. The
    SmartSuite import writes the same shape, so an empty database imported
    after this ticket matches a migrated one.

14. **Web shape** (details in §5): one page, `/time-off`, with *My time
    off* and *Team* tabs; sheets on the right for the request form and the
    request view (`PersonSheet` idiom); `/time-off/requests/:requestId`
    opens the page with that request's sheet — the notification `href`.

## 3. Endpoints

`TimeOffController` — `@Controller('time-off')`, class-level
`@RequireModule(ModuleKey.Hr) @SkipBranch()` (scope is applied in the
service from `@Access()`, as the HR controllers do). `PeopleController`
gains one route. Every request gets a Bruno file (§6, commit 6).

| Route | Permission | Data scope and behaviour |
|---|---|---|
| `GET /time-off/summary` | `hr:read` | Self. One card per enrolled policy: name, type, `currentBalance`, `otherRequestedHours`, `availableHours` (all null on Unlimited); `reviewerCount` for the "nobody can review yet" hint |
| `GET /time-off/requests/mine` | `hr:read` | Self, always. `group[]` filter; rows carry `group` |
| `POST /time-off/requests/preview` | `hr:read` | Self. `{policyId, firstDay, lastDay, dayMode, hours?, requestId?}` → `{days[], totalHours, balance, projection, blockers[], warnings[]}`. Writes nothing |
| `POST /time-off/requests` | `hr:read` | Self. Same body + `note?`, `send: boolean` → `201` Draft, Submitted, or Approved (auto) |
| `PATCH /time-off/requests/:id` | `hr:read` | Own Draft or Changes Requested |
| `POST /time-off/requests/:id/submit` | `hr:read` | Own Draft or Changes Requested; optional same body so "Send request" from an edited form is one call |
| `DELETE /time-off/requests/:id` | `hr:read` | Own **Draft** only → soft delete, `204` |
| `POST /time-off/requests/:id/cancel` | `hr:read` | Service-decided: the employee (undecided any time; Approved before day 1), or an in-scope `hr:write` holder on someone else's Approved request with `note` required |
| `GET /time-off/requests/:id` | `hr:read` | Own, or `hr:write` + scope covers it; else `404`. Adds the balance lines (undecided requests), the timeline, `actions[]` computed server-side, and `othersOff[]` for a reviewer |
| `GET /time-off/requests` | `hr:write` | Team list: stamped branch within the caller's scope, never Drafts, never the caller's own. `group[]` (default `to_review`), `q` (name), `policyId`, `employeeId`, `page`, `pageSize` |
| `POST /time-off/requests/:id/approve` | `hr:write` | In scope, not own, Submitted. `note?` |
| `POST /time-off/requests/:id/request-changes` | `hr:write` | Same; `note` required |
| `POST /time-off/requests/:id/decline` | `hr:write` | Same; `note` required |
| `GET /time-off/recordable-people` | `hr:write` **and** `agency:users:read` | Active people whose home branch is in the caller's scope, minus the caller, each with the time off policies they are in |
| `POST /time-off/records/preview` | both | As the self preview with `employeeId`; cap / negative / waiting period come back as `warnings` |
| `POST /time-off/records` | both | `{employeeId, policyId, firstDay, lastDay, dayMode, hours?, note?}` → `201` Approved. Self → `400`; out of scope → `403`; other agency → `404` |
| `POST /hr/people/:userId/balance-adjustments` | `agency:hr:admin` | `{policyId, hours (≠ 0, 2 dp), reason (1–500)}` → `201` with the new balance. `400` on an Unlimited policy or a person not in the policy |
| `GET /users/:userId/profile` (existing) | unchanged | `timeOff.policies[]` gain `availableHours` |

Refusals carry a `code` in the body (`overlap`, `past_date`,
`negative_balance`, `usage_cap`, `waiting_period`, `not_enrolled`,
`no_scheduled_hours`, `span_too_long`, `old_period`, `policy_unavailable`,
`already_decided`, `own_request`), the convention `ApiError.body` documents;
the preview returns the same codes without failing.

## 4. State machine

`canTransition(from, action)` and `requestActions(request, viewer, today)`
live in shared so the API's `actions[]` and its guards cannot disagree.

| Transition | Who | Checks | Ledger | Notification |
|---|---|---|---|---|
| → **Draft** (save) | Employee | Policy exists; dates well-formed | — | — |
| Draft / Changes Requested edit | Employee | Own row | — | — |
| Draft → *deleted* | Employee | Own Draft | — | — |
| Draft → **Submitted** · Changes Requested → **Submitted** | Employee | Enrolled, policy active; waiting period; first day ≥ today; ≥ 1 scheduled hour; span bounds; overlap (A); Sick usage cap; projection ≥ 0 unless negatives allowed. Hours recomputed and frozen | — | `time_off.submitted` → reviewers (`resubmitted` flag) |
| … → **Approved** at once | (system) | `evaluateAutoApproval` passes | `used` rows | `time_off.approved` (automatic) → employee; `time_off.auto_approved_notice` → reviewers |
| Submitted → **Approved** | Reviewer | In scope, not own, still Submitted; decision 11 | `used` rows | `time_off.approved` → employee |
| Submitted → **Changes Requested** | Reviewer | Same; note | — | `time_off.changes_requested` → employee |
| Submitted → **Declined** | Reviewer | Same; note | — | `time_off.declined` → employee |
| Submitted / Changes Requested → **Cancelled** | Employee | Own | — | — (K) |
| Approved → **Cancelled** | Employee | Own; today < first day (B) | `reversal` rows | `time_off.approval_cancelled` → reviewers |
| Approved → **Cancelled** | Reviewer | In scope, not own; note; no day in a closed period (L) | `reversal` rows | `time_off.approval_cancelled` → employee |
| (record) → **Approved** | Holder of both permissions | Person in scope, not self; enrolled; ≥ 1 hour; overlap (A); no day in a closed period (L). Cap / negative / waiting period → `warnings` on the timeline entry (C). Auto-approval rules not consulted | `used` rows | `time_off.recorded` → employee |
| Balance adjustment | `agency:hr:admin` | Person in the policy; not Unlimited; reason | `manual_adjustment` | `time_off.balance_adjusted` → employee |

Declined and Cancelled are terminal. *Taken* is not a status:
`requestGroup(request, today)` returns `taken` for Approved with `lastDay <
today`. List groups — mine: Changes requested · Drafts · Pending · Approved ·
Taken · Declined · Cancelled · Imported; team: To review · Changes requested
· Approved · Taken · Declined · Cancelled · Imported.

**Notification types** (new category `hr` in the catalog union):

| Type | To | Email / push default |
|---|---|---|
| `time_off.submitted` | reviewers | on / on |
| `time_off.changes_requested` | employee | on / on |
| `time_off.approved` (body says "automatically" when it was) | employee | on / on |
| `time_off.auto_approved_notice` ("no action needed") | reviewers | **off / off** (in-app only) |
| `time_off.declined` | employee | on / on |
| `time_off.approval_cancelled` (body by who cancelled) | employee or reviewers | on / on |
| `time_off.recorded` | employee | on / on |
| `time_off.balance_adjusted` | employee | on / on |

`entity: {kind: 'timeOffRequest', id}`; `href: /time-off/requests/<id>`
(`/time-off` for an adjustment); `dedupeKey:
<type>:<requestId>:<timeline length>` read from the committed row, so a
second Changes Requested or a resubmission is not swallowed
(`time_off.balance_adjusted:<ledgerRowId>` for an adjustment). No migration
or seed is needed for a new type.

## 5. Web

`web/features/time-off/`, shadcn/ui only, tokens from `theme.css`, light and
dark at parity, every clickable thing a `Button`, forms through
`useAppForm` + zod with registered field components.

- **`TimeOffPage`** (`/time-off`, gated `hr:read`): `SettingsPage` shell
  (`width="wide"`, `backTo="/"`), `Tabs`: **My time off** and, for
  `hr:write`, **Team**. `?tab=` and `?employee=` are in the URL.
- **Employee view**: a card per policy (`formatBalance`): **Available
  hours** large, **Current balance** beneath, the policy line from
  `summarizeTimeOff`, **Request time off**; Unlimited shows no numbers;
  nobody-enrolled is a sentence. Below, **My requests** in the group order
  above (empty groups hidden), each row: reference, policy, dates, hours,
  status `Badge`, "Recorded by …" where it applies.
- **Request sheet** (`RequestSheet`, also the edit form for a Draft or
  Changes Requested, and the record form): policy (fixed by the card) →
  First day / Last day (two `TextField type="date"`, the app's idiom; the
  last defaults to the first; `min` = today for a self request) → Full days
  / Partial days (`RadioGroupField`) → for Partial, one `NumberField` per
  working date (`hours.<date>`, an object keyed by date — never an array
  field) with weekends and holidays listed muted → the balance block →
  note (`TextareaField`) → **Send request** and **Save as draft**. The
  balance block and the per-date hours come from the debounced preview
  query (`keepPreviousData`); blockers render in an `Alert` and disable
  Send; a server refusal lands in `FormError`.
- **View sheet** (`RequestViewSheet`): details, the per-date table, the
  balance block while undecided, **who else is off** (reviewer only:
  Approved and Submitted requests in the same branch overlapping the
  dates), the timeline (`RequestTimeline`, the `ActivityTimeline` idiom),
  and the buttons the API's `actions[]` lists — Edit / Send / Discard /
  Cancel request for the employee; Approve / Request changes / Decline /
  Cancel approved leave for a reviewer, the last three through a
  `DecisionDialog` with the required note.
- **Team tab**: facet chips (generic `FacetChips<T>` lifted from
  `StatusFacet`, default *To review*, applied instantly), name search,
  policy filter, grid table on desktop and cards on mobile,
  `TablePagination`; **Record time off** in the header for a holder of both
  permissions → the request sheet in record mode with an employee
  `ComboboxField` fed by `recordable-people`, past dates allowed, warnings
  shown but not blocking, button **Record time off**.
- **Profile** (`features/people/profile/TimeOffCard`): an *Available*
  figure beside *Balance*; **Record time off** (both permissions, not your
  own profile) opening the record sheet with the person fixed; **Adjust
  balance** (`agency:hr:admin`) → `AdjustBalanceSheet` (signed hours +
  reason); a "Requests" link to `/time-off?tab=team&employee=<id>`.
- **Nav**: a new **HR** section holding People (moved from Workspace) and
  **Time off** (`module: hr`); `DevNavPage` row; routes in `App.tsx`.

## 6. Build order — one PR, these commits, each gated before the next

0. **docs** — branch from `asad/pac-162-people-page`; this plan and the
   research doc. No code.
1. **shared: vocabulary, pure maths, notification types.**
   `time-off-request.ts` (+ spec), `time-off-projection.ts` (+ spec),
   `formatTimeOffRequestRef` in `record-reference.ts`, `availableHours` on
   `PersonTimeOffPolicyView`, the `hr` category + seven catalog rows +
   renderers + fixtures, legacy docblock on `time-off.ts` (its
   `TimeOffStatus` / `TimeOffRequestType` names stay; the new ones are
   `TimeOffRequestStatus`, `TimeOffDayMode`), `index.ts`.
   Gate: `npm test -w @sfa/shared`, `npm run build -w @sfa/shared` (every
   later gate reads `dist`).
2. **api: ledger.** `LeaveLedger.note`; `balances` with `agencyId` + `asOf`
   returning `{current, upcoming}`; `postUsed`, `postReversal`,
   `postAdjustment`; sessions; the three callers updated; the accrual
   job's as-of read. Gate: `npm run build -w @sfa/api`, `test:unit`,
   `test:e2e -- accrue-time-off hr-policies people`.
3. **api: request schema, migration, the three legacy touchpoints.** The
   new schema and indexes; migration `time_off_requests_v2` (created with
   `api:dev` stopped); `migrateTimeOffRequests` writes the legacy shape;
   the archive guard and its e2e fixture; the old `seedTimeOffRequests`
   removed (its fields are gone; the new seed is commit 6). Gate: build,
   unit, `test:e2e -- hr-policies`, and the migration rehearsal (§7).
4. **api: requests — self-service and review.** `TimeOffBalanceService`,
   `TimeOffRequestsService`, `TimeOffReviewersService`, `time-off-access.ts`,
   controller + DTOs for summary / mine / preview / create / patch / submit
   / delete / cancel / get / team list / approve / request-changes /
   decline, notifications, `TimeOffRequestsModule` in `app.module.ts`.
   Gate: build, unit, `test:e2e -- time-off-requests`.
5. **api: recording, balance adjustment, profile.** `recordable-people`,
   `records/preview`, `records`, `balance-adjustments` on
   `PeopleController`, `availableHours` in `UsersService.personProfile`.
   Gate: build, unit, `test:e2e -- time-off-requests people`.
6. **Bruno + demo seed.** `bruno/Time Off/` (logins as manager and
   producer, its own policy, one request per route and per refusal:
   preview, save draft, send, overlap `400`, past date `400`, self-approve
   `403`, request changes, resubmit, approve, approve again `409`, decline,
   cancel approved, discard draft, recordable people, record past-dated,
   record as producer `403`, adjust balance, adjust on Unlimited `400`),
   README rows and `collection.bru`; `seedTimeOffRequests` rewritten: a
   Draft, a Changes Requested, a Pending too long to auto-approve, an
   auto-approved upcoming one, a Taken one recorded by the manager, a
   Declined, a Cancelled-after-approval (used + reversal rows), keyed
   `demo:tor:<n>`, ledger rows through the idempotent writers. Gate:
   `api:seed:demo:dev`, then `npx @usebruno/cli run "Time Off" --env Local`
   and the full collection.
7. **web: page, employee view, request form.** `lib/time-off-api.ts`, the
   page and My time off tab, `RequestSheet`, the preview hook, the view
   sheet with the employee's actions, nav section, routes, `DevNavPage`.
   Gate: `npm run lint -w @sfa/web` + build; browser walk as the demo
   producer (§7).
8. **web: team view, review, record, profile.** Team tab, `FacetChips`
   (People switched to it), reviewer actions, record mode, `TimeOffCard`
   additions, `AdjustBalanceSheet`. Gate: lint + build; browser walk as the
   demo Branch Manager and owner (§7).
9. **as-built + PR.** The "As built" table appended to the plan; PR against
   `asad/pac-162-people-page` listing the §9 UI calls; bound with the
   ccd_pr tools. `docs/SESSION-HANDOFF.md` untouched.

Code layout:

```
shared/src/domain/
  time-off-request.ts (+ .spec)     statuses, day modes, timeline actions, groups, check codes, view/input types,
                                    canTransition, requestActions, requestGroup, requestDays, balanceLines,
                                    datesWithHours / overlaps
  time-off-projection.ts (+ .spec)  periodStartFor, projectLeave
  record-reference.ts               formatTimeOffRequestRef(year, seq) → TOR-2026-007
  people.ts                         PersonTimeOffPolicyView.availableHours
  time-off.ts                       docblock: legacy import vocabulary only
shared/src/notifications/catalog.ts · render.ts · render.spec.ts

api/src/hr/schemas/leave-ledger.schema.ts            + note
api/src/common/time-off/
  leave-ledger.service.ts            balances(asOf), postUsed, postReversal, postAdjustment, sessions
  time-off-accrual.service.ts        asOf on its balance read
  time-off-balance.service.ts        lines + projection inputs (ledger + pending requests)
  time-off.module.ts                 + TimeOffRequest model, TimeOffBalanceService
api/src/time-off-requests/
  schemas/time-off-request.schema.ts the new model (decision 2)
  time-off-requests.module.ts · time-off.controller.ts · time-off-requests.service.ts
  time-off-reviewers.service.ts · time-off-access.ts (+ unit spec) · dto/time-off.dto.ts (+ unit spec)
api/src/hr/people.controller.ts · dto/people.dto.ts · people.service.ts   balance adjustment
api/src/hr/hr-policies.service.ts    archive guard; balances caller
api/src/users/users.service.ts       availableHours; balances caller
api/src/migration/migration.service.ts               legacy shape
api/src/seed/demo/demo-seed.service.ts · demo-data.ts
api/src/app.module.ts                + TimeOffRequestsModule
api/migrations/<stamp>-time_off_requests_v2.js
api/test/time-off-requests.e2e-spec.ts · hr-policies.e2e-spec.ts · people.e2e-spec.ts
api/test/worker/accrue-time-off.e2e-spec.ts

web/src/lib/time-off-api.ts
web/src/features/time-off/
  TimeOffPage.tsx · time-off-request-display.ts
  my/PolicyCards.tsx · MyRequests.tsx
  request/RequestSheet.tsx · request-form.ts · DaysTable.tsx · BalanceBreakdown.tsx · use-request-preview.ts
  view/RequestViewSheet.tsx · RequestTimeline.tsx · DecisionDialog.tsx · OthersOff.tsx
  team/TeamRequests.tsx · TeamRequestCard.tsx
web/src/components/common/FacetChips.tsx
web/src/features/people/profile/TimeOffCard.tsx · sheets/AdjustBalanceSheet.tsx · StatusFacet.tsx
web/src/components/layout/nav-items.ts · app/App.tsx · pages/DevNavPage.tsx

bruno/Time Off/*.bru · bruno/README.md · bruno/collection.bru
```

**Migration `time_off_requests_v2`** (raw `db`, idempotent, `down` throws):
for every row without `source` — `source: 'legacy'`, `employeeId` from
`producerId`, `firstDay` / `lastDay` from the stored instant's UTC calendar
day when it is exactly 00:00Z (every migrated row) and the agency-zone day
otherwise, `totalHours` from `hoursRequested`, `dayMode` from the legacy
request type (null when empty), `days: []`, one `imported` timeline entry
dated `createdAt`, `deletedAt: null`, `reference: null`; the labels moved
under `legacy.*`; the replaced top-level fields unset. Then drop `status_1`
and `producerId_1` where they exist (by name, existence-checked). No status
is mapped, no ledger row is written, no reference is minted. Demo rows on a
dev database are converted the same way and replaced by the next reseed.

## 7. Tests and verification

**Mapped to the ticket's "Done when"** (`time-off-requests.e2e-spec.ts` on
the `seedTestData` harness; a user is added to "Other Branch" for the scope
cases):

| Done when | Test |
|---|---|
| submit → approve posts `used` exactly once | one `used` row per leave day; two approvals fired together → one `200`, one `409`, row count unchanged |
| decline posts nothing | ledger unchanged |
| cancelling approved leave posts a mirror `reversal` | same `effectiveAt`, `reversesId` set, net zero, Available restored |
| cancelling a Submitted request posts nothing | ledger unchanged; no notification captured |
| a second decision is rejected | `409` carrying the updated record |
| a self-decision is rejected | the manager approving their own request → `403` |
| a cross-agency read is rejected | the other agency's user → `404`, and absent from both lists |
| recording without both permissions | producer `403`; a role with `hr:write` but not `agency:users:read` → `403` |
| recording for someone outside scope | manager for the Other Branch user → `403` |
| a recorded request is Approved with `used` rows | plus the `recorded` timeline entry and both identities |
| past-dated self rejected, recorded accepted | `400 past_date` / `201` |
| an overlapping request is rejected | `400 overlap` naming the clashing reference; a Draft does not clash |
| auto-approval on submit | Approved at once, `auto_approved` on the timeline, `used` rows, both notifications |
| Unit: hours across a holiday and a partial day | `requestDays` spec + an api unit over `scheduledDaysBetween` with a holiday in the snapshot |
| Unit: four lines with future-dated `used` rows | `balanceLines` spec; e2e on `balances(asOf)` → `{current, upcoming}` |
| Unit: a request spanning a reset date | `projectLeave` spec (carryover cap, yearly grant, monthly accrual, Feb 29 anniversary, null hire date); e2e: rows dated on each side; worker e2e: the reset's carryover ignores next-period leave |

Beyond the list: an `hr:read` holder with branch or agency scope cannot
read a colleague's request; a branch-scope reviewer with no branch reads
nothing; a Draft is invisible to reviewers; discard sets `deletedAt` and the
row leaves both lists; request changes → edit → resubmit recomputes hours
and sends a second notification (distinct `dedupeKey`); negative projection
`400`, the January request passes; record over the cap succeeds with
`warnings`; a recorded day before the last reset `400 old_period`; removal
from the policy → approve `409`; a legacy row → every action `409`; the
archive guard counts Changes Requested; the balance adjustment (`403`
producer, `400` Unlimited, the row's `note`, the notification); the
profile's `availableHours`. Each captured notification payload is also
parsed with the real `notificationRequested` zod schema, because
`CapturedInngestService` skips validation.

**Verification runs** (sandbox off for anything touching localhost; nothing
else on `sfa_test`; `@sfa/shared` rebuilt first): shared jest; api `build`
(eslint does not typecheck) + `test:unit`; the e2e specs above plus
`hr-policies`, `people`, `accrue-time-off`; web `lint` + `build`.
**Migration rehearsal** on a copy of the local `sfa` database through a
second API on port 4999: 36 rows become `legacy` with days derived, no
`status`, both indexes gone, a second boot writes nothing. Never run against
production. **Bruno**: the folder, then the full collection, failures read
against the known no-Resend / re-run-409 cases. **Browser**, on a branch API
+ Vite (ports 4999 / 5199 if the watch server is stale), demo logins:
producer — cards, a Full days request across a weekend, a Partial days
request, the fifth line on a January request, a blocked overlap, Save as
draft → edit → send, discard, cancel; Branch Manager — To review, approve,
request changes (note required), decline, cancel approved leave, record a
past-dated sick day with a warning, the profile's Record time off and
Adjust balance; the notification centre links open the request; light and
dark; mobile width.

## 8. Where the ticket is wrong or missing

To put into the ticket once approved (not edited until then):

1. Legacy rows are imported history, not mapped onto the new statuses
   (answer G) — locally all 30 would have landed in To review.
2. A discarded draft is soft-deleted, not Cancelled (answer E).
3. The `agency:hr:admin` reviewer fallback is dropped (answer J).
4. The negative-balance check is a projection (answers H, I), with a fifth
   line when it differs.
5. The ledger needs a free-text `note` for the adjustment reason; PAC-174's
   "do not redeclare the schema" becomes "one additive field".
6. The as-of read is needed by the **accrual job** too, not only by the
   screens.
7. Missing rules now stated: closed periods (L), the employee's
   cancellation notice (K), policy / membership changes under live requests
   (decision 11), the home branch of a person with none, the span bounds.
8. "Reviewers see the balance lines" coexists with PAC-162's "`hr:write`
   alone does not open a colleague's balances" — true only inside a request
   in their scope.

## 9. Assumptions and UI calls (taken as written unless corrected)

1. **Nav**: a new HR section with People and Time off.
2. **Dates** are two native date inputs, not a calendar range popover.
3. **The fifth line** appears only when an accrual or reset falls inside the
   window.
4. **Notification defaults**: email and push on for every type except the
   reviewers' "no action needed" notice.
5. **Bounds**: a request is at most 366 days long and ends within two years;
   hours step 0.25.
6. **A person with no branch** (an owner) belongs to the agency's default
   branch for HR, so that branch's manager can review and record for them.
7. **The team list leaves out the caller's own requests.**
8. **Approval does not re-run the balance checks.**
9. **Unlimited policies post `used` rows** and show no numbers.
10. **Imported rows carry no `TOR-` reference**; they show "Imported".
11. **A back-dated record uses the person's schedule as it is today.**
12. **The reference is allocated when the draft is saved**, so discarded
    drafts leave gaps in the series.
13. **`deletedAt` / `deletedBy`** is the first soft-delete stamp in the
    codebase; PAC-155 may rename it when it sets the convention.

## 10. Risks

- **The accrual job changes** (commit 2). It is worker code; the new worker
  e2e case is the guard, and without `used` rows its behaviour is identical.
- **Two submissions at once** by one person can both pass the overlap and
  balance checks (read-then-write, no lock). The form disables its button
  while sending; a duplicate is cancellable. Ledger posting itself cannot
  double.
- **The projection is an estimate**; it gates sending only, and a policy
  edit after sending is not re-checked.
- **Scope**: the two leaks found in review (an `hr:read` holder with a wide
  scope; a branch-scope user with no branch) are each pinned by a test
  written before the route.
- **Renaming `producerId`** touches the import, the seed and one e2e
  fixture; a missed reader fails the build (the field is gone from the
  class).
- **Email volume**: every decision emails by default (assumption 4).
- **Stack depth**: four PRs deep; fixes below are merged up, and the
  migration stamp must sort after `20261104160000-employee_profiles`.

## 11. Known traps

- `lint -w @sfa/api` is eslint-only and autofixes `api.e2e-spec.ts`; use
  `build` for types. Build `@sfa/shared` before e2e, Bruno and the seed.
- e2e shares `sfa_test`: no second run, no live `api:dev` on it. `api:dev`
  applies migrations on boot — stop it before `db:migrate:create`.
- The sandbox blocks localhost and `gh`; chained `git` needs it off.
- `User.agencyId` / `branchId` are ObjectIds; the request's and the
  ledger's are strings — both forms in every join and in the migration.
- `.lean()` applies no defaults: pin `days`, `timeline`, `deletedAt`,
  `autoApproved` in the mapper.
- The partial unique index on `periodKey` is used only with `periodKey:
  {$type: 'string'}` or an `$in` of strings.
- No `Promise.all` on a session; no notification inside the transaction
  callback; `authorshipPlugin` stamps `insertMany` and `updateOne`, not
  `bulkWrite`.
- An empty `recipientIds` fails the event's zod — skip the send.
- TanStack: never read `validateField`'s return on a mounted field; array
  fields ignore `form.reset` — the per-date hours are an object.
- `text-destructive` is the amber token; raw palette classes break light
  mode.

## As built (2026-11-05, branch `asad/pac-165-time-off-requests`)

Ten commits over `asad/pac-162-people-page` in the order of §6 (plan ·
shared · ledger · schema + migration · requests API · recording + adjustment
+ profile · Bruno + seed · web employee side · web reviewer side · this
record), each green on its own.

| Topic | Plan | Built | Why |
|---|---|---|---|
| Notification types | "seven" | **Eight** — §4's table lists eight; the count in §1 and §6 was wrong | — |
| `availableHours` on the profile type (§6.1) | commit 1 | Commit 5, with the code that fills it | A required field with nothing writing it would not have built |
| Balance read for the screens (§2.6) | `TimeOffBalanceService` "four lines" | `position()` → current balance, other requested hours, available, the other leave **by date** and the hours used this period; the lines and the projection are built from it | The projection needs the per-date leave, not a total |
| Ledger | three writers + `balances(asOf)` | Plus `leaveDays(…, {from, before})` — net leave per day and per request | What "other requested" per date and "used this period" both read |
| Scope (§2.8) | one `coversBranch` helper | `time-off-access.ts`: `coversBranch`, `holdsReview`, `reviewsBranch`, `reviewScopeFilter`; `buildScopeFilter` is not used on this collection at all | It takes no permission and skips the clamp for a null branch — both wrong here |
| Legacy timeline (§2.13) | one `imported` entry | The migration writes it; the SmartSuite import writes it **on insert only** (`persist` gained a `setOnInsert` argument) | A re-import must not move the "imported" date |
| Migration rehearsal (§7) | a copy of `sfa` through a second API on 4999 | The file was developed outside `migrations/` and run with `up(db)` against a throwaway copy of the collection (36 rows → `legacy`, no `status`, days derived, both indexes dropped, a second run 0 rows), then moved in | Asad's `api:dev` watch server was running and applies any file in `migrations/` on its next restart — it then applied the finished one to local `sfa` |
| Demo seed (§6.6) | requests in every state | As planned, ten requests across five people, plus: the pre-PAC-165 `demo:too:*` rows are removed, `purge` deletes a demo request's ledger rows with it, and **Sam Torres is left with none** | Bruno records time off for Sam; the hard overlap block would otherwise trip |
| Bruno (§6.6) | the listed requests | 36 requests, 69 tests; its own **Custom** policy with a reset date six months out; the recorded entry is cancelled and both policies archived, so the folder re-runs | Custom moves nobody out of the demo's PTO; a recorded day left behind would block the next run |
| Employee card (§5) | the policy line from `summarizeTimeOff` | The policy's kind ("Paid Time Off") | The summary read carries no rules, and the card does not need them |
| Web commits (§6.7–8) | review actions in commit 8 | The request window, with every action the API lists, is in commit 7; commit 8 adds the Team tab, recording, the profile entry points and `FacetChips` | One component renders `actions[]` for both people |
| Confirmations | `AlertDialog` for cancel / discard | One `DecisionDialog` for every action that asks — the note field is hidden on Discard | One idiom; four of the six take a note |
| Shortfall message | names the date | Names the date only when it is still to come | A past-dated record read "short on (today)" |
| Hours typed on Partial days | 0…scheduled, step 0.25 | The DTO accepts 0–24 in quarter hours; the pure function clamps to the date's schedule | The schedule is the server's to know |

**Verification.** Shared jest 404 (53 new: request maths, projection,
renderers). API unit 1,471 (13 new: access helper, DTOs). API e2e:
`time-off-requests` 35, and with `hr-policies`, `people`,
`worker/accrue-time-off` (10, six new: the as-of balance, the three writers,
a reset with next-period leave), `deliver-notification`, `notifications`,
`users-deactivate`, `profile` — 10 suites, 175 tests, all green. API
`nest build`, web `tsc` + build on every commit. Bruno `Time Off/` 36/36
requests, 69/69 tests, twice in a row. The migration applied to the local
`sfa` database (changelog `20261105190000-time_off_requests_v2.js`): 36 rows
`legacy`, the four new indexes built, `status_1` and `producerId_1` gone.
The demo seed ran after it.

Browser, on the local dev servers (`localhost:5173` → API 4000). As the
demo producer: the HR section with Time off and no People; two cards
(Paid time off 40 h available · 72 h balance · 32 h requested); My requests
in six groups; the form for 28 Dec – 4 Jan — 40 h with New Year's Day a
Holiday and the weekend at 0 h, the four lines and the fifth ("Lowest
projected balance 8 h on Thu, Dec 31"); a single day defaulting the last
day from the first; Save as draft → the request window (details, balance,
timeline, Edit · Discard · Send) → Discard with its confirmation. As the
demo Branch Manager: Team opening on To review (Alex, Jordan); Alex's
request with Thanksgiving and the day after as Holidays, the balance lines,
"Also off: Casey Kim, Nov 24 – 25, Approved"; Request changes refused
without a note and accepted with one, the timeline updating in place; the
profile's Time off card with Available beside Balance, Requests, Record
time off and Adjust; the record form for a past date on a policy with no
hours — a warning, and Record still enabled; the Adjust balance sheet.
Light theme and a 375 px viewport (no horizontal overflow). Notifications
arrived in the demo users' notification centres through the real worker —
`time_off.submitted` (and a resend as its own row), `changes_requested`,
`approved`, `declined`, `approval_cancelled` — each linking to its request.

**Not run.** In the browser: Approve, Decline, cancelling approved leave,
saving a recorded entry and saving a balance adjustment (each covered by
e2e and by the Bruno folder against the same API), an automatic approval,
and the owner's agency-wide Team list. The SmartSuite import's new shape
was typechecked, not run (no SmartSuite access from here). The email and
push channels of the new notification types were not opened. Nothing was
run against production.

**Full Bruno collection.** 391 requests: 351 passed, 39 failed, 925/1017
tests. No failure is in `Time Off`, `HR` or `People`, and this branch
changes nothing under `auth`, `leads`, `quote-recaps` or `sold-deals`. The
failures are `Auth/Me` (the test's key list predates the `phone` field
PAC-162 added to the auth blob — one line to fix on that branch), a cascade
of 404s through Leads → Quote Recaps → Sold Deals from one lead-date
request, and two Platform Mailer Campaigns re-run cases. They were not
compared against a run of the base branch.

**e2e flake.** `hr-policies` › "refuses what the model cannot hold" failed
once when run alongside two other suites and passed on every run since,
alone and in the group; it does not touch this ticket's code.

**Assumptions (§9)** all taken as written; none corrected before the build.
