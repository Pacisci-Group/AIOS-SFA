# PAC-169 — Agency Calendar: implementation plan

Sub-story 5 of 5 under PAC-148 (HR module). Blocked by PAC-165 (built, PR #170).
Paths: `api/` = `packages/api/src`, `web/` = `packages/web/src`, `shared/` = `packages/shared/src`.

## Context

The HR epic has People, Time off policies and Time off requests built and in review. What is missing is the page everyone looks at: a calendar showing who is out, the holidays, and the agency's own dates. Asad's stated goal (2026-11-06):

- Branch managers and HR see upcoming leave, holidays and closures in one place.
- Admins put **special events** on the calendar (company meetup, Christmas party) and can mark one as **"no time off during this"** or as a **day off**.

The ticket text predates the rest of the epic and is wrong in three places:

| Ticket says | Reality on the branch |
|---|---|
| Closures are written "through PAC-161's agency calendar service" | That service and `agencyCalendars` / `agencyCalendarDays` were removed on 2026-11-04 (`4590d00`). Holidays are per-person **Holiday policies**; nothing stores closures or events. |
| Everyone with `hr:read` sees approved leave | Decided otherwise below: a new permission gates other people's leave. |
| Reporting half (CSV datasets, HR hub, list filters), attendance events | Not in v2 (epic); PAC-167 is backlog. Out of this plan. |

So this ticket adds its own storage for events, feeds day-off events into the working-day maths time off already uses, adds a blackout check to time off requests, and builds the calendar page on FullCalendar.

## 0. Where things stand

- Branch `asad/pac-148-hr-demo-feedback` (PR #173) = PAC-165 tip + 2 web polish commits. Stack: `dev` ← #163 ← #166 ← #168 ← #170 ← #173.
- `api/common/working-days/working-days.ts` already understands `closure` (0 hours, "Office closed" on the web), but `WorkingDaysService.forPerson` feeds only `holiday` rows. Its only callers are `TimeOffRequestsService.evaluate()`, the demo seed and one e2e spec; no worker job.
- `evaluate()` (`api/time-off-requests/time-off-requests.service.ts` ~L1065) is the single check point for preview, send and record. Codes live in `TIME_OFF_CHECK_CODES`; `RECORD_WARNING_CODES` turns a code into a warning when a manager records.
- A request's `days[]` is frozen at send; approval posts from the frozen copy and re-checks nothing about dates.
- `employeeProfiles` has `hireDate`, `dateOfBirth`, `showBirthday` (default true, written for this page). `anniversaryMonthDay` (shared) handles Feb 29.
- No `@fullcalendar/*` dependency. `packages/web/CLAUDE.md` already carries the exception (v7 React + shadcn theme, free plugins only).
- `agency:*` permissions are **role-only** (`assignableToUser: false`, enforced by the catalog parity spec): they go on roles, including custom ones, never on one person.

## 1. What this ticket builds

| Piece | State |
|---|---|
| `agencyEvents` collection + CRUD + impact preview (`agency:hr:admin`) | New |
| Permission `agency:hr:team_calendar` + catalog row + Branch Manager template + grant migration | New |
| `GET /hr/calendar` (typed entries for a date range) and `GET /hr/calendar/filters` | New |
| Day-off events → `closure` rows in `forPerson`; `blackout` check in `evaluate()` | Changed |
| Event conflicts shown on a time off request | Changed |
| `/calendar` page on FullCalendar (month, week, list), layer toggles, branch / employee filters, event sheet | New |
| Bruno `HR Calendar/` folder, demo seed events | New |

## 2. Decisions

Answered by Asad on 2026-11-06 (question dialog):

1. **Other people's leave is gated by a new dedicated permission**, on Owner and Branch Manager by default; future Admin / HR templates get it too. Everyone with `hr:read` gets the page with their own leave, holidays, events, birthdays and anniversaries.
2. **Events are whole days with an optional start / end time that is display-only.** Effects always apply to the whole day.
3. **Blackout: employees are blocked, managers recording are warned.** Requests already sent or approved are left alone and listed for the admin when the event is saved.
4. **Day off over approved leave: flag it, the admin decides.** Charged hours stand; new requests charge 0 hours for the day.
5. **Audience: whole agency, chosen branches, or chosen people.** Effects and visibility follow the audience.

Mine, following from the code (correct me in review):

6. **One `effect` enum: `none | blackout | day_off`**, not two booleans. A day off has no hours to take, so "both" means nothing.
7. **No `special_working_day`.** The snapshot marks the day scheduled but the person's week has no shift for it, so it charges nothing unless the event's time becomes load-bearing, which decision 2 rules out.
8. **Scope of the new permission:** agency data scope sees everyone; branch scope sees requests stamped with the holder's branch (none if the holder has no branch); own scope sees nobody else. Same rule as `hr:write` in PAC-165 (`coversBranch`).
9. **Pending leave of others also needs `hr:write`.** The new permission alone shows Approved only. Owner and Branch Manager hold both.
10. **A leave entry links to its request only for the employee or a reviewer in scope**; they are the only people `GET /time-off/requests/:id` serves. Everyone else in scope sees "Sam is out" with no policy name, hours or link (Sick is health-adjacent).
11. **Birthdays and anniversaries are agency-wide for every `hr:read` holder.** Birthday only when `showBirthday`; the server sends the occurrence date, never the year or an age. This widens PAC-162's "self or HR admin" rule for the month and day only.
12. **Holidays shown are those of the people in view**: the viewer's own Holiday policy for a non-holder, the in-scope people's policies for a holder; deduped by date and name, `mine` flagged.
13. **Events:** visible to their audience and to `agency:hr:admin` holders. Created, edited and removed by `agency:hr:admin`. Removal is a soft delete.
14. **Impact list is scoped.** An agency-wide event saved by a branch-scoped manager lists only requests they could see; the rest come back as a count.
15. **Resubmitting into a blackout is blocked** (a resend runs `evaluate()` again); the reviewer approves directly or records it. Approval itself never re-checks.
16. **A Submitted request that predates a day off still charges that day if approved as is.** The request view shows a conflict alert so the reviewer can send it back; hours recompute on resend.
17. **No notifications** for new or changed events in this ticket.
18. **Week view is a day-grid week**, not a time grid: every entry is all-day, so an hour grid would be empty. Event times show as text.
19. One branch `asad/pac-169-agency-calendar` off `asad/pac-148-hr-demo-feedback`, one PR against it, merge-based stacking.

## 3. Data model and shared code

**`agencyEvents`** — schema `api/hr/schemas/agency-event.schema.ts`, registered in `WorkingDaysModule` (it already imports `hr/schemas/*`). Not a `TenantRecord`: an audience can span branches.

| Field | Type |
|---|---|
| `agencyId` | string |
| `name` | string, 1–120 (`HOLIDAY_NAME_MAX_LENGTH`) |
| `description` | string or null, up to 1000 |
| `firstDay`, `lastDay` | `YYYY-MM-DD`, inclusive, span at most 31 days (`CUSTOM_HOLIDAY_MAX_DAYS`) |
| `startTime`, `endTime` | `HH:mm` or null; end needs start |
| `effect` | `none \| blackout \| day_off` |
| `audience` | `{ kind: agency \| branches \| people, branchIds: string[], userIds: ObjectId[] }` |
| `deletedAt`, `deletedBy`, `createdBy`, `updatedBy` | soft delete + authorship plugin |

Index `{ agencyId, deletedAt, firstDay }`. New collection, so no migration.

**Shared** (jest specs; the web has no test runner):

- `shared/domain/agency-event.ts`: vocabularies, limits, `AgencyEventInput` / `AgencyEventView`, `agencyEventError(input)` (style of `customHolidayError`), `eventAppliesTo(audience, { userId, homeBranchId })`.
- `shared/domain/hr-calendar.ts`: the entry union, `yearlyOccurrences(isoDate, from, to)`, `mergeHolidays`, `leaveEventConflicts(days, events)`, and the inclusive ↔ exclusive end helpers for FullCalendar.
- `shared/domain/time-off-request.ts`: add `blackout` to `TIME_OFF_CHECK_CODES` and `RECORD_WARNING_CODES`.

**API common:**

- `api/common/hr/home-branch.service.ts`: `homeBranchId` / `defaultBranchId` lifted out of `TimeOffRequestsService` (private there, ~L1462), plus a batch form. The request service delegates to it.
- `api/common/working-days/agency-events.reader.ts`: live events overlapping a range, for the agency and for one person.

## 4. Permission

- `AgencyPermission.HrTeamCalendar = 'agency:hr:team_calendar'`, appended last in `shared/permissions/permission.constants.ts`.
- Copy in `permission-catalog.definitions.ts`: "View team calendar" — see other people's time off on the HR calendar; whole agency for an agency role, own branch for a branch role.
- Add to the Branch Manager template in `default-role-templates.ts` (Owner gets every agency key already).
- Migration `<stamp>-hr_team_calendar_permission_grant.js`, copied in shape from `migrations/20261006120100-agency_settings_permission_grant.js`: skip a never-seeded database; `$setOnInsert` the catalog row (`sortOrder: 1021`, `assignableToUser: false`); upsert `rolePermissions` for roles with slug `agency_owner` and `branch_manager`. Values copied in, nothing imported. Scaffold with `api:dev` stopped; stamp after `20261105190000`.
- Scope helper `api/hr/hr-calendar-access.ts`, reusing `coversBranch` from `time-off-access.ts`.

## 5. Endpoints

All under `@RequireModule(ModuleKey.Hr) @SkipBranch()`; scope applied in the service.

| Route | Permission | Notes |
|---|---|---|
| `GET /hr/calendar?from&to&branchId&employeeId` | `hr:read` | Inclusive days, at most 92 apart (400 beyond). Filters narrow scope, never widen; out-of-scope ids return nothing. |
| `GET /hr/calendar/filters` | `hr:read` | `{ branches, people }` from the same scope rule; empty for a non-holder. Avoids needing `agency:branches:read` / `agency:users:read`. |
| `GET /hr/events/audience-options` | `agency:hr:admin` | Branches and active people for the form. |
| `POST /hr/events/impact` | `agency:hr:admin` | Writes nothing; `{ requests, hiddenCount }` for a draft event. |
| `POST /hr/events` · `GET` / `PATCH` / `DELETE /hr/events/:eventId` | `agency:hr:admin` | Create and update return `{ event, impact }`; delete is soft, 204. |

Response of `GET /hr/calendar`: `{ from, to, viewer: { seesTeam, seesPending, managesEvents }, entries[] }`, each entry `{ id, firstDay, lastDay, kind }` plus:

- `holiday`: `name`, `observedFor`, `mine`, `policies[]`
- `event`: `eventId`, `name`, `description`, `startTime`, `endTime`, `effect`, `audienceLabel`, `appliesToMe` (id lists only on `GET /hr/events/:id`)
- `leave`: `person`, `mine`, `status: approved | pending`, `partial`, `detail | null` (`requestId`, `reference`, `policyName`, `totalHours`, `conflicts[]`)
- `birthday`: `person` · `anniversary`: `person`, `years` (1 or more)

Leave rows: the viewer's own Approved / Submitted / Changes Requested, plus in-scope rows by stamped `branchId` (existing `{agencyId, branchId, status, firstDay}` index). Drafts, soft-deleted and legacy rows never appear (legacy has no `status`).

## 6. Time off integration

1. `WorkingDaysService.forPerson` keeps its signature. It reads live events for the person's audience, feeds `day_off` dates as `closure` rows (holidays last, so "Holiday" wins a shared date), and returns `events: { dayOff, blackout }` maps by date so `evaluate()` needs no second read. The home branch is resolved only when a candidate event targets branches.
2. `evaluate()`, right after `days` is computed: any day with hours on a blackout date adds check `blackout`, naming the dates and the event. Compared on dates that carry hours, like the overlap rule.
3. The existing blocker / warning split then does decision 3 with no further code: blocker on `self`, warning stored on the timeline for `record`.
4. `assertApprovable` is unchanged.
5. `toView` adds `eventConflicts` for a live request (employee or reviewer); `RequestViewSheet` shows it as an alert. Add the `blackout` label where timeline warning codes are labelled.

## 7. Web

**Install** (from `packages/web`): add `"registries": { "@fullcalendar": "https://shadcn-registry.fullcalendar.io/{name}.json" }` to `components.json`, then `npx shadcn@latest add @fullcalendar/<flavor>-event-calendar`. Decline overwriting `ui/button.tsx` and `ui/tabs.tsx`; delete the demo file; pin `@fullcalendar/react`.

**Route and nav:** `/calendar` inside the existing `hr:read` block in `web/app/App.tsx`, lazy-loaded; "Calendar" (`CalendarDays`, `module: ModuleKey.Hr`) after Time off in `web/components/layout/nav-items.ts`; a `DevNavPage` row.

```
web/lib/hr-calendar-api.ts            key factory + fetchers, no hook wrappers (house style)
web/features/hr/calendar/
  CalendarPage.tsx                    SettingsPage shell (wide, backTo="/"), useUrlState, queries, sheets
  HrCalendar.tsx                      the only importer of EventCalendar; entries → FullCalendar events
  calendar-display.ts                 per-layer label, icon, token classes
  CalendarLegend.tsx                  layer toggles that double as the legend
  CalendarFilters.tsx                 branch + employee MultiSelect; hidden when options are empty
  EntryPopover.tsx                    holiday / birthday / anniversary / event / unopenable leave
  EventSheet.tsx · event-form.ts · AudienceField.tsx · EventImpact.tsx
```

- **Data:** `datesSet` updates the range (only when the strings change); one `useQuery` with `keepPreviousData`; a memoised array goes to `events`; layer toggles filter client-side.
- **Dates:** every entry is all-day with `end = lastDay + 1`; `timeZone="UTC"`, `now` from `agencyTodayYmd(viewer.timeZone)`; read only the string forms from callbacks.
- **Views:** `dayGridMonth`, `dayGridWeek`, `listMonth`, with `dayMaxEvents`. Below `sm` start on the list.
- **Colour** (tokens only, tint + left border + icon; light and dark at parity): holiday and day-off event `success`; blackout event `destructive` (amber) with `Ban`; plain event `primary`; approved leave `chart-4` solid; pending leave `chart-4` dashed; birthday / anniversary `chart-5`; leave with a conflict gets an amber ring.
- **Dark mode:** pass the resolved theme as FullCalendar's colour scheme (the app uses a `.dark` class).
- **Clicks:** leave with `detail` opens the existing `RequestViewSheet` in place; everything else opens `EntryPopover`; an event shows Edit for an admin.
- **Admin add:** toolbar button, plus date click / drag-select, only with `can(AgencyPermission.HrAdmin)`; opens `EventSheet` prefilled.
- **Event form:** `useAppForm` + zod; name, dates, optional times (`TextField` gains `type="time"`), effect as `RadioGroupField`, audience (kind + `MultiSelect`), description. The impact list (debounced `POST /hr/events/impact`) sits above Save. Delete through `AlertDialog`, which says already-sent requests keep their hours.

## 8. Build order — one PR, each commit green before the next

| # | Commit | Gate |
|---|---|---|
| 0 | `docs(plans)`: this plan as `docs/plans/pac-169-agency-calendar-implementation-plan.md` | — |
| 1 | `feat(shared)`: event + calendar domain and specs, the permission, template, `blackout` code | `npm test -w @sfa/shared`, `npm run build -w @sfa/shared`, `npm run build -w @sfa/web` |
| 2 | `feat(api)`: grant migration | `npm run build -w @sfa/api`, `test:unit`, rehearse `up` twice on a copy of the local DB |
| 3 | `feat(api)`: schema, reader, `HomeBranchService`, events CRUD, impact, audience options | build, unit, `test:e2e -- hr-events time-off-requests` |
| 4 | `feat(api)`: `forPerson` closures, `evaluate` blackout, `eventConflicts` | build, unit, `test:e2e -- time-off-requests hr-policies` |
| 5 | `feat(api)`: `GET /hr/calendar` and `/filters` | build, unit, `test:e2e -- hr-calendar` |
| 6 | `docs(bruno)` + demo seed | rebuild shared, `api:seed:demo:dev -w @sfa/api`, the folder twice, then the full collection |
| 7 | `feat(web)`: install, page, layers, filters, details, nav, route | `npm run lint -w @sfa/web`, build, FullCalendar only in the Calendar chunk, walk as producer and manager |
| 8 | `feat(web)`: event sheet, impact, add flows, request conflict alert | lint, build, walk as manager and owner, light + dark, 375 px |
| 9 | `docs(plans)`: as-built; PR; Linear comment | — |

Demo seed: events are seeded **after** time off requests (otherwise `forPerson` zeroes those days and nothing is flagged): a blackout and a day off overlapping seeded approved leave, a timed party, a people-only event. Purge covers `agencyEvents`.

## 9. Tests and verification

**Shared specs:** `yearlyOccurrences` (Feb 29, year boundary, two-year range); `eventAppliesTo` for the three audiences; `mergeHolidays`; `leaveEventConflicts`; exclusive-end round trip; `agencyEventError`.

**API unit:** the access helper's scope × permission matrix (including branch scope with no branch); DTOs; closure + holiday on one date.

**e2e `hr-calendar` — leak cases written before the route:**

- A producer receives no leave entry that is not their own, and no birthday for a `showBirthday: false` person; no response carries a birth year.
- A branch-scope holder never receives the Other Branch user's leave, even passing that `branchId` / `employeeId`.
- A holder without `hr:write` receives Approved only, with `detail: null`.
- A people-only event is absent for a non-member, present for an admin with `appliesToMe: false`.
- Another agency's rows, legacy rows and soft-deleted rows never appear; a 93-day range is 400.

**e2e `hr-events`:** producer 403; foreign branch or user id 400; impact hides out-of-scope rows behind `hiddenCount`; soft delete removes the effect.

**e2e `time-off-requests` additions:** blackout → self send `400 blackout`, record 201 with the warning on the timeline, an existing Submitted request still approvable; day off → a new request stores `closure` at 0 h, an Approved request's ledger untouched; audience by branch and by person applies only to members.

**Bruno:** `HR Calendar/` with its own logins, re-runnable (it removes its events). **Browser:** second API on 4999 + Vite on 5199 if the watch server is stale; walk producer → Branch Manager → owner; month / week / list; light and dark; 375 px.

## 10. Known traps

- `agencyId` and `branchIds` are strings on the new collection; `User.agencyId` / `branchId` are ObjectIds. Convert in every join.
- `.lean()` applies no defaults: guard `showBirthday`, the audience arrays, `deletedAt`.
- Leave scope uses the request's **stamped** branch; event effects use the person's **current** home branch.
- Removing a day-off event leaves already-sent requests at 0 hours on those days (frozen).
- No lock between an event save and a concurrent request send: the impact list is a snapshot.
- A new `events` array each render loops `datesSet`.
- `--destructive` is amber and `--accent` is the hover surface; check what the FullCalendar theme does with both. Root font size is 15 px.
- API lint is eslint-only and autofixes `api.e2e-spec.ts`; e2e, Bruno and the seed read shared `dist`.
- As-built commit updates the `dateOfBirth` docblock and the permission count in `packages/api/CLAUDE.md`. `docs/SESSION-HANDOFF.md` is not touched.

## 11. UI calls to confirm in the PR

- FullCalendar theme flavour (start with `monarch`, compare the five in commit 7).
- The colour mapping in §7 and the layer names in the legend.
- Day-grid week instead of a time grid (decision 18).

The Linear ticket is not edited without a separate go-ahead.

## As built (2026-11-06, branch `asad/pac-169-agency-calendar`)

Ten commits off `asad/pac-148-hr-demo-feedback`. Decisions 1–19 stand as written; what differs from the plan:

| Topic | Plan | Built | Why |
|---|---|---|---|
| Theme flavour | Start with `monarch` | `breezy` | Tailwind-shaped like the rest of the app; it tints each event from a colour token with `color-mix`, so light and dark need no second palette. A one-file swap (`ui/event-calendar-views.tsx`) if another is preferred. |
| Install | `npx shadcn add` | The registry JSON fetched and the four files written by hand; `npm install` for the two packages | The CLI prompts to overwrite our `button` / `tabs`. Same files, same registry (`components.json` carries the `registries` entry). The multi-month plugin the block loads is removed: not on the allowed list. |
| Impact body | Event + optional `eventId` | The event only | The id was never used: an event's own previous dates conflict with nothing. `POST /hr/events/impact` takes the same body as create. |
| Entry details | `EntryPopover` | `EntryDialog` | A dialog is reachable by keyboard and works the same in the list view and on a phone. |
| Legend and filters | Two components | One `CalendarToolbar` | The layer chips are the legend; the filters sit on the same row. |
| Audience picker | `AudienceField` | `MultiSelectField`, a new registered field component | The forms rule: fields come from `components/form/fields`, never bound by hand. `TextField` also gained `type="time"`. |
| Migration `up` | `$setOnInsert` only | Also `$set: { isDeprecated: false }` | `down` retires the catalog row; an `up` after it must un-retire it or the grants point at a retired key. Found in rehearsal. |
| Permission-count docs | — | `packages/api/CLAUDE.md` says 63 strings | It still said 57 from before the HR module. |

**Verification.**

- Shared: 27 suites, 434 tests. API unit: 97 suites, 1476 tests. API build and web typecheck + build clean.
- e2e: `hr-events` 10 / 10, `hr-calendar` 16 / 16; `time-off-requests`, `hr-policies`, `people` 73 / 73 after the working-day change.
- Migration rehearsed on a throwaway copy of the local `permissions` / `roles` / `rolePermissions`: 26 grants on the first `up`, none on the second, removed by `down`, restored and un-retired by a third `up`, nothing written on a never-seeded copy.
- Bruno: `HR Calendar` 23 requests / 45 tests, twice in a row; `Time Off` 36 / 36.
- Browser, as the demo Branch Manager on the dev servers: month grid with all five layers and the seeded events; conflict rings on the four requests a seeded blackout or day off runs into; the entry dialog; the edit form with its impact list ("2 time off requests are on these days"); light and dark; 375 px opens on the list.
- FullCalendar is in the lazy `CalendarPage` chunk only (344 kB, 94 kB gzipped).

**Not run.**

- The full Bruno collection and the full e2e suite (only the suites above).
- The browser as a producer and as the owner; the scope rules for both are covered by `hr-calendar.e2e-spec.ts`, not by eye.
- Creating, saving and removing an event through the form in the browser (covered by e2e and Bruno at the API; the form was opened and its impact list seen, not submitted).
- `npm run lint -w @sfa/api` as a whole: eslint was run on the files this ticket touched.

**Environment findings.**

- `HR` run as a single Bruno folder fails `List HR Policies (as Producer, 403)` with a 401: that request inherits the collection token the `Auth` folder sets. Not from this ticket.
- The page logs one React ref warning from `MobileNav` → `SheetContent`; it is on every `SettingsPage` and predates this.
- The local `api:dev` applied the grant migration to the dev database as soon as the file existed; the rehearsal copy was made to start without it.

**Open points taken as written:** decisions 6–18 and the three UI calls in §11 (flavour is now `breezy`).

