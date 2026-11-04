# PAC-161 — Agency Holiday Calendar: implementation plan (v2)

Ticket: https://linear.app/paciscigroup/issue/PAC-161 — sub-story 1 of 5 under
the [PAC-148](https://linear.app/paciscigroup/issue/PAC-148) epic (story v2,
2026-10-29). Blocks PAC-174 (Time Off Policy), and through it PAC-162 / PAC-165 /
PAC-169. Written 2026-11-02; supersedes the v1 plan, which now exists only on the
closed branch (`git show asad/pac-161-hr-foundation:docs/plans/pac-161-hr-foundation-implementation-plan.md`).

> **Superseded in part by v3 (2026-11-03) — see the last section.** Asad
> reviewed the PR and found the calendar page too much for what it does:
> holidays and the working week are now **time off policies** with enrolled
> people, on a Settings → Time off page. §1–§8 below are the v2 record; the
> agency calendar, the import dialog, the Q4 proposal job and the owner's
> Holiday step no longer exist.

Paths are relative to the repo root; `api/` = `packages/api/src`,
`web/` = `packages/web/src`, `shared/` = `packages/shared/src`.

## 0. Where things stand

- **PAC-161 v1** ("HR foundation") was built on `asad/pac-161-hr-foundation` and
  raised as PR #154. David's demo (~2026-10-27) rejected the leave-policy
  template flow; the story was rewritten (epic description = v2, repo copy
  `docs/plans/pac-148-story-v2.md`, the why in
  `docs/plans/pac-148-gusto-simplification-handoff.md`). **PR #154 and the
  stacked #155 (PAC-162 v1) were closed unmerged on 2026-10-30.** Both branches
  stay on origin as read-only quarries. Linear has PAC-161 back In Progress.
- **Nothing HR is on `dev`.** `git merge-base dev asad/pac-161-hr-foundation` is
  `105e73e`, the current `dev` tip: the v1 branch is a strict descendant, so its
  tree can be staged over `dev` with zero conflicts (§2, decision 1).
- **`date-holidays` 3.37.0 is installed** in the root `node_modules` (from the
  v1 lockfile) but is not in `packages/api/package.json` on `dev`; the squash
  brings the dependency and the lock back together.
- The `hr_module` migration (`20261022120000-hr_module.js`) **has been applied
  to Asad's local dev DB** by `api:dev` on 2026-10-22 and to no shared database.
  It is immutable from here (§2, decision 3).
- The two PAC-148 story docs are **untracked** under `docs/plans/`; commit them
  on `dev` first, or a `git add -A` on the feature branch sweeps them in.
  `docs/SESSION-HANDOFF.md` is still tracked and must not be edited in this PR.

## 1. What this ticket builds (v2 scope, from the epic)

| Piece | State |
|---|---|
| `hr` module key + `hr:read` / `hr:write` / `agency:hr:admin` / `agency:hr:export`, catalog rows, template grants, the `hr_module` migration | **Built (v1)** — salvaged as-is |
| `agencyCalendars` / `agencyCalendarDays`, `WorkingDaysService`, `date-holidays` wrapper, holiday suggestions, Q4 next-year proposal job + `hr.holidays_proposed` notification, Settings → HR → Calendar (workweek card, year grid, add/remove day, import dialog, proposal banner) | **Built (v1)** — salvaged, then reshaped by the grouping change below |
| `PermissionHoldersService` (who holds permission X), `ensureAgencyCalendar` on every provisioning path, Branch Manager test fixture, Bruno `HR/` folder | **Built (v1)** — salvaged |
| **Owner-wizard Time zone step** (non-skippable, before the holiday step) and the **removal of the time zone from the Super Admin's Onboard Agency wizard** | **New** |
| **Holiday step** in the owner's wizard: federal (checked) / non-federal (unchecked) / custom (name, start, end) | **New** (replaces v1's "whole settings tab inside the wizard") |
| The **same grouping in the import dialog and the Q4 proposal review** | **New** |
| "HR Policy" container, `GET /hr/policy`, `leavePolicies` + `LeavePolicyRules`, the nine-section editor, the HR Policy onboarding step, `hasActivePolicy`, `HrCommonModule` | **Dropped** (PAC-174 builds Gusto-shaped policies fresh) |

Not in this ticket: policies (PAC-174), People / profiles (PAC-162), requests
and the ledger (PAC-165), the FullCalendar page (PAC-169), attendance (PAC-167,
backlog), anything per branch, a half-day closure (open point 1).

## 2. Decisions

Settled earlier and **not re-litigated** here: the four-permission mapping
(`hr:review` → `hr:write`, `hr:admin`/`hr:export` → `agency:hr:*`, role-only);
a calendar day is a `YYYY-MM-DD` calendar fact, never an instant; **no holiday
row is ever written without a person ticking it**; two collections, not an
embedded array; services the worker needs live under `common/`; Branch Manager
is the Office Manager; nothing per branch; the `hr:read` holder may write their
*own* records (PAC-165). The memory file `pac-161-hr-foundation-decisions`
carries the reasons.

