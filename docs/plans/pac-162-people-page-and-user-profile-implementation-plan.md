# PAC-162 — People page and user profile: implementation plan

Ticket: https://linear.app/paciscigroup/issue/PAC-162 — sub-story 3 of 5 under
the [PAC-148](https://linear.app/paciscigroup/issue/PAC-148) epic (story v2,
§4 "People"). Written 2026-11-04 from Asad's brief of the same day, which
**supersedes the ticket text** where they differ (the ticket's body is the v1
scope; its "Rescoped" banner is the v2 scope; this plan is what we build).
Blocked by PAC-174 (PR #166) and PAC-161 (PR #163), both open and stacked;
blocks PAC-165 (requests read the hire date and the enrolment this ticket
makes editable) and PAC-169 (birthdays and anniversaries on the calendar).

Paths are relative to the repo root; `api/` = `packages/api/src`,
`web/` = `packages/web/src`, `shared/` = `packages/shared/src`.

## 0. Where things stand

- **The branch to build on is `asad/pac-174-time-off-policies`** (PR #166
  against `asad/pac-161-agency-holiday-calendar`, PR #163 against `dev`).
  Everything HR lives on that stack and nothing HR is on `dev`: the `hr`
  module + permissions + the `hr_module` migration; `holidayPolicies` /
  `workWeekPolicies` / `timeOffPolicies` on `MemberListPolicyRecord`
  (`api/hr/schemas/`); `leaveLedger` + `LeaveLedgerService` (`post`,
  `postOnce`, `balances`, `enrolledBefore`); `HrPoliciesService` with the
  enrolment diff (`releaseFromOthers`, allocation / removal rows,
  `people()`, `enrollable()`); `WorkingDaysService.forPerson` (`PersonCalendar`
  = schedule + the two policy ids, Mon–Fri 9–5 when in no Work week policy);
  the `accrue-time-off` job; `web/features/hr/policies/` with `PeopleStep`,
  `PolicyStepBar`, `summarizePolicy`, the time-off wizard and policy page.
- **The hire date has a seam waiting for this ticket.**
  `api/common/time-off/hire-dates.service.ts` (`HireDatesService.forUsers`)
  returns `null` for everyone with a docblock saying "PAC-162: read the
  profiles here and nowhere else". The accrual job's anniversary reset and
  the request rules' waiting period already take `hireDate: string | null`.
- **No `employeeProfiles` anywhere on the stack** — api, shared or web. The
  v1 build (`origin/asad/pac-162-employee-profiles`, PR #155, closed
  unmerged) is a read-only quarry: its schema, migration
  (`20261023100000-employee_profiles.js`), `ensureProfilesForAgency`,
  `employee-profile.rules.ts` (`assertIsoDay`, `assertDayNotInFuture`,
  `assertDateOfBirth`) and e2e harness are worth lifting; its policy /
  overrides / assignments / schedule-template / events half is dead and
  **the branch cannot be rebased** (memory `pac-162-employee-profiles-decisions`).
  Never reuse its migration stamp.
- **The user directory is `/settings/users`** (`web/features/admin/UsersPage.tsx`,
  `UsersTable`, `UserCard`, `UserRowMenu`, `user-display.ts`, `InviteUserDialog`),
  reading `GET /users` (paginated, searched and sorted server-side, PAC-101;
  `status[]` facet accepted by the API but **no status filter UI** on the
  page). Rows link to `/settings/users/:userId/permissions`. `userStatus()`
  in `web/lib/users-api.ts` derives `active | invited | deactivated` from
  `isActive` + `deactivatedAt` (the table on `User.isActive` is the contract).
  The ⋯ menu holds Permissions · Resend invite · Revoke invite · Change roles
  · Send password reset · Transfer work · Remove · Reactivate.
- **`User` has no phone and no per-user avatar route.** `avatarKey` exists
  (PAC-81) but is only streamed by `GET /me/avatar`; the auth-user blob
  builds `avatarUrl` as a stable relative path with a `v=` cache-buster.
  `/settings/profile` edits own name, photo and availability
  (`PATCH /me/profile` = `firstName` / `lastName`).
- **Permissions are complete**: `agency:users:read` / `:write` /
  `:permissions`, `agency:roles:read`, `agency:work_transfer:write`, `hr:read`
  (every employee template), `hr:write`, `agency:hr:admin` (Branch Manager +
  owner). **This ticket adds no permission string** (§2, decision 7).
- **Nav**: `NAV_SECTIONS` in `web/components/layout/nav-items.ts` (gated by
  `permission` / `anyOf` / `module`); the Workspace section holds one entry,
  the settings hub, whose cards are `settings-sections.ts` ("Agency Users" →
  `/settings/users`).
- **Date inputs**: plain `<input type="date">` inside `TextField`-style
  shells (`LeadDateCard.tsx`, `WizardCards.tsx`), capped at
  `agencyTodayYmd(timeZone)` from `web/lib/dates.ts`; the API's "today" is
  `agencyTodayIso(now, timeZone)`.
- `gh` and chained `git` need the sandbox off; the Bash classifier was
  flaky on 2026-11-04 (retry once, then use Read).

## 1. What this ticket builds

| Piece | State |
|---|---|
| `employeeProfiles` collection: status, hire date, termination date, DOB + show-birthday, onboarding completion stamp | **New** (`api/hr/schemas/employee-profile.schema.ts`) |
| `EmployeeProfilesService` in `common/` (ensure / terminate / reactivate / facts / complete onboarding) + the calendar-day rules | **New** (`api/common/hr/`) |
| `HireDatesService.forUsers` reads `employeeProfiles.hireDate` | **Changed** (the seam is filled) |
| `User.phone` — on `PATCH /me/profile` and on the HR facts write | **New** field |
| `GET /users` rows carry `status` (Invited · Pending onboarding · Active · Deactivated) and `avatarUrl`; `status[]` facet gains `pending_onboarding` | **Changed** |
| `GET /users/:userId/profile` (self or `agency:users:read`) — the one read behind the profile page, sectioned by what the viewer may see | **New** |
| `GET /users/:userId/avatar` (self or `agency:users:read`) | **New** |
| `PATCH /hr/people/:userId` (facts), `POST /hr/people/:userId/onboarding/complete` | **New** (`api/hr/people.controller.ts`) |
| `POST /hr/policies/:policyId/members`, `DELETE /hr/policies/:policyId/members/:userId` — single-person enrol / remove over the existing diff logic | **New** routes, **refactored** service |
| Profile seams: invite → pending; revoke → gone; remove → terminated; reactivate → pending; SmartSuite users step + demo seed + migration → ensure | **Changed** |
| Migration `employee_profiles`: a profile for every existing user of every HR-enabled agency; `$unset` of the v1 fields on rows a closed-PR dev build left behind | **New** |
| Shared: `PEOPLE_STATUSES`, `PersonProfileView`, inputs, `weeklyHours(days)` | **New** (`shared/domain/people.ts`, `work-week.ts`) |
| Web: **People** nav item, `/people` (the directory, moved out of `admin/`, with a status facet and real avatars), `/people/:userId` (the profile), `/settings/users` → redirect, ⋯ menu gains View profile + Complete onboarding | **New / moved** (`web/features/people/`) |
| Web: Complete onboarding sheet (three TanStack Form steps), Edit details sheet, Add to policy sheet | **New** |
| Bruno `People/` folder + README rows; demo seed profiles (hire dates, one pending) | **New** |

Not in this ticket: the employee's own Time off page, requests, "available
hours" vs "current balance" (PAC-165 — the profile shows the **current
balance** only, labelled as such); birthdays / anniversaries on a calendar
(PAC-169); anything the employee fills in at sign-up (documents, a to-do
list — Asad: "that's for future"; the model leaves room, §2 decision 2);
assigned leads / open work on the profile (§8); notifications (`hr.onboarding_pending`
from v1 is dropped; PAC-127 decides); manager hierarchy, salary (PAC-123);
schedule templates and per-employee schedules (dead with v1 — the schedule
*is* the Work week policy the person is in); a profile for platform admins.

## 2. Decisions

Fixed by the epic (§4, §8) and Asad's brief and **not re-litigated**: one
People list replacing `/settings/users` with the same columns and the same ⋯
menu; a status that includes onboarding (Invited → Pending onboarding →
Active, plus Deactivated); the profile at `/people/:userId` with details,
an inline Complete onboarding while pending (confirm hire date, optional
policies, Complete → Active, doable later, blocking nothing), the person's
time-off policies with balances and Add / Remove, the role with Update
permissions → `/settings/users/:userId/permissions`; sections gated by the
viewer's permissions; a People nav item; simple over exhaustive ("the data
shouldn't be bombarded on the page"); no per-person rule overrides, no
assignment history, no invite-dialog policy picker.

1. **One branch, one PR, stacked on PAC-174.** Branch
   `asad/pac-162-people-page` off `asad/pac-174-time-off-policies`; PR
   opened against that branch; retargeted as the stack merges (GitHub
   retargets when a base branch is deleted). Merge-based stacking: a fix
   landing below is merged *up*, never rebased under. Commits in the order
   of §4, each green on its own.

2. **The profile is a small document, and the schedule is not on it.**
   `employeeProfiles`, one per user per agency (`{ agencyId, userId }`
   unique; `agencyId` a **string**, the policy convention — `User.agencyId`
   is an ObjectId): `status` ∈ `pending | active | terminated`; `hireDate`,
   `terminationDate`, `dateOfBirth` as **calendar days** (`YYYY-MM-DD`, the
   holiday-row convention — a hire date names a day, it did not *happen* at
   an instant; PAC-174 already reads `hireDate` as `YYYY-MM-DD`);
   `showBirthday` (default true); `onboarding: { completedAt: Date | null,
   completedBy: ObjectId | null }` — a sub-document rather than two flat
   fields because the employee-side onboarding Asad wants later (documents,
   a to-do list) will add its own keys beside them; `createdBy` /
   `updatedBy` declared as on `PolicyRecord`. **Nothing from v1's policy
   half**: no `leavePolicyId`, `overrides`, `assignments[]`, `allocations`,
   `scheduleTemplateId`, `scheduleOverride`, `comp`, `managerId`,
   `workAnniversary` (the anniversary is the hire date's month-day, computed
   by `anniversaryMonthDay` in shared). The work schedule is the person's
   Work week policy (`WorkingDaysService.forPerson`), the holidays their
   Holiday policy, the balances their ledger rows — the profile stores
   **only facts no policy holds**. Indexes: `{ agencyId, userId }` unique,
   `{ agencyId, status }` (the list's status facet).

3. **Status is derived on the server, once, for the list and the profile.**
   `peopleStatus(user, profile)` in `api/common/hr/people-status.ts`:
   `deactivatedAt` set → `deactivated`; `isActive: false` → `invited`;
   profile `active` → `active`; otherwise `pending_onboarding` (a missing
   profile reads as pending — defensive, the migration and the seams make it
   unreachable). The list row carries `status`, and the web's `userStatus()`
   is **deleted**, not kept beside a server field it would disagree with.
   `PEOPLE_STATUSES` and `PeopleStatus` live in `shared/domain/people.ts`;
   `ListAgencyUsersDto.status` enumerates the four. Filtering by
   `pending_onboarding` / `active` reads the agency's active-profile user ids
   first (`{ agencyId, status: 'active' }`, projected to `userId`) and adds
   `_id: { $in | $nin }` to the user filter — an agency is tens of people;
   the sort is unchanged (`deactivatedAt, isActive, lastName, firstName,
   email`), so pending and active interleave by name within the active
   block, which is what a directory should do.

4. **Profiles come to exist through one service, at five seams.**
   `EmployeeProfilesService` (`api/common/hr/employee-profiles.service.ts`,
   own `EmployeeProfilesModule` registering `EmployeeProfile` + `User` and
   exporting the service and `MongooseModule`; in `common/` so
   `HireDatesService` and any worker job may import it):
   - `ensureProfile(agencyId, userId)` → upsert `pending`. Called from
     `UsersService.createPendingUser` (the invite dialog **and** Onboard
     Agency's owner invite go through it).
   - `ensureProfilesForAgency(agencyId)` → a pending profile for every
     non-platform, non-removed user without one. Called after the SmartSuite
     migration's `Users` step (`migration.service.ts#migrateUsers`), by the
     demo seed, and by the migration file (copied in, §2.11).
   - `UsersService.revokeInvite` → `deleteProfile(agencyId, userId)` after
     the user row's `deleteOne`. The user row is hard-deleted today (a
     pending invite owns no records); a profile with no user is garbage, and
     the never-hard-delete rule (PAC-155) is about records with history —
     this one has none.
   - `UsersService.deactivateUser` → `terminate(agencyId, userId, today)`:
     `status: 'terminated'`, `terminationDate` = today on the agency's
     calendar (`agencyTodayIso(now, access.timeZone)`). **No ledger row and
     no policy change**: the balance must stay readable (PAC-123 reads
     `payOutOnTermination`), and `enrollable()` already excludes removed
     people so they drop out of every picker and member list.
   - `UsersService.reactivateUser` → `status: 'pending'`, `terminationDate`
     kept. Re-joining is an onboarding: HR confirms the hire date again
     (pre-filled with the old one) and Complete clears `terminationDate`.
   - `AuthService.acceptInvite` changes **nothing**: the profile exists since
     the invite, and nothing is asked of the employee at sign-up in this
     ticket.
   A super admin enabling `hr` on an agency later: the module toggle
   endpoint, if one exists on the branch, calls `ensureProfilesForAgency`;
   if there is none (the `hr_module` migration enabled it everywhere), the
   seams above cover every user that can exist. Settle at build, do not
   invent an endpoint.

5. **`HireDatesService.forUsers` reads the profiles.** One `find({ agencyId,
   userId: { $in } })` projected to `userId hireDate`; absent or null →
   `null`, as the callers already handle. `TimeOffModule` imports
   `EmployeeProfilesModule`. The accrual e2e gains the case the PAC-174 plan
   could not run: a `hire_anniversary` policy with a real hire date resets
   on the anniversary.

6. **Phone is a user fact.** `User.phone?: string` (trimmed, ≤ 30 chars,
   free text — a US agency types `(312) 555-0100`; no E.164 normalisation,
   nothing dials it). `updateMyProfileSchema` gains `phone: clearable(...)`;
   `/settings/profile` gets the field. HR writes it through the facts route
   (decision 8) and the service updates the `users` row — the fact lives in
   one place, the write just has two routes. Not in the list; on the
   profile header.

7. **No new permission string; the viewer's existing permissions pick the
   sections.** Read the list and any profile: `agency:users:read`. Read
   **your own** profile: anyone — `GET /users/:userId/profile` carries no
   `@RequirePermissions` (the guard passes a route that requires nothing,
   as `/me/*` relies on) and the service answers 403 unless `access.userId
   === userId` or the permission is held; the docblock says why, and it is
   the only such route. Then, per section of the response:
   - `user` (name, email, phone, branch, roles, availability, status,
     `avatarUrl`) and `employment` (status, hire date, termination date,
     onboarding stamp): the viewer above.
   - `employment.dateOfBirth` / `showBirthday`: **self or `agency:hr:admin`**
     only (the epic: admins see the date, never an age; nobody else sees it
     at all) — omitted from the response otherwise, not nulled.
   - `timeOff` (policies + balances) and `schedule` (work week, hours a week,
     holiday policy): **self with `hr:read`, or `agency:hr:admin`**; omitted
     otherwise. `hr:write` alone (a reviewer) does not open another person's
     balances — Branch Manager holds `agency:hr:admin` anyway.
   - Writes: facts, Complete onboarding, Add / Remove from policy →
     `agency:hr:admin` + `@RequireModule(Hr)`. Update permissions →
     `agency:roles:read` (the existing route). The ⋯ menu as today
     (`agency:users:write`, `agency:work_transfer:write`).
   The web gates every button with `usePermissions().can(...)` as the
   convention demands; the API's omission is what makes the gate real.

8. **Two HR writes on a person, both in `PeopleController` at `/hr/people`.**
   - `PATCH /hr/people/:userId` — `{ firstName?, lastName?, phone?,
     hireDate?, dateOfBirth?, showBirthday? }`, every field `clearable`
     where null is meaningful (phone, dateOfBirth, hireDate on a pending
     profile). Name edits are allowed here because the invite form already
     lets HR type the name; the person still edits their own at
     `/settings/profile`. Rules (`api/common/hr/employee-profile.rules.ts`,
     lifted from the quarry): `hireDate` not after today on the agency's
     calendar; `dateOfBirth` before today and after 1900-01-01;
     `terminationDate` (set only by removal) on or after `hireDate` is **not**
     enforced retroactively — a hire date edited past a termination date is
     a 400. Clearing `hireDate` on an *active* profile is a 400 ("An active
     employee has a hire date"); clearing it on a pending one is fine.
   - `POST /hr/people/:userId/onboarding/complete` — `{ hireDate,
     dateOfBirth?, showBirthday?, phone?, policies: [{ policyId,
     startingBalanceHours? }] }`. 409 if the profile is already `active`
     ("Onboarding is complete"); 404 for a removed person (reactivate
     first). Writes the facts, then `status: 'active'`, `terminationDate:
     null`, `onboarding.completedAt/By`, then enrols in each policy through
     `HrPoliciesService.enrol` (decision 9) in request order. Not a
     transaction: enrolment is idempotent and a failed policy leaves the
     person Active and enrollable from the profile — the same reasoning
     `deactivateUser` gives for ordering work before deactivation. **An
     invited person may be onboarded before accepting**: the list keeps
     saying Invited (decision 3 checks `isActive` first) and flips straight
     to Active on acceptance — HR setting someone up before day one is the
     normal case.

9. **Single-person enrolment is the existing diff, exposed per person.**
   `HrPoliciesService.enrol(agencyId, policyId, userId, startingBalanceHours?)`
   and `unenrol(agencyId, policyId, userId)` are extracted from the body of
   `update`'s `memberIds` branch — `update` calls the same two internals —
   so the rules do not fork: a `time_off` enrolment moves the person out of
   their other policy of that `timeOffType` (Custom exempt) with a
   `removed_from_policy` row there, writes an `allocation` row only when
   they have no rows in this policy (`enrolledBefore`), refuses a starting
   balance for a returning person with the same 400, defaults the balance
   as PAC-174 (yearly total for `yearly`, 0 otherwise, none for Unlimited);
   a Holiday / Work week enrolment moves them out of the other policy of
   that collection. `unenrol` writes the removal row and 404s when the
   person is not a member. Routes: `POST /hr/policies/:policyId/members`
   `{ userId, startingBalanceHours? }` → the policy view; `DELETE
   /hr/policies/:policyId/members/:userId` → 204. Both `agency:hr:admin`,
   declared before `:policyId`-only routes as the controller already does
   for `people`.

10. **The profile read assembles from the services that own each fact.**
    `UsersService.personProfile(access, agencyId, userId)` →
    `PersonProfileView` (shared): `user` from the users row + `rolesForUsers`
    + the branch name (one `findById` on `Branch`, the directory's
    permission-gating for branches is for *search*, a single name on a
    profile the viewer may open is not an oracle); `employment` from the
    profile; `timeOff.policies[]` = the active `timeOffPolicies` holding the
    person (`{ agencyId, archivedAt: null, memberIds: userId }`), each with
    `id, name, timeOffType, compensation, accrualType, hoursPerYear,
    accrualFrequency, resetDateKind, resetMonthDay, balanceHours` (null on
    Unlimited) from `LeaveLedgerService.balances`; `schedule` from
    `WorkingDaysService.forPerson(agencyId, userId, { from: today, to:
    today })` → `{ workWeek: { policyId, name } | null, days: WorkWeekDay[],
    hoursPerWeek, holiday: { policyId, name } | null }` where `hoursPerWeek =
    weeklyHours(days)` (shared `work-week.ts`: Σ (end − start) over the rows,
    `HH:mm`, two decimals, unit-tested — "working hours calculated since we
    don't track those"). `avatarUrl` = `/users/:id/avatar?v=<sha1(key)[:8]>`
    or null, the auth-blob convention, built by one helper shared with
    `toAuthUser`. **No `$lookup`**, no second copy of a policy summary: the
    web formats the policy line with the existing `summarizePolicy`.

11. **Migration `employee_profiles`** (`npm run db:migrate:create --
    employee_profiles`, with `api:dev` stopped — memory
    `api-dev-applies-migrations`): for every agency with `modules.hr.enabled`,
    a `pending` profile for every non-platform user with `deactivatedAt:
    null` (active **and** invited), and a `terminated` one with
    `terminationDate` = the removal instant on the agency's calendar
    (`Intl.DateTimeFormat('en-CA', { timeZone })`, plain Node, copied in)
    for every removed user, so a reactivation finds a row. Existence-guarded
    inserts; then `$unset` of the v1 fields (`leavePolicyId`, `overrides`,
    `assignments`, `allocations`, `scheduleTemplateId`, `scheduleOverride`,
    `comp`, `managerId`, `workAnniversary`) on rows that carry them — only a
    dev database that booted PR #155 has any; idempotent either way. **The
    migrated agency's people all start Pending onboarding** (the epic's
    reading: nobody has a hire date; the legacy Users table has none) —
    put to Asad as §7.1, with the alternative. The orphaned
    `employeeProfileEvents` and `workScheduleTemplates` collections on such
    a dev database are dropped by hand, as the PAC-174 plan did for its
    interim rows; no migration touches them. The new collection's indexes
    are `autoIndex`'s job.

12. **Web: the directory moves to `web/features/people/` and becomes
    `/people`.** `PeoplePage.tsx` (from `UsersPage`), `PeopleTable.tsx`,
    `PersonCard.tsx`, `PersonRowMenu.tsx`, `person-display.ts` — moved with
    `git mv` so the history follows; `InviteUserDialog`, `ChangeRoleDialog`,
    `TransferWorkDialog`, `UserPermissionsPage` stay in `admin/` and are
    imported. Changes on the way: the row's primary link goes to
    `/people/:userId` (the permissions page is in the menu and on the
    profile); the avatar renders the real photo through whatever
    `ProfilePage` / the sidebar chip use to show an authenticated
    `avatarUrl` (verify the component at build; an `<img src>` cannot carry
    the auth header); `STATUS_BADGE` gains `pending_onboarding` ("Pending
    onboarding", the warning tint — amber `text-destructive` is the app's
    amber, see `packages/web/CLAUDE.md`); a **status facet** (four toggle
    chips beside the search, real-time, mapped to `status[]`) because the
    epic asks for facets and the API already accepts them; the ⋯ menu gains
    **View profile** (first item, everyone who can see the row) and
    **Complete onboarding…** (`pending_onboarding` rows, `agency:hr:admin`)
    opening the same sheet the profile uses. `/settings/users` → `<Navigate
    to="/people" replace />` (bookmarks and the hub card); the settings hub
    card is relabelled **People** ("Invite employees, open a person's
    profile, complete their onboarding") and points at `/people` — the
    invite button lives on the People page header as today. **Nav**: a
    `People` item (`permission: AgencyPermission.UsersRead`, icon `Contact`
    — `Users` is Leads') in the Workspace section above Workspace Settings;
    PAC-165 may open an HR section and move it. `DevNavPage` row updated.

13. **The profile page is a 60/40 detail page on `DetailCard`.**
    `PersonProfilePage.tsx` at `/people/:userId`, ungated at the router
    (the self case holds no permission); the page sends a viewer who is
    neither self nor `agency:users:read` to `/`, and renders the API's
    403 / 404 as the standard error states. One query,
    `getPersonProfile(userId)`, invalidated by every write on the page and
    by the row menu. Layout:
    - **Header**: 64px avatar, name, role badge(s), status badge, the
      `email · phone · branch` line, the ⋯ menu (`PersonRowMenu` with the
      same props as the row). Back link to People.
    - **Left (60)**: `DetailCard` **Details** — email, phone, branch, role,
      status, hire date, date of birth (when present in the response, with
      "shown on the calendar" / "hidden"), termination date (terminated
      only), "Onboarded on … by …" (when stamped); ghost **Edit** →
      `EditDetailsSheet` (`agency:hr:admin`). `DetailCard` **Time off** —
      one row per policy: name · `summarizePolicy` line · **balance**
      ("20 h", "Unlimited") · a Remove ghost (`agency:hr:admin`, confirm
      `AlertDialog` naming the balance that stays on record); header action
      **Add to policy** → `AddToPolicySheet`; empty state "Not in any time
      off policy yet". Rendered only when `timeOff` is in the response.
    - **Right (40)**: **Onboarding** card while `pending_onboarding` and
      `agency:hr:admin` — one sentence ("Confirm the hire date and pick
      their policies.") and **Complete onboarding** → `CompleteOnboardingSheet`;
      for a viewer without the permission the status badge says it and no
      card renders. `DetailCard` **Schedule** — Work week policy name (or
      "Default week"), the days condensed ("Mon–Fri · 9:00–17:00" when
      uniform, one line per group otherwise), **"40 h a week"**, Holiday
      policy name (or "No holiday policy"); rendered only when `schedule` is
      in the response. `DetailCard` **Role & permissions** — the roles,
      and **Update permissions** → `/settings/users/:userId/permissions`
      (`agency:roles:read`).
    - Light + dark through tokens only; `NOT_AVAILABLE` for a missing
      value; every clickable thing a `Button`.

14. **Three sheets, all `useAppForm` + zod, drawers on the right
    (`components/ui/sheet`, the `TimeOffPolicyPage` idiom).**
    - `EditDetailsSheet`: first name, last name, phone, hire date (`type=date`,
      max `agencyTodayYmd`), date of birth, show-birthday `SwitchField`.
      Saves `PATCH /hr/people/:userId` with the fields; the server's 400
      renders on the field.
    - `CompleteOnboardingSheet`: `PolicyStepBar` with three steps —
      **Details** (hire date required, default today; DOB; show birthday;
      phone — pre-filled from the profile), **Policies** (every active
      policy, grouped Holiday · Work week · Time off, a checkbox each; a
      policy the person is already in is ticked and disabled with "Already
      in"; ticking one of a kind unticks the other of that kind — the
      server would move them anyway, the UI just says so; a ticked
      `fixed_amount` time-off policy shows a `NumberField` "Starting
      balance" defaulting as the server does, a returning person shows
      "resumes at X h"), **Review** (`withForm`, two `FormSection`s with
      Edit → step) → **Complete**. The `validateStep` / `stepHasErrors` /
      `form.validate('submit')` trio from `OnboardAgencyPage` (spike
      traps: never read `validateField`'s return, never
      `validateAllFields`). Policy ticks are `policies: Record<policyId,
      { enrol: boolean; startingBalanceHours?: number }>` — an object keyed
      by id, not an array field (memory `tanstack-array-field-reset-trap`).
      Posts `onboarding/complete`; a 409 "already complete" refreshes the
      page rather than erroring.
    - `AddToPolicySheet`: the active time-off policies from `listHrPolicies({
      type: 'time_off' })` minus the ones the person is in; picking one shows
      the "moves from X" line for its kind (from the profile's own
      `timeOff.policies`) and the starting-balance box; **Add** →
      `POST …/members`. Holiday and Work week membership is edited from
      the policies page, not here (the profile only *shows* them in
      Schedule) — the Time off card is the one the brief asks for.
    Field components used: `TextField`, `NumberField`, `SwitchField`,
    `CheckboxField`; none added. The date inputs follow `LeadDateCard`.

15. **`/settings/profile` grows two things only**: the phone field, and a
    "Your employee profile" link to `/people/<my id>` under the header —
    the employee's read-only view of their own status, hire date, policies,
    balances and schedule is the profile page itself (decision 7), which is
    the preview of PAC-165's employee view and costs no second page.

16. **Demo seed, not the migration, gets real data**: `seedTeam` stamps a
    profile per team member — `active`, hire dates spread over 2019–2025 so
    an anniversary falls in any demo month, a date of birth on three of
    them (one with `showBirthday: false`), a phone on each — and leaves one
    producer `pending` (no hire date) so Complete onboarding has a subject;
    `seedTimeOffPolicies` keeps enrolling everyone, the pending person
    included (enrolment never required an active profile). Keyed on
    `{ agencyId, userId }`, `$setOnInsert` for the facts so a reseed does
    not undo a demo click.

## 3. Code layout

```
shared/src/domain/
  people.ts                      PEOPLE_STATUSES (invited|pending_onboarding|active|deactivated), PeopleStatus,
                                 PEOPLE_STATUS_LABELS, EMPLOYEE_PROFILE_STATUSES (pending|active|terminated),
                                 PersonProfileView { user, employment, timeOff?, schedule? }, PersonTimeOffPolicyView,
                                 PersonScheduleView, UpdatePersonFactsInput, CompleteOnboardingInput, EnrolMemberInput
  work-week.ts                   + weeklyHours(days: readonly WorkWeekDay[]) → number (2dp) (+ spec case in work-week.spec.ts)
  hr-policy.ts                   (unchanged shapes; PolicyMemberView already carries balanceHours)
shared/src/index.ts              export * for people.ts

api/src/hr/schemas/employee-profile.schema.ts     EmployeeProfile (decision 2) + two indexes
api/src/common/hr/
  employee-profiles.module.ts    registers EmployeeProfile + User; exports the service + MongooseModule
  employee-profiles.service.ts   profileFor, profilesFor(ids), ensureProfile, ensureProfilesForAgency, deleteProfile,
                                 terminate, reopen (reactivate → pending), updateFacts, completeOnboarding
  employee-profile.rules.ts      assertIsoDay, assertNotAfterToday, assertDateOfBirth, assertHireBeforeTermination (+ unit spec)
  people-status.ts               peopleStatus(user, profile) (+ unit spec)
api/src/common/time-off/hire-dates.service.ts     reads employeeProfiles (decision 5); time-off.module.ts imports EmployeeProfilesModule
api/src/common/avatar-url.ts     avatarUrlFor(path, key) — shared by toAuthUser and the people read
api/src/users/
  schemas/user.schema.ts         + phone?: string
  users.service.ts               findByAgency: status + avatarUrl per row, pending/active facet; personProfile(); the four seams
  users.controller.ts            GET :userId/profile (no @RequirePermissions, service-checked), GET :userId/avatar
  dto/list-users.dto.ts          status enum = PEOPLE_STATUSES
  users.module.ts                imports EmployeeProfilesModule, TimeOffModule, WorkingDaysModule, HR policy models for the read
api/src/profile/                 dto + service: phone on PATCH /me/profile
api/src/hr/
  people.controller.ts           PATCH /hr/people/:userId, POST /hr/people/:userId/onboarding/complete (agency:hr:admin)
  dto/people.dto.ts              updatePersonFactsSchema, completeOnboardingSchema (+ unit spec)
  hr-policies.controller.ts      POST :policyId/members, DELETE :policyId/members/:userId
  hr-policies.service.ts         enrol / unenrol extracted from update (decision 9)
  hr.module.ts                   + PeopleController, EmployeeProfilesModule
api/src/auth/auth.service.ts     toAuthUser uses avatarUrlFor
api/src/migration/migration.service.ts            ensureProfilesForAgency after the Users step
api/src/seed/demo/demo-seed.service.ts            profiles in seedTeam (decision 16)
api/migrations/2026110XXXXXXX-employee_profiles.js   decision 11
api/test/
  people.e2e-spec.ts             §5
  hr-policies.e2e-spec.ts        + members routes block
  worker/accrue-time-off.e2e-spec.ts   + anniversary reset with a real hire date

web/src/lib/people-api.ts        getPersonProfile, updatePersonFacts, completeOnboarding, enrolMember, removeMember, peopleKeys
web/src/lib/users-api.ts         AgencyUser gains status + avatarUrl; userStatus() removed; ListUsersParams.status: PeopleStatus[]
web/src/lib/hr-api.ts            (unchanged)
web/src/features/people/
  PeoplePage.tsx · PeopleTable.tsx · PersonCard.tsx · PersonRowMenu.tsx · person-display.ts   (moved from admin/, decision 12)
  StatusFacet.tsx                four chips → status[]
  PersonProfilePage.tsx          decision 13
  profile/DetailsCard.tsx · TimeOffCard.tsx · ScheduleCard.tsx · RoleCard.tsx · OnboardingCard.tsx
  sheets/EditDetailsSheet.tsx · CompleteOnboardingSheet.tsx (+ steps/) · AddToPolicySheet.tsx · person-forms.ts (zod)
web/src/features/settings/ProfilePage.tsx         phone field; "Your employee profile" link
web/src/features/settings/settings-sections.ts    "People" card → /people
web/src/components/layout/nav-items.ts            People item
web/src/app/App.tsx              /people, /people/:userId, /settings/users → redirect
web/src/pages/DevNavPage.tsx     row

bruno/People/                    Login as Manager · List People · List People (Pending onboarding) · Get Person Profile ·
                                 Get Person Profile (Self as Producer) · Get Person Profile (Other as Producer, 403) ·
                                 Get Person Avatar (404 without a photo) · Update Person Facts · Update Person Facts
                                 (Future hire date, 400) · Complete Onboarding · Complete Onboarding (Again, 409) ·
                                 Add Member to Time Off Policy · Remove Member from Time Off Policy · Remove Member
                                 (Not a member, 404) · Update My Profile (Phone); README rows
docs/plans/pac-162-people-page-and-user-profile-implementation-plan.md   this file
```

## 4. Build order (one PR, each a commit; gate before the next)

0. **Branch + docs.** `git switch -c asad/pac-162-people-page` from
   `asad/pac-174-time-off-policies`; add this plan. No code.
1. **Shared.** `people.ts`, `weeklyHours` + spec, `index.ts`. Gate: `npm
   test -w @sfa/shared`, `npm run build -w @sfa/shared` (every later gate
   reads `dist` — memory `shared-build-before-e2e-and-bruno`).
2. **API model, service, seams, migration.** Schema, `EmployeeProfilesModule`
   + service + rules + `people-status.ts` (+ unit specs), `User.phone`,
   the four `UsersService` seams, the SmartSuite step, `HireDatesService`,
   the migration file. Gate: `npm run build -w @sfa/api` (lint is
   eslint-only — memory `api-lint-does-not-typecheck`), `npm run test:unit
   -w @sfa/api`, `npm run test:e2e -w @sfa/api -- users-deactivate
   invite-event accrue-time-off` (sandbox off, nothing else on `sfa_test`).
3. **API routes.** `personProfile` + the list's `status` / `avatarUrl` /
   facet, `avatarUrlFor`, `GET :userId/profile` + `:userId/avatar`,
   `PeopleController` + DTOs, `enrol` / `unenrol` + the two member routes,
   `PATCH /me/profile` phone, `people.e2e-spec.ts`. Gate: build + unit +
   `test:e2e -- people hr-policies profile`.
4. **Bruno + demo seed.** The `People/` folder, README rows, `seedTeam`
   profiles. Gate: `npm run api:seed:demo:dev` on the local dev DB (which
   also applies the migration on the next `api:dev` boot — stop the watch
   server first), then `cd bruno && npx @usebruno/cli run --env Local`
   (sandbox off; read failures against the known no-Resend / no-Inngest /
   re-run-409 cases — memory `pac-161-v2-agency-holiday-calendar-decisions`).
5. **Web: People list, nav, redirect, menu.** The `git mv` into
   `features/people/`, `status` from the server, the facet, real avatars,
   the menu items, `/people` + redirect, the nav item, the hub card,
   `DevNavPage`, the phone field on `/settings/profile`. Gate: `npm run lint
   -w @sfa/web` (tsc) + build; browser on `localhost:5173` against a branch
   API (memory `local-web-preview-host`: a second API on 4999 + Vite on
   5199 if the watch server is stale) as the demo Branch Manager: People in
   the sidebar → the list with photos and the four statuses → chips filter
   live → `/settings/users` lands on `/people` → ⋯ shows View profile and
   Complete onboarding on the pending producer; as the producer: no People
   item, `/people` bounces, `/people/<own id>` opens.
6. **Web: profile page + sheets.** `PersonProfilePage`, the five cards, the
   three sheets. Gate: as the Branch Manager open the pending producer →
   Onboarding card → Complete onboarding: Details (a future hire date
   blocks Continue with the message on the field) → Policies (PTO ticked
   shows the balance box at 80; the seeded "Paid time off" the person is
   already in shows "Already in") → Review → Complete → the page re-reads
   Active with the balances; Edit details → phone + DOB saved and shown;
   Add to policy → the Sick policy with "moves from" absent, Add → the row
   appears with its balance; Remove → confirm → gone, the policy page's
   ledger still holds the rows; Role card → Update permissions opens the
   existing page; Schedule reads "40 h a week · Standard week · Paid
   holidays". As the producer: own profile shows Details (with DOB), Time
   off, Schedule, no Edit / Add / Remove / Onboarding; a colleague's URL →
   bounced. Light + dark. Mobile width: the cards stack, the header wraps.
7. **As-built + PR.** Append the "As built" table here (plan vs built,
   verification runs, §7 defaults taken), open the PR against
   `asad/pac-174-time-off-policies` listing the §6 UI calls, bind it with
   the ccd_pr tools, comment the Linear ticket with the PR link. Do not
   touch `docs/SESSION-HANDOFF.md`.

## 5. Tests

**Unit (shared)** — `weeklyHours`: Mon–Fri 09:00–17:00 → 40; a 08:30–12:15
day → 3.75; empty → 0; two decimals.

**Unit (api)** — `people-status`: the four outcomes plus "no profile reads
pending" and "removed but profile active reads deactivated";
`employee-profile.rules`: future hire date 400, DOB today 400, DOB 1899
400, hire after termination 400; `people.dto`: `policies[].startingBalanceHours`
≥ 0 two decimals, `policyId` an ObjectId, `phone` max 30 and clearable,
`showBirthday` boolean.

**e2e (`people.e2e-spec.ts`)**, on the `seedTestData` harness:
- Invite (as owner) → an `employeeProfiles` row `pending`; `GET /users` row
  `status: 'invited'`; accept the invite → `status: 'pending_onboarding'`;
  revoke a second invite → its profile row is gone.
- `status[]=pending_onboarding` lists only them; `status[]=active` only the
  onboarded; both → both.
- `GET /users/:id/profile` as owner: `user` + `employment` + `timeOff` +
  `schedule` with `hoursPerWeek: 40` for a person in no Work week policy;
  `dateOfBirth` present. As a producer on a colleague → 403; on self →
  200 with `timeOff` (holds `hr:read`) and `dateOfBirth`; a producer whose
  role lost `hr:read` → self 200 without `timeOff` / `schedule`.
- `PATCH /hr/people/:id` as producer → 403; as manager: phone + DOB +
  hire date saved and echoed; hire date tomorrow (agency day) → 400; clear
  hire date on an active profile → 400.
- `POST …/onboarding/complete` with a PTO policy (balance 20) and the
  Standard week → 201 `status: 'active'`, `onboarding.completedBy` the
  manager, an `allocation` row of 20, the Work week membership, the list
  row `active`; again → 409; `HireDatesService.forUsers` now returns the
  date; the accrual job's anniversary reset fires on it (worker spec).
- `POST /hr/policies/:id/members` moving a person between two PTO policies
  → `removed_from_policy` in the old, no new allocation when returning;
  `DELETE …/members/:userId` → 204 then 404.
- Remove the person (`DELETE /users/:id`) → profile `terminated`,
  `terminationDate` today (agency day), the list row `deactivated`, the
  ledger untouched; reactivate → `pending_onboarding`, `terminationDate`
  still set; complete onboarding again → cleared.
- `GET /users/:id/avatar` → 404 without a photo; with a committed key
  (the `profile.e2e-spec` upload path) → 200 with the stored content type;
  as a producer on a colleague → 403.
- A platform admin's profile route → 404 (not an agency person).

**Migration** — run against a copy of the local dev dump (memory
`never-run-against-production`): a profile per user, `terminated` rows
for removed users with the right agency day, the v1 fields gone, a second
run writes nothing.

**Browser** — steps 5–6 of §4; the Bruno run in step 4.

## 6. UI calls to put to the owner in the PR (we own UI/UX)

- People sits in the Workspace section of the sidebar, above Workspace
  Settings, until an HR section exists (PAC-165).
- A row opens the profile; Permissions moved into the ⋯ menu and the Role
  card.
- "Pending onboarding" is the amber status; Invited stays the muted one.
- The Onboarding card is a single call to action, not an inline form; the
  three-step sheet keeps the page quiet while pending.
- The profile shows the **current balance** per policy only, labelled
  "Balance"; "Available" waits for PAC-165 so the two numbers arrive
  together with their definitions.
- Holiday and Work week membership is shown on the profile (Schedule) but
  changed from the policies page; only Time off has Add / Remove here.
- The schedule line is condensed ("Mon–Fri · 9:00–17:00 · 40 h a week").
- Date of birth renders as a date with "shown on the calendar" / "hidden",
  never an age.

## 7. Assumptions and open points (put to Asad; defaults taken as written)

1. **Every existing user starts Pending onboarding** — the migrated agency
   included (the epic's reading; nobody has a hire date). Alternative: the
   migration marks already-active users `active` with a null hire date and
   only invites start pending; then "Pending onboarding" means "invited
   after the module landed", and the hire date is set from Edit details.
   Asad's brief says the status is part of the profile; the plan takes the
   epic's reading because it makes the hire date a one-click fact to collect
   per person rather than a field nobody is prompted for.
2. **HR may complete onboarding before the invite is accepted**; the list
   keeps saying Invited until then.
3. **Reactivation returns a person to Pending onboarding**, keeping the old
   hire and termination dates visible until Complete clears the latter.
4. **Nothing is asked of the employee at sign-up** (no DOB at accept-invite,
   unlike v1); the employee-side onboarding is the future the brief names,
   and `employeeProfiles.onboarding` leaves room for it.
5. **Termination date is the removal day on the agency's calendar**; no
   future-dated termination (v1 had one, v2 does not need it).
6. **HR edits names on the profile** as well as the employee at
   `/settings/profile` (the invite form already lets HR type them).
7. **Phone is free text**, stored on `users`, one field.
8. **Anyone may open their own profile**, and it shows their balances and
   schedule when they hold `hr:read` — the preview of PAC-165's employee
   view; nobody else below `agency:hr:admin` sees another person's time off.
9. **The directory's files move** (`git mv`) rather than being wrapped, so
   `features/admin/` keeps only roles, permissions and the dialogs.
10. **No notification** on invite-pending, onboarding complete or
    enrolment; PAC-127's inventory decides those.
11. **Complete onboarding is not transactional** (decision 8); a failed
    enrolment leaves an Active person to enrol from the profile.
12. **The pending demo producer is enrolled in policies anyway**; a policy
    never required an active profile.

## 8. Follow-ups this ticket leaves ready (not in scope)

- **PAC-165**: `employment.hireDate` for the waiting period; the profile's
  Time off card grows "Available" beside "Balance" and a "Requests" link;
  the employee's Time off page reuses `PersonTimeOffPolicyView`.
- **PAC-169**: `dateOfBirth` + `showBirthday` and `hireDate` for the
  birthday / anniversary layers — read through `EmployeeProfilesService.profilesFor`.
- **Open work on the profile** (Asad: "assigned leads/work"): a card over
  `GET /users/:userId/work-release/preview` (counts already exist) for
  `agency:users:write` holders, and later per-module lists.
- **Employee-side onboarding**: a to-do list in the corner of the screen
  that lands on the profile; `onboarding.*` is where its state goes.
- **PAC-123**: reads `hireDate`, `terminationDate` and the balances; its
  pay collection references `userId`, never this document.
- A platform-side "people" view for super admins, if ever asked.

## 9. Known traps (read before building)

- `User.agencyId` is an ObjectId; profile, policy and ledger `agencyId` are
  strings — both forms in every join, and in the migration.
- `.lean()` applies no defaults: `showBirthday`, `onboarding` and `status`
  are pinned in the mapper.
- A route with no `@RequirePermissions` passes `PermissionsGuard`; the
  profile read's own check is what guards it — write the test for the 403
  before the route.
- `authorshipPlugin` fills `createdBy` / `updatedBy` on `save` / `create` /
  `updateOne` / `findOneAndUpdate`, not on `bulkWrite`; the seed and the
  migration leave them null (system).
- `api:dev` applies migrations on boot and records empty scaffolds — stop it
  before `db:migrate:create`.
- `lint -w @sfa/api` is eslint-only and autofixes `api.e2e-spec.ts`; use
  `build -w @sfa/api` for types and diff the finding count.
- Build `@sfa/shared` before e2e, Bruno and the demo seed.
- e2e runs share `sfa_test`: no second run, no live `api:dev` on it.
- The sandbox blocks localhost ports and `npm install`; e2e, Bruno, curl and
  `gh` need it off.
- The local dev DB may hold v1 `employeeProfiles` rows and the orphaned
  `employeeProfileEvents` / `workScheduleTemplates` collections from PR #155;
  the migration unsets the fields, the collections are dropped by hand.
- Bruno re-runs 409 on "already complete" and on duplicate policy names —
  reseed before blaming the branch.
- An `<img>` cannot send the auth header; render `avatarUrl` the way the
  sidebar chip does.
- TanStack: never read `validateField`'s return on a mounted field, never
  `validateAllFields` across unmounted steps; array fields ignore
  `form.reset` — the policy ticks are an object keyed by id.

## As built (2026-11-04, branch `asad/pac-162-people-page`)

Six commits over `asad/pac-174-time-off-policies` in the order of §4
(plan · shared + model + seams + migration · routes + e2e · Bruno + seed ·
web · an email-wrap fix), each green on its own.

| Topic | Plan | Built | Why |
|---|---|---|---|
| `timeOffRulesOf` (§2.10) | read from the policies service | Moved to `api/common/time-off/time-off-policy.lean.ts`; the policies service and the profile read import the same mapper | `users/` must not import a feature service of `hr/` |
| Profile read's dependencies | `WorkingDaysService.forPerson` | The two policy models queried directly (`WorkingDaysModule` exports them) | `forPerson` returns no policy *names*; one `findOne` each is simpler than widening its return |
| `requireProfile` on the HR writes (§2.4) | 404 without a row | Ensures the pending row first, then reads it | A user row that predates the seams (e2e fixtures, a database the migration has not reached) is the HR admin saying the person exists |
| Complete onboarding's policy ticks (§2.14) | an object-keyed form field | Component state keyed by policy id, merged into the body at submit; the Details step alone is TanStack + zod | The ticks interact (one per kind) with no validation of their own; a form field bought nothing |
| Review step (§2.14) | `withForm` fragment | Inline in the sheet, two `FormSection`s with Edit → step | One form, one file |
| Members routes' e2e (§5) | in `hr-policies.e2e-spec.ts` | In `people.e2e-spec.ts`, which is where the policy they need is created | Self-contained |
| Accrual e2e (§5) | the anniversary case | Added, with `maxBalanceHours: null` spelled out like the other fixtures | The fixture base omits it; the job reads `undefined` as a cap of nothing |
| Row menu on a reader's row (§2.12) | — | Always renders, with View profile first; the profile page passes `onProfile` to drop that item | A directory-only reader used to get no menu at all |
| `/people` shell (§2.12) | — | `SettingsPage` with `backTo="/"` and `width="wide"`; the profile's back arrow goes to `/people` for a directory reader and `/` for the person themself | One header idiom; the arrow on a top-level page is the same trade `/settings/profile` makes |
| Status badge colours (§2.12) | pending amber, invited muted | Pending onboarding amber (`destructive`), Invited sky (`primary`), Active emerald, Removed muted | Invited is informational — the ball is in the invitee's court |

Verification runs: shared jest (work-week spec, 4); api unit `common/hr` +
`hr/dto` 22 (new: rules 4, status 3, people DTO 5); api e2e `people` (12),
`hr-policies`, `profile`, `users-deactivate`, `invite-event`,
`accrue-time-off` (4, one new) — all green; Bruno `People/` 22/22 requests
34/34 tests, `Users/` 21/21 (58/58), `Profile/` 8/8, `HR/` 23/24 (the
folder's pre-existing standalone "producer 403" case, which needs the Auth
folder's token); api `nest build` + eslint on the touched files; web `tsc`
+ build on every commit. The `employee_profiles` migration applied to the
local dev database on the watch server's restart (changelog
`20261104160000-employee_profiles.js`; the v1 `20261023100000` stamp was
already there) and the demo seed ran after it.

Browser, on `localhost:5174` (Vite's second port; the watch API on 4000
served the branch) as the demo Branch Manager: People in the Workspace
section → the list with the four statuses and the Pending onboarding ·
Invited · Active · Removed chips, filtering live (2 pending) →
`/settings/users` lands on `/people` → the pending producer's ⋯ shows View
profile and Complete onboarding… → the profile opens with the drawer:
Details pre-filled (hire date from the pending profile, phone, DOB) →
Policies grouped Holiday / Work week / Time off with "Already in" ticked
and disabled, a ticked policy reveals its balance box → Review → Complete
→ the page re-reads **Active**, the termination date gone, "Onboarded Wed,
Nov 4, 2026 by Taylor Nguyen", the new policy at 4 h; Edit details with a
future hire date blocks on the field ("A hire date cannot be in the
future."); Add to policy says "They are already in every active time off
policy"; Remove (confirm names the 4 h that stays on record) → toast → Add
to policy lists it → Add → **4 h resumes**; light theme; mobile width
stacks the cards. As the producer: no People item, `/people` bounces to
the dashboard, the own profile renders Details (with DOB), Time off,
Schedule and Role with no Edit / Add / Remove / menu; `/settings/profile`
shows the phone field.

Not run in the browser: Reactivate → pending (covered by e2e and the Users
Bruno folder), a real photo on the list (the avatar route is e2e'd for 403
/ 404; the 200 path is the `profile.e2e` upload path with the same stream
code), the owner's full ⋯ menu on a row (unchanged code).

Found on the way, local database only: `employeeProfiles` rows the closed
PR #155 build wrote on 2026-10-23 were already `active` with v1 hire
dates, so the seed's insert-only facts did not apply to them (Morgan Lee
reads Active here; pending on any fresh database) — the migration unset
their dead fields as planned; and the three PAC-174 interim
`timeOffPolicies` orphans ("Paid holidays", "Standard week", "Texas office
holidays" with no `accrualType`) still show as time off policies on the
profile and in the Policies step — delete them by hand with
`db.timeOffPolicies.deleteMany({ accrualType: { $exists: false } })`
(the sandbox refused the delete from here).

Open points (§7) all taken as written; none answered before the build.