1. **Salvage by `git merge --squash`, not cherry-pick.** On a fresh branch off
   `dev` (`asad/pac-161-agency-holiday-calendar`; Linear's generated name is
   fine too), run `git merge --squash asad/pac-161-hr-foundation`. Because the
   branch is a strict descendant of `dev`'s tip, this stages its whole tree with
   no conflicts and no merge commit; `1aecefb` (the v1 branch's merge of `dev`)
   is never cherry-picked. Then, **before the first commit**, delete the dead
   half (decision 2) and restore the two files the squash must not touch:
   `git checkout dev -- docs/SESSION-HANDOFF.md` (v1 added §25 to it) and
   `git rm docs/plans/pac-161-hr-foundation-implementation-plan.md` (the v1
   plan is superseded; the branch keeps it). Run `npm install` once to confirm
   the squashed `package-lock.json` is consistent (it only adds
   `date-holidays`); if npm rewrites it, restore the last green lock per the
   `app-worktree-git-and-lockfile-traps` memory.

2. **What the squash brings that must go** (delete in the same first commit so
   the API never compiles with the policy half):

   | Dead | Path(s) |
   |---|---|
   | Policy domain | `shared/domain/hr-leave-policy.ts`, `shared/domain/hr-policy.ts`, their two `export *` lines in `shared/index.ts` |
   | Policy reader | `api/common/hr/leave-policy.service.ts`, `leave-policy.merge.ts` (+ unit spec), `leave-policy.validate.ts` (+ unit spec), `hr-common.module.ts` |
   | Policy HTTP | `api/hr/leave-policies.controller.ts`, `leave-policies.service.ts`, `hr-policy.controller.ts`, `dto/leave-policy.dto.ts`, `schemas/leave-policy.schema.ts`; `HrModule` loses `HrCommonModule` and the two controllers |
   | Policy web | `web/features/hr/settings/policies/*`, `HrPolicySlots.tsx`, `web/features/agency-setup/HrPolicyStep.tsx`; `hr-api.ts` loses `getHrPolicy` + the five policy calls and `hrKeys.policies/policy/hrPolicy` |
   | Policy tests + docs | the `leave policies` describe block in `api/test/hr-settings.e2e-spec.ts`; `LeavePolicy` model + the "no leave policy" assertion in `agency-onboarding.e2e-spec.ts`; Bruno `HR/Create|Get|List|Update|Update (Invalid)|Archive Leave Policy.bru` and `HR/Get HR Policy.bru` |

   **Kept** although it sounds like policy: `AgencySetup.hrPolicySkipped` on
   the schema, `completeAgencySetupSchema`, `AgencySetupView` and the web
   `CompleteAgencySetupInput` — PAC-174's optional policies step records it,
   and removing then re-adding a stored flag is churn for nothing. Also kept:
   `api/common/hr/ensure-agency-calendar.ts` stays where it is (the folder is
   where PAC-174's worker-importable policy reader will land again).

3. **The migration is byte-identical.** `20261022120000-hr_module.js` is
   already in Asad's local `migrations_changelog`; an applied migration is
   immutable (fix a mistake with a new one). Its catalog descriptions mention
   leave policies and points — still true of the module over the epic, and
   harmless. No second migration is needed by this ticket: `HolidayProposalItem`
   gains two optional fields (decision 11) and the reader defaults them, and no
   proposal exists outside local dev databases. The orphaned `leavePolicies`
   collection on a dev DB that booted #154 can be dropped by hand
   (`db.leavePolicies.drop()`); nothing references it.

4. **The Super Admin wizard loses the time zone entirely, and the API ignores a
   sent one.** `onboard-schema.ts` drops `agency.timezone` from the zod shape,
   `EMPTY_ONBOARD` and `toOnboardInput`; `AgencyStep` loses the combobox and
   `ReviewStep` the row; `onboardAgencySchema` (API) drops the `timezone` key —
   zod's `z.object` strips unknown keys, so an older client that still sends it
   gets a 201 with the platform default, not a 400 (the agency-profile e2e
   already proves `{ colour: 'blue' }` is stripped). `AgencyProvisioningService`
   loses its `timezone` branch and the `assertMongoKnowsTimeZone` import; the
   `onboardAgencySchema — timezone (PAC-141)` unit block becomes one test
   ("a sent timezone is ignored; the agency is created on
   `DEFAULT_AGENCY_TIME_ZONE`"), mirrored by one e2e assertion in
   `agency-onboarding.e2e-spec.ts`. `DEFAULT_AGENCY_TIME_ZONE` stays the schema
   default (epic open point 9: nothing retroactive; existing agencies never see
   the new step).

5. **The owner's Time zone step saves on select.** It is the first of the new
   steps, after the existing brand → email → carriers trio and before Holidays
   (epic §1 order). `skippable: false` — the first non-skippable phase-2 step,
   so `WizardFooter` renders Continue only. It reads `GET /agency/profile` and
   on each change calls `PATCH /agency/profile { timezone }` through the
   existing `updateAgencyProfile` (the DTO refuses an empty body, so the step
   sends only when the value differs from the stored one). The owner holds
   `agency:settings:write` by template, so no new gate. Reuse the
   `AgencyProfilePage` combobox (`timeZoneOptions`, `ComboboxField` under
   `useAppForm`); the end-of-day hour stays on the settings page only. Copy:
   "Your working day. Dashboards, business dates and the end-of-day Away run
   follow this clock." Continue is disabled while a save is in flight.

6. **The Holiday step is a purpose-built step, not the settings tab.** v1
   rendered the whole `CalendarTab` (workweek card, year grid, import button,
   add-day dialog) inside the wizard. v2 renders one `HolidayPicker` (decision
   8) for the agency's current year with a small region line above it
   ("Holidays for United States · Texas — Change") that expands the country /
   region selects extracted from `WorkweekCard` into a `RegionPicker`. No
   workweek (Mon–Fri is already saved by provisioning; it stays editable at
   Settings → HR), no year grid, no manual closures. Continue writes the ticked
   set in one `POST /hr/calendar/days { source: 'onboarding' }`; Skip writes
   nothing and sets `calendarSkipped`. Pressing Continue with nothing ticked is
   the same as Skip. Rows already on the calendar (an owner coming back via
   `/welcome/agency`) show ticked and disabled, as the import dialog does.
   Next year is **not** offered in the step: an agency that onboards in Q4
   receives the Q4 proposal for next year on the job's next tick, because the
   job keys on "is it October yet on the agency clock" and "no proposal for the
   year", both already true.

7. **Federal vs non-federal is computed from two `date-holidays` instances,
   merged by date, on the API.** Verified against 3.37.0 on 2026-11-02:
   - "Federal" = the `public` rows of the **region-less** `US` instance:
     **12 rows in 2026** (the epic's "eleven" plus the Independence Day
     substitute on Fri 07-03) and **15 rows in 2027** (eleven plus four
     substitutes: 06-18, 07-05, 12-24, 12-31). No two share a date.
   - A **state instance renames or drops federal rows** (all 51 codes run for
     2026): 36 states have no "Washington's Birthday" row (`OK` and `TX` emit
     "Presidents' Day" on the same Monday instead), 14 have no Columbus Day
     row, and 35 put a different label on at least one federal date. Two
     (`ME`, `NM`) already emit **two `public` rows on one date** in 2026. So
     the regional list cannot be the federal list, and `type === 'public'`
     cannot be the test.
   - A state adds `public` rows on **new** dates (`IL` 2026: Lincoln's
     Birthday, Casimir Pulaski Day, Malcolm X Day, Election Day; `TX`: Day
     after Thanksgiving, Christmas Eve, Day after Christmas) and sometimes on a
     **federal** date (`TX` 2027: "Christmas Eve" on 12-24, the same day as the
     "Christmas Day (substitute day)" row).
   - That last case is **the v1 defect**: v1 deduped on `${date}:${name}`, so
     both 12-24 rows survived, both were `public` and pre-checked, and the
     batch DTO's "each date once" rule 400'd the default import for a Texas
     agency in 2027 — the e2e fixture's own branch is in Austin. Maine and New
     Mexico hit it in 2026 already.

   Algorithm (`suggestHolidays` → `groupHolidaySuggestions`, pure, in
   `api/common/working-days/holiday-suggestions.ts`):
   1. `national = rows(country, null, year)`, `regional = region ? rows(country, region, year) : []`.
   2. Federal set `F` = `national.filter(type === 'public')`, keyed by date.
   3. Walk `regional` ∪ `national`: a row whose date is in `F` is dropped (the
      federal row already holds that date — its label wins, so an Oklahoma
      agency sees "Washington's Birthday", which is what the federal calendar
      calls it); every other row goes to `other`, first row per date wins
      (regional first, so a state's `public` extra outranks a national
      observance on the same day).
   4. Output one row per date, sorted, each with `group: 'federal' | 'other'`
      and `type` kept for the sub-label.

8. **Pre-check rule, including substitute days.** `preChecked = group === 'federal'`
   except the **weekend original of a substitute pair**: when a `substitute: true`
   row and a non-substitute row in the same year's output share the package
   `rule` string (verified identical, e.g. both Independence Day rows carry
   `07-04 and if sunday then next monday if saturday then previous friday`),
   the non-substitute row is listed unchecked with the sub-label "falls on a
   Saturday/Sunday" and the substitute row is checked with "(observed)". A
   substitute whose original lies in another year (2027-12-31 for New Year's
   Day 2028) is checked on its own. Both rows stay in the list — an agency that
   closes on the Saturday too can tick it.

9. **`HolidaySuggestion` gains `group` and the wire shape is otherwise
   unchanged.** `GET /hr/calendar/holiday-suggestions?country&region&year` →
   `{ country, region, year, suggestions: [{ date, name, type, substitute,
   group, preChecked, alreadyInCalendar }] }`. `alreadyInCalendar` stays a
   per-date lookup against active rows. The endpoint keeps `agency:hr:admin`.

10. **Custom holidays are all-day ranges written as one row per working
    day** (epic open point 1 — the plan assumes all-day; a time window is a
    model change for PAC-165's hours arithmetic and is not built here). The
    `HolidayPicker`'s third section is a small form: name (≤ 120), start date,
    end date (defaults to start), "Add"; each added range appears as a ticked
    row in a "Custom" list and can be removed before saving. On save the client
    expands the range into `AddCalendarDayInput[]` with `kind: 'holiday'`,
    `label: name`, **skipping days outside the agency workweek** (a holiday on
    a Sunday adds nothing to the working-day math and clutters the grid), and
    sends them in the same batch as the ticked suggestions. The form says what
    it will write ("Dec 24 – Jan 2 · 6 working days"). Rules: end ≥ start,
    start within the shown year (the range may run into the next year — a
    Christmas closure does — and the client then invalidates both years'
    queries), ≤ 60 days per range, a custom date that collides with a ticked
    suggestion is refused in the client before the API's 409 would. No API
    change: the batch DTO already accepts up to 400 days with no reason for
    `onboarding` / `import`. No new `source` value: a custom row added at setup
    is `onboarding`, from the dialog `import`, which is what the row's "Added
    at setup" / "Imported" label already says.

11. **One `HolidayPicker`, three places.** The onboarding step, the settings
    "Import holidays for YEAR" dialog, and the Q4 `ProposalBanner` review
    dialog all render the same component (`web/features/hr/settings/calendar/HolidayPicker.tsx`):
    sections **Federal holidays** (checked), **Other holidays** (unchecked;
    sub-label from `type` and the substitute note), **Custom holidays** (the
    form). It takes `suggestions`, `workweek`, `alreadyInCalendar` handling and
    returns the ticked set + custom rows through a controlled `value`/`onChange`
    so each host decides when to write. For the proposal: `HolidayProposalItem`
    (embedded on `agencyCalendars`) gains `group` and `preChecked`, the Q4 job
    writes them from the same grouping function, the review dialog pre-ticks
    `preChecked` only, and the banner's one-click button becomes **"Confirm N"**
    where N is the pre-checked count — v1's "Confirm all" wrote every
    observance. A proposal written before this change (local dev only) reads
    `group` from `type` and `preChecked` from `group` in the view mapper.
    Confirming a proposal cannot add custom rows (the dialog hides that section
    there); those go through the year grid.

12. **Settings → HR keeps its route and gate, loses its tabs.** `/settings/hr`
    (`agency:hr:admin`) renders the Calendar directly — no `Tabs` until PAC-174
    adds "Time off policies" beside it. The notification deep link becomes
    `/settings/hr?proposal=YYYY` (drop `tab=calendar`; the page tolerates the
    old query). `SETTINGS_SECTIONS` copy: "Your working week, holidays and
    closures." `MODULE_CATALOG[Hr]`: "The agency holiday calendar and closures,
    and — as the HR stories land — time-off policies, People, requests and the
    team calendar." No sidebar nav item yet (PAC-162/165/169 add People, Time
    off, Calendar).

13. **`calendarSkipped` is recorded only when the owner pressed Skip.** Continue
    with nothing ticked writes nothing and leaves the flag false — the owner
    looked and chose nothing, which is not "skipped". `SKIP_FLAG_BY_STEP` keeps
    `calendar` and `hr-policy` entries (the latter unused until PAC-174); the
    `hr-policy` step id is removed from `AgencySetupStepId` for now and PAC-174
    re-adds it.

14. **The Q4 job is unchanged in shape**, only in what it stores: it calls the
    grouping function and copies `group` / `preChecked` into the items. Its
    notification keeps `count` = total items (the admin is asked to review all
    of them); the renderer copy is untouched except the href.

15. **No new permission, module, collection or index.** Everything new rides on
    the v1 spine. The one schema edit is additive (decision 11).

16. **One PR against `dev`**, stacked commits in the order of §4 so each is
    green on its own; the web and API halves ship together (the holiday step is
    unusable without the grouping, and the grouping is invisible without the
    picker).

## 3. Code layout (delta over the squashed v1 tree)

```
shared/src/domain/hr-calendar.ts            + HolidaySuggestionGroup = 'federal' | 'other'
                                            + HolidaySuggestion.group; HolidayProposalItemView.group + preChecked
shared/src/domain/agency-onboarding.ts      (keeps calendarSkipped / hrPolicySkipped)
shared/src/notifications/render.ts          href → /settings/hr?proposal=YYYY (+ render.spec fixture)

api/src/common/working-days/
  holiday-suggestions.ts                    + groupHolidaySuggestions(): two instances, merge by date, substitute pairing
  holiday-suggestions.unit-spec.ts          + the cases in §5
api/src/hr/agency-calendar.service.ts       suggestions() → grouped; confirmProposal unchanged; toProposalView defaults group/preChecked
api/src/hr/schemas/agency-calendar.schema.ts + HolidayProposalItem.group, .preChecked (optional, defaulted)
api/src/worker/functions/propose-next-year-holidays.fn.ts  items carry group + preChecked
api/src/platform/dto/onboard-agency.dto.ts  − timezone (+ unit spec: a sent zone is ignored)
api/src/platform/agency-provisioning.service.ts − timezone branch, − assertMongoKnowsTimeZone import
api/src/hr/hr.module.ts                     − HrCommonModule, − two controllers
api/test/hr-settings.e2e-spec.ts            − leave policies block; + grouping / custom-range / proposal pre-check cases
api/test/agency-onboarding.e2e-spec.ts      − LeavePolicy; + "ignores a sent timezone"

web/src/features/agency-setup/
  AgencySetupSteps.tsx                      steps: brand · email · carriers · timezone · holidays · finish
  TimeZoneStep.tsx                          new — saves on select
  HolidayStep.tsx                           new — RegionPicker + HolidayPicker, one POST on Continue (replaces CalendarStep.tsx)
  InviteWizard.tsx / AgencySetupPage.tsx    Continue on `holidays` triggers the step's save before advancing (a step-level `onContinue`)
web/src/features/hr/settings/
  HrSettingsPage.tsx                        Calendar only, ?proposal=
  calendar/HolidayPicker.tsx                new — the shared three-section picker
  calendar/RegionPicker.tsx                 new — country/region selects lifted out of WorkweekCard
  calendar/HolidayImportDialog.tsx          hosts HolidayPicker (source 'import')
  calendar/ProposalBanner.tsx               hosts HolidayPicker (no custom section), "Confirm N"
  calendar/WorkweekCard.tsx                 uses RegionPicker
shared/src/domain/holiday-range.ts          expandHolidayRange(start, end, workweek) → dates — pure, in shared because
                                            the web package has no test runner (its `lint` is tsc only) and shared has jest
shared/src/domain/holiday-range.spec.ts
web/src/features/platform/onboard/
  onboard-schema.ts, steps/AgencyStep.tsx, steps/ReviewStep.tsx   − time zone
  module-catalog.ts                         Hr copy
web/src/features/settings/settings-sections.ts   HR copy
web/src/lib/hr-api.ts                       − policy calls

bruno/HR/                                   − 7 policy requests; Get Holiday Suggestions docs + tests for `group`;
                                            + Add Calendar Days (Custom range).bru
bruno/Platform Agencies/Onboard Agency.bru  body drops `agency.timezone` (line 26), the test asserting it (line 116) and the
                                            two docs paragraphs that describe it (lines 145, 191)
```

## 4. Build order (each a commit; gate before the next)

1. **Salvage.** Branch off `dev`; `git merge --squash asad/pac-161-hr-foundation`;
   restore `docs/SESSION-HANDOFF.md`; remove the v1 plan file and every path in
   decision 2; fix the imports that fall out (`HrModule`, `hr-api.ts`,
   `shared/index.ts`, the two e2e specs, `HrSettingsPage`, `AgencySetupSteps`).
   Gate: `npm run build -w @sfa/shared && npm run build -w @sfa/api && npm run build -w @sfa/web`,
   `npm run lint -w @sfa/api` (eslint only — it does not typecheck),
   `npm run test:unit -w @sfa/api`. Commit as "feat(hr): agency calendar
   foundation — salvaged from PAC-161 v1 without the leave-policy half".
2. **Grouping on the API.** `groupHolidaySuggestions` + unit spec; the service,
   the schema fields, the job, the shared types, `render.ts` href. Gate: unit
   specs + the `holiday suggestions and days` and `holiday proposals` e2e
   blocks (`npm run test:e2e -w @sfa/api -- hr-settings`; sandbox off, no live
   `api:dev` on the same DB, per the `e2e-runs-share-one-database` memory).
3. **Time zone out of the Super Admin wizard.** DTO, provisioning, both unit
   and e2e tests, the three web files, the Bruno request body + docs. Gate:
   `onboard-agency.dto` unit spec, `agency-onboarding` e2e, web build.
4. **`HolidayPicker` + `RegionPicker` + `holiday-range.ts`** in settings first:
   import dialog and proposal banner on the new component, `WorkweekCard` on
   `RegionPicker`, `HrSettingsPage` without tabs. Gate: web build + lint; walk
   `/settings/hr` in the browser pane on `localhost:5173` (Asad's dev servers
   are already running) as the demo Branch Manager: import for 2026 and 2027
   for a Texas region shows one row on 2027-12-24, "Confirm N" on a seeded
   proposal, a custom "Winter closure" Dec 24 – Jan 2 writes only the
   workweek days and shows in both years.
5. **Owner wizard: `TimeZoneStep` + `HolidayStep`**, step list, the two hosts'
   Continue handling. Gate: run the invite flow end to end — Super Admin
   onboards an agency (no time zone field), copy the local `inviteToken` from
   the 201, accept as the owner, see brand → email → carriers → time zone →
   holidays → finish; check `agencies.timezone` changed on select,
   `agencyCalendarDays` rows carry `source: 'onboarding'`, `setup.calendarSkipped`
   false after a Continue and true after a Skip (two runs). Then
   `/welcome/agency` for an owner who left mid-wizard.
6. **Bruno.** Delete the policy requests, update `Get Holiday Suggestions`,
   add the custom-range request; `cd bruno && npx @usebruno/cli run --env Local`
   (needs the demo seed; `HR/Add Calendar Days` 409s on a re-run against a
   date it already wrote — not a code failure).
7. **Docs + PR.** Update this file's "As built" section; `packages/web/CLAUDE.md`
   keeps the FullCalendar exception line the squash brought. PR body: what
   changed vs v1, the three UI calls (§6), the verification runs. Do not touch
   `docs/SESSION-HANDOFF.md`.

## 5. Tests

**Unit (`holiday-suggestions.unit-spec.ts`)**, against real `date-holidays`:
- US national 2026 → 12 federal rows, none sharing a date; 2027 → 15, with the
  four substitutes flagged.
- `OK` 2026 → "Washington's Birthday" (federal label) on 02-16, no
  "Presidents' Day" row; "Day after Thanksgiving" in `other`.
- `TX` 2027 → exactly one row on 12-24, federal, "Christmas Day (substitute
  day)"; "Christmas Eve" absent; "Day after Christmas" in `other`.
- `IL` 2026 → four state `public` extras in `other`, unchecked.
- Substitute pairing: 2026-07-04 unchecked with the weekend note, 2026-07-03
  checked; 2027-12-31 checked with no partner.
- No region → `other` holds only `observance` / `optional` / `bank` rows.
- Every output row has a unique date (the batch DTO's invariant).

**Unit (shared, `holiday-range.spec.ts`, `npm test -w @sfa/shared`)**: a range
over a weekend skips Sat/Sun for the Mon–Fri workweek and keeps them for a
seven-day workweek; end < start refused; 60-day cap; a range crossing the year
boundary. Rebuild shared before the e2e and Bruno runs — they read `dist`.

**e2e (`hr-settings.e2e-spec.ts`)**: suggestions for `US`/`TX` 2027 carry
`group`, one row per date, `preChecked` only on federal non-weekend rows;
importing the pre-checked default set for `TX` 2027 returns 201 (the v1
regression); a proposal's items carry `group`/`preChecked` and a confirm of the
pre-checked subset writes exactly those; the `agency setup flags` block still
echoes `calendarSkipped` / `hrPolicySkipped`.

**e2e (`agency-onboarding.e2e-spec.ts`)**: onboarding with `agency.timezone:
'Asia/Kolkata'` in the body creates the agency on `America/Chicago`.

**Unit (`onboard-agency.dto.unit-spec.ts`)**: the parsed body has no
`timezone` key whatever was sent.

## 6. UI calls to put to the owner in the PR (we own UI/UX)

- The holiday step is a list, not the settings calendar: an owner setting up an
  agency should tick holidays, not learn a year grid.
- Weekend days inside a custom range are not written (decision 10).
- "Confirm N" replaces "Confirm all" on the Q4 banner (decision 11).
- The time-zone step saves on select with no Save button (decision 5).

## 7. Open points for Asad (decide before the matching commit)

1. **Half-day custom holidays** (epic open point 1). Plan: all-day only; a
   `hours` window on `AgencyCalendarDay` can be added later without a
   migration. Decide before commit 4.
2. **Custom range skips non-workweek days** (decision 10). Alternative: write
   every day in the range. Decide before commit 4.
3. **Step order**: brand → email → carriers → time zone → holidays (epic §1)
   versus time zone first of all. Plan follows the epic. Before commit 5.
4. **Region line in the holiday step** with an expandable country/region
   picker, versus trusting the branch-address pre-fill and hiding the pickers.
   Plan: show the line, pickers collapsed. Before commit 5.
5. **The two untracked story docs** (`docs/plans/pac-148-*.md`): commit on
   `dev` first, or leave them out of this PR? Before commit 1.
6. **Pre-check the federal set only** in the Q4 proposal (plan), versus Gusto's
   "carry forward what the agency ticked last year". The carry-forward is a
   better product and a small follow-up: compare this year's rows by label.
   Not in this ticket unless Asad wants it now.

## 8. Follow-ups this ticket leaves ready (not in scope)

- **PAC-174**: a `common/hr/` policy reader, the `hr-policy` wizard step
  (`hrPolicySkipped` is already stored), a "Time off policies" tab or section
  beside the calendar at `/settings/hr`.
- **PAC-165**: `AgencyCalendarService.addDays` is the seam for "a new closure
  flags approved leave"; `WorkingDaysService.scheduledDaysBetween` computes
  requested hours; `PermissionHoldersService.usersHolding(agencyId, 'hr:write',
  { branchId, exceptUserId })` is the reviewer list.
- **PAC-169**: reads `agencyCalendarDays` by range through the
  `{ agencyId, removedAt, date }` index; FullCalendar exception already in
  `packages/web/CLAUDE.md`.
- **Q4 carry-forward** (open point 6).

## 9. Known traps carried over from v1 (read before building)

- `date-holidays` region codes are **upper-case** and an unknown code does not
  throw — `isKnownCountry` / `isKnownRegion` guard every entry point.
- `strictBindCallApply` is off in the API tsconfig: `hasOwnProperty.call`
  returns `any` and the lint boundary refuses it; use `Object.keys(...)`.
- A watch-mode API restart mid-migration leaves a stale `migrations_lock` for
  five minutes; stop `api:dev` before any migration work (none planned here).
- The batch DTO 400s a duplicate date **within one request** and the service
  409s a date already on the calendar — the picker must enforce one row per
  date on the client (a custom row on a ticked suggestion's date).
- Every reader of `agencyCalendarDays` spells out `removedAt: null`; the
  unique index is partial on it (`partial-index-queries-need-type` memory).
- `.lean()` applies no schema defaults: `setup.calendarSkipped` and the new
  `HolidayProposalItem.group` must be defaulted in the mapper.
- `AgencyCalendar.agencyId` is a **string** (TenantRecord convention);
  `User.agencyId` is an ObjectId — a raw query written the wrong way matches
  nothing.
- The web `lint -w @sfa/api` autofixes and already exits 1 on a clean tree
  (memory `api-lint-autofixes-and-fails`); diff the count, do not trust the
  exit code alone.

## As built (2026-11-03, branch `asad/pac-161-agency-holiday-calendar`)

Seven commits in the order of §4 (plus one fix), each green on its own.

| Topic | Plan | Built | Why |
|---|---|---|---|
| Salvage (§2.1–2) | squash, delete the policy half | As planned; zero conflicts, lock unchanged by `npm install` | — |
| Bruno README | not mentioned | HR folder rows added | v1 never added them; the collection rule says the README is the index |
| Substitute pre-check (§2.8) | pair by package `rule` | Pair by `rule` **and** the original must fall on a Sat/Sun | 2027 holds New Year's Day (Fri 01-01) and the 2028 substitute (Fri 12-31) under one rule; the rule-only pairing unticked the Friday original — found in the browser walk, fixed in `729cfcf` with a unit case |
| `HolidaySuggestion` wire shape (§2.9) | `+ group` | As planned | — |
| Custom range "To" (§2.10) | end defaults to start | `end` optional on the form, blank = single day | The first form made the field required while its hint said "leave empty" |
| Custom range collisions (§2.10) | refused in the client | Refused on Add, naming the day and what holds it ("Fri 24 Dec 2027 is already Christmas Day (substitute day).") | Verified in the browser |
| Cross-year invalidation (§2.10) | both years | every `['hr','calendar']` query | Simpler and the page holds one year at a time |
| Proposal review (§2.11) | picker without custom | As planned; banner reads "Confirm the N federal holidays now…" | — |
| Pre-v2 proposals (§2.3) | derive from `type` | As planned | A v1-written Illinois proposal on the local dev DB reads 18 of 29 as "federal" because the state's own `public` days count — dev-only, no shared DB holds a proposal |
| Step ids (§2.13) | `calendar`, drop `hr-policy` | `timezone` + `holidays`; `calendar` renamed; `hr-policy` dropped; `SKIP_FLAG_BY_STEP.holidays = calendarSkipped` | The step is a list of holidays, not the calendar |
| Continue hand-off (§3) | "a step-level `onContinue`" | `AgencySetupStepHost` context + `useStepContinue(handler, busy)`; the hosts run the handler and advance on `true`, disable the footer while busy | Both hosts stay dumb about which step writes |
| Region change in the step (§2.6) | collapsed picker | Collapsed behind "Change"; a change saves through `PATCH /hr/calendar` at once and re-queries the suggestions | Same save-on-select idiom as the time zone |
| Open points (§7) | — | Defaults taken for all six: all-day custom holidays; non-workweek days skipped; order after carriers; region line collapsed; the two PAC-148 story docs left **untracked**; Q4 pre-check federal-only | None answered before the build; each is reversible in its own commit |

Verification runs: shared jest 320 (6 new), api unit 1448 + 21 grouping cases,
api e2e `hr-settings` / `propose-next-year-holidays` / `agency-onboarding`
(49 passed) and `api.e2e-spec` + `agency-profile` after the last commit, web
`tsc` on every commit, api eslint (no findings in touched files; the
pre-existing ones are untouched), Bruno full collection on a demo-seeded
database (every `HR/` and `Platform Agencies/Onboard Agency` test green; the
collection's other failures are its negative cases and the local
no-Resend / no-Inngest environment). Browser: `/settings/hr` as the demo
Branch Manager (Texas 2027 import shows one row on 12-24, "Import 12",
collision refused, "Winter closure" Dec 27 – Jan 3 writes 6 workweek days
across both years, "Confirm 18" + review without a custom section), and the
whole invite flow for a fresh agency (no time-zone field in the Super Admin
wizard; owner: brand → email → carriers → time zone (saved on select, Denver)
→ holidays (Texas pre-filled, 11 `onboarding` rows) → finish;
`setup.calendarSkipped: false`; `/welcome/agency` reads as already set up).

Not run: the Skip path of the holiday step in the browser (the flag path is
the `agency setup flags` e2e case, and the host code for Skip is unchanged).

## v3 — holidays and work weeks become time off policies (2026-11-03)

Asad on the open PR: the `/settings/hr` page (workweek card + year grid +
import dialog + Q4 banner) is "way too complex for something so simple", and
holidays should not be agency-wide. Decided in session:

| Question | Answer |
|---|---|
| Where it lands | This PR (PAC-161). The Time off policy *type* is listed and counted, its creation is PAC-174 |
| How holidays are stored | **Recurring by rule**, Gusto-style: a policy stores holiday *keys*; every year's dates are computed. No dated rows, no Q4 proposal |
| Owner wizard Holiday step | **Removed.** The wizard keeps the Time zone step |
| Closures / special working days / agency workweek | Closures come with the agency calendar page (PAC-169); the workweek is a Work week policy |

### Model

- **One collection per policy type** (Asad, 2026-11-04 — first built as a
  single `timeOffPolicies` collection with a `type` field, split before merge
  so a document can only carry its own type's rules):
  - `holidayPolicies` — `agencyId` (string), `name`, `holidays: HolidayKey[]`,
    `customHolidays: [{ id, name, start, end, repeatsYearly }]`, `memberIds`.
  - `workWeekPolicies` — `agencyId`, `name`, `days: [{ weekday, start, end }]`,
    `memberIds`.
  - `PolicyRecord` (`hr/schemas/policy-record.schema.ts`) is every policy
    type's base: `name`, `archivedAt/By` (soft archive, PAC-155), timestamps
    and authorship. Holiday and Work week extend `MemberListPolicyRecord`,
    which adds the embedded `memberIds`. Indexes on each: `{agencyId,
    archivedAt}` and `{agencyId, memberIds}`.
  - PAC-174 adds `timeOffPolicies` on `PolicyRecord` alone, with enrolment in
    its own `timeOffEnrollments` collection (a person can be in several, and
    each enrolment has a start date and starting balance). Noted on PAC-174.
  - The wire contract is unchanged: `GET /hr/policies` reads both and merges,
    and a policy id is looked up in each.
- **A person is in at most one active Holiday and one Work week policy.**
  Enrolling someone in another policy of the type *moves* them (the save
  `$pull`s them elsewhere); the wizard says "Moves from X" first. No Work week
  policy → Mon–Fri 9–5; no Holiday policy → no holidays.
- **`shared/domain/us-holidays.ts`** — 11 federal + 4 common holidays
  (Good Friday, Day after Thanksgiving, Christmas Eve, New Year's Eve) by
  rule; fixed-date federal holidays observed Sat→Fri / Sun→Mon (New Year's on
  a Saturday lands on 31 Dec of the year before); one row per date, federal
  name wins; custom holidays are all-day ranges ≤ 31 days, one-off or every
  year (29 Feb → 28 Feb), every day listed (the week decides what is a
  working day). Pure, shared by web and API. `date-holidays` is gone.
- **`WorkingDaysService.forPerson(agencyId, userId, range)`** — the snapshot
  and schedule from that person's two policies; the pure `working-days.ts`
  arithmetic is unchanged.

### HTTP (`agency:hr:admin`, module `hr`, `@SkipBranch`)

`GET /hr/policies?type=` (list + every type's count) · `GET /hr/policies/people` ·
`GET /hr/policies/:id` · `POST /hr/policies` (discriminated on `type`) ·
`PATCH /hr/policies/:id` · `POST /hr/policies/:id/archive` (204). Bruno `HR/`.

### Web

- `/settings/time-off` (hub card "Time off"; `/settings/hr` redirects): three
  cards with active counts — clicking one filters the list (`?type=`, again to
  clear) — each with its own Create button, plus a "Create policy" menu.
  Table: name, type, a one-line rules summary ("12 days off in 2026 · next
  Thanksgiving Day, Nov 26" / "Mon–Fri · 9:00 AM – 5:00 PM · 40h a week"),
  people, ⋯ Edit / Archive.
- Stepped wizard (`/settings/time-off/new/holiday|work-week`,
  `/settings/time-off/:id`) with Gusto's bar-per-step header. Holiday:
  1 Select federal holidays (all ticked for a new policy, next date beside
  each) · 2 Add custom holidays (the common extras, your own, and the year as
  a list) · 3 Add employees. Work week: 1 Set the work week (a switch and
  hours per weekday, "Copy to all days") · 2 Add employees. Nothing is
  written until Save; editing makes every step reachable and adds "Save
  changes" on each.

### Removed

Agency calendar schemas, controller, service and DTOs; `holiday-suggestions`
and `date-holidays`; the Q4 `ProposeNextYearHolidaysFn` job and the
`hr.holidays_proposed` notification; `PermissionHoldersService` (its only
caller was that job — PAC-165 can bring it back from `01d4662`);
`ensureAgencyCalendar` on every provisioning path; `holiday-range.ts`; the
owner wizard's Holiday step and the `calendarSkipped` / `hrPolicySkipped`
flags; the whole `features/hr/settings/` tree. Migration
`20261103120000-drop_agency_calendars` drops `agencyCalendars` /
`agencyCalendarDays` (the `hr_module` migration that creates them is
immutable). The demo seed now enrols the whole team in "Paid holidays"
(federal + Day after Thanksgiving) and "Standard week" (Mon–Fri 9–5).

### Verification (2026-11-03)

shared jest 325 (13 new holiday cases); api unit 1436; api e2e
`time-off-policies` (14) + `agency-onboarding` + `agency-profile` (60 in
all); Bruno `HR/` 13 requests / 21 tests against a demo-seeded database; web
`tsc` + build; browser walk on a branch API as the demo Branch Manager: cards
and filter, create a holiday policy with extras and a Dec 28–31 closure,
enrol two people (moved out of "Paid holidays", 12 → 10), edit with step
jumps, the work week step, light and dark.

### Follow-ups

- PAC-174: the `time_off` type's wizard (the card and filter already exist).
- PAC-165: an employee's own holidays/hours read, and the reviewer list
  (`PermissionHoldersService`, removed here).
- PAC-169: closures and special working days on the agency calendar page
  (the snapshot already understands both kinds).
- `common/dates/business-days.ts` (audit aging) still has its own federal
  list; it could read `us-holidays.ts`.
