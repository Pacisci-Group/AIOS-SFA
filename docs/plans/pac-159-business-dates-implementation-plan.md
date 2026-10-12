# PAC-159 — Remove `soldDateYmd` / `quoteDateYmd`, bucket on timestamps, editable quote + lead dates

Ticket: https://linear.app/paciscigroup/issue/PAC-159 (Todo, assigned to Asad). Paths relative to repo root; `api/` = `packages/api/src`, `web/` = `packages/web/src`, `shared/` = `packages/shared/src`.

## Context

`deals.soldDateYmd` and `quoteRecaps.quoteDateYmd` are `YYYYMMDD` integers kept beside the real `soldDate` / `quoteDate` so scorecards can run an integer range instead of per-row timezone maths. They are the only two Ymd fields in the database. They force a stored-once calendar label (an agency zone change leaves sales and quotes frozen while leads re-bucket), an exact-UTC-midnight discriminator hack (`quote.normalize.ts isUtcMidnight`, `leadCreatedYmdExpr`'s `$mod` branch, `cells.ts agencyCalendarDate`), and they are why `quoteDate` was never editable. David's request (a quote is sometimes given before the record is typed in) needs the date editable; Asad's principle is that every business date must be correctable or analytics drift.

Outcome: every business date is a UTC instant, readers compute window bounds once in Node from `access.timeZone` and run a plain indexed `Date` range; quote date and lead date become inputs on create and editable afterwards, with cross-checks; one migration re-stamps day-only values and drops the integers.

### Decisions fixed in this session (2026-10-12)

| # | Decision |
|---|---|
| D1 | **Day anchor = agency-local midnight** (Asad). A day-only entry `2026-10-06` for a Chicago agency is stored as `2026-10-06T05:00:00Z`. Known consequence: `ActivityTimeline.formatWhen` renders browser-local time, so a viewer west of the agency sees back-dated rows as 11 PM the previous day. Mitigated for the lead-detail *cards* by D6; the timeline itself stays as is. |
| D2 | **One PR** (Asad), on branch `asad/pac-159-remove-solddateymd-quotedateymd-bucket-on-the-timestamps-and`, committed in the order of §Commit order so the build stays green at each step. |
| D3 | **`parseFormDate` is left untouched.** It is shared with policy `effectiveDate` (`api/sold-deals/intake/upsert-policies.step.ts:75`) and prior-insurance `cancellation.effectiveDate` (`prior-insurance.step.ts:133,219`), which are calendar-only facts exported as `utcDate`. A new `businessDateInstant(isoDate, timeZone)` serves `soldDate` / `quoteDate` / `createdDate` only. Same for `changeDate` / `dateOnly` / `policyDate`: they keep formatting `utcDate` fields; business dates get a new `businessDay(instant, timeZone)`. (Deviation from the ticket's §1/§3 wording; the ticket's intent is met.) |
| D4 | **`YmdRange` stays** as the calendar-day range (UI echo, aging cutoff, goal pacing, bucket zero-fill all need calendar days). Only the `$match` changes: a new `instantWindow(range, timeZone)` turns it into `{ $gte: Date, $lt: Date }`. |
| D5 | **Migration re-stamps from the stored integer when present**, not from UTC parts: the SmartSuite import wrote `soldDateYmd` from SmartSuite's own formula column first (`migration.service.ts:1889`), so the int, which every scorecard has reported, is the fact to preserve. Done in Node with a copied-in `zonedDayStart` (repo convention: migrations copy helpers, never import TS). |
| D6 | Lead detail emits `soldDate` / `quoteDate` / `createdDate` as **agency-calendar `YYYY-MM-DD`** strings (web `formatDate` already passes date-only strings through; the sold edit view already does this at `sold-deals.service.ts:558`). Removes the browser-zone day shift on the cards. |
| D7 | The web learns the agency zone from the session blob: `timeZone` is added to `toAuthUser` (`api/auth/auth.service.ts:419`, from `access.timeZone`) and `AuthUser` (`web/lib/api-client.ts:97`); a new `web/lib/dates.ts agencyTodayYmd(timeZone)` (Intl) feeds every date input's default and `max`. |

Out of scope, noted for the PR description: `isWithinClawbackWindow` (`shared/domain/policy-replacement.ts:104`) uses `startOfUtcDay(soldDate)` and is off by a day for UTC+ zones; `producerGoals.month` stays a stored month key.

---

## Step 0 — ticket and plan document

1. Save this plan as `docs/plans/pac-159-business-dates-implementation-plan.md` (house style of `docs/plans/pac-152-*.md`) and link it from `AGENTS.md` §10.
2. Comment on PAC-159 (Linear MCP) with D1–D7 so the ticket matches what is built.

## 1. Primitives (`api/`), with unit specs — no behaviour change yet

- **`performance/performance.range.ts`**: add `instantWindow(range: YmdRange, timeZone): { $gte: Date; $lt: Date }` = `zonedDayStart(fromYmd(startYmd|endYmd), tz)`. Refactor the two existing copies onto it: `management-dashboard.service.ts:615-620 overduePrefix` and `analytics/service-analytics.service.ts:439-443`. Rewrite the module docblock (L1–30) — stored labels are gone. Add `agencyTodayIso(timeZone)` = `toIsoDate(zonedDate(new Date(), tz))` (the idiom at `management-dashboard.service.ts:328` becomes a named helper).
- **`common/dates/business-dates.ts`** (new): `businessDateInstant(isoDate, timeZone): Date` = `zonedDayStart(parseIsoDate(iso), tz)`; `businessDay(instant, timeZone): 'YYYY-MM-DD'` = `toIsoDate(zonedDate(...))`; `businessDaysDiff`. Docblock states the convention (UTC instant, day-only entries at agency-local midnight, bucketed on read).
- **`common/sales-metrics/sales-pipelines.ts`**: add `dateWindow(field, range, timeZone)` beside `ymdWindow` (which stays for `createdYmd`).
- **`activities/change-log.ts`**: `ChangeFieldSpec.read(subject, ctx: { timeZone })`; `snapshot(spec, subject, ctx)`; add `changeBusinessDate(value, timeZone)` (= `businessDay`). Rewrite the "one-way door" docblock (L21–29) and the L12 comment.

## 2. Readers → `Date` ranges (one commit each; e2e seeds gain an instant in the same commit, Ymd still seeded so both pass)

Replace every `ymdWindow('soldDateYmd' | 'quoteDateYmd', range)` / inline `$gte startYmd` with `dateWindow('soldDate' | 'quoteDate', range, access.timeZone)`:

- `performance/performance.service.ts` `rollup()` L95–113 — `dateField: 'soldDate' | 'quoteDate'`; docblock L90–93.
- `common/sales-metrics/sales-matches.ts` `soldMatch` L64 / `quotedMatch` L79 gain a `timeZone` parameter (callers: owner-dashboard, management-dashboard, analytics `soldScope`/`quotedScope`, all already hold `access`).
- `leaderboard/leaderboard.service.ts` L215 — `customRange` + `instantWindow(range, access.timeZone)`.
- `management-dashboard/management-dashboard.service.ts`: `AgingDealLean` L130/158 (`soldDate`), sort L335 → `{ soldDate: 1, _id: 1 }`, `businessDaysOpen` L356 → `businessDaysBetween(zonedDate(deal.soldDate, tz), today)`, `agingPrefix` L586–608 keeps the `Math.min(range.endYmd, cutoffYmd)` on the calendar range and then calls `dateWindow`. `management-dashboard.pipelines.ts:113` docblock + unit spec. `common/dates/business-days.ts:170-176` docblock.
- `analytics/sales-analytics.service.ts` L543/L605: `ymdBucketExpr('soldDateYmd' …)` → the existing `instantBucketExpr('soldDate', interval, tz)`; delete `ymdDateExpr` / `ymdBucketExpr` from `analytics/time-buckets.ts:31-57` + their unit cases.
- `common/data-export/`: `engine/dataset.types.ts:39` drop the `'ymd'` kind; `engine/date-window.ts:41` case removed; datasets switch `sold_date` / `quote_date` to `kind: 'instant'` on `soldDate` / `quoteDate` (`sold-deals.dataset.ts:159-214` incl. `sold_year/month/month_name` via `zonedDate`; `quote-recaps.dataset.ts:81-86` conversion match becomes a calendar-day compare `businessDay(soldDate) >= businessDay(quoteDate)`, L105–109, L163, L277–288 `days_to_close` via `businessDaysDiff`; `leads.dataset.ts:317,344`; `policies.dataset.ts:224`); `engine/lookups.ts:476-500` sorts on `quoteDate` / `soldDate`; `engine/cells.ts` delete `ymdDate` and the midnight rule in `agencyCalendarDate`; `columns.ts:253 daysBetweenYmd` → calendar-date diff. Unit specs `cells.unit-spec.ts`, `date-window.unit-spec.ts`.
- `leads/leads.service.ts:537-551 buildDateRange` — UTC day bounds → `zonedDayStart` bounds in the agency zone.
- `leadCreatedYmdExpr` (`sales-pipelines.ts:341`) — delete the `$mod … 'UTC'` branch; rewrite docblock L322–340. Safe because migrated leads' `createdAt` is the Mongoose insert time (`lead.schema.ts:145`), never UTC midnight, and §4 re-stamps `createdDate`.

## 3. Writers stop writing Ymd; schema + seeds

- `sold-deals/intake/sold.normalize.ts`: delete `soldDateYmd()` and `DealAggregates.soldDateYmd`; `deriveDealAggregates` takes `timeZone` and sets `soldDate: businessDateInstant(dto.soldDate, tz)`. `resolve-deal.step.ts:52`. `sold-deals.service.ts updateSoldDate` L558–573 writes only `soldDate`; the no-op check becomes `businessDay(deal.soldDate, tz) === dto.soldDate`; docblock L521–547. `deal-change-log.ts:42-50` → `changeBusinessDate`.
- `quote-recaps/quote.normalize.ts`: delete the file (only `quoteDateYmd` + `isUtcMidnight`) and its unit spec. `quote-recaps.service.ts` create L749 and the backfill L536–538 go; docblocks L144–161, L435–473.
- `migration/migration.service.ts`: L1740 and L1889 removed; `soldDate` / `quoteDate` / lead `createdDate` (L1344) and the three activity `occurredAt`s (L1385, L1783, L1928) become `businessDateInstant(<iso day>, ctx.timeZone)` for date-only SmartSuite values (the import must not recreate UTC-midnight rows on a fresh database). `migration/smartsuite/field-ids.ts:113` drop `soldDateYmd`; `helpers/value-utils.ts:186 toYmd` + `mappers.unit-spec.ts:232`.
- `seed/demo/demo-seed.service.ts` L968, L1084–1085: drop Ymd; `ymd()` L2341 deleted (it used the server clock); day-only seeds go through `businessDateInstant(…, ctx.timeZone)`.
- Schemas: delete the props + the five Ymd compound indexes (`deal.schema.ts:93-95, 332, 341, 348`; `quote-recap.schema.ts:205-219, 239, 242`); add `{ agencyId: 1, soldDate: -1 }`, `{ agencyId: 1, businessType: 1, soldDate: -1 }`, `{ agencyId: 1, quoteDate: -1 }`, `{ agencyId: 1, quoteRecapId: 1 }` (`{ agencyId, producerId, soldDate }` L323 and `{ agencyId, producerId, quoteDate }` L231 already exist). Rewrite the "do not reorder" docblocks.
- Docblocks that describe stored labels: `platform/schemas/agency.schema.ts:393-399` (now: a zone change re-buckets sales, quotes and leads alike; only `producerGoals.month` is frozen), `agency-profile/agency-profile.service.ts:36-38`, `seed/provision-tenant.ts:63-67`, `common/dates/mongo-time-zone.ts:12`, `quote-recaps/dto/update-quote-recap.dto.ts:13-30`, `quote-recaps.controller.ts:113-131`, `sold-deals.controller.ts:150-159`.
- Remove Ymd from every test seed (list in §Verification).

## 4. Migration — one file, `npm run db:migrate:create -- business_dates_agency_midnight` (stop `api:dev` first)

Raw `db` handle, idempotent, `down` throws. Copy in `zonedDayStart` + `fromYmd` from `performance.range.ts` (plain JS). For each row of `agencies` (`timezone` guaranteed by `20260924233638`), with `agencyId` as a **string**:

1. **Re-stamp day-only rows.** For `deals.soldDate` and `quoteRecaps.quoteDate`: rows where the field is `$type: 'date'` and at exact UTC midnight (`$expr: { $eq: [{ $mod: [{ $toLong: '$soldDate' }, 86400000] }, 0] }`). New value = `zonedDayStart(fromYmd(soldDateYmd ?? utcYmd(soldDate)), tz)` (D5). Before writing, count rows where the int disagrees with the UTC parts and log it. `bulkWrite` in batches (pattern: `20260908101946-backfill_renewal_anchors.js`). Same for `leads.createdDate` (no int; UTC parts) and, where `lastActivityAt` equals the old `createdDate`, move it too (`migration.service.ts:1346` set both from one value). Then `activities.occurredAt` for `type ∈ { sold, quoted, lead_created }` at UTC midnight, same rule (they were written from the same dates; matching by type is sufficient).
2. **Create the `Date` indexes first** with Mongoose-style names (`agencyId_1_soldDate_-1` …; pattern `20260910123159-queue-sort-indexes.js`), so there is never a window with no usable index.
3. **Drop every index whose key includes `soldDateYmd` / `quoteDateYmd`**, discovered via `indexes()` on `deals` and `quoteRecaps` (which exist differs per environment).
4. **`$unset` both fields** on every document.
5. Log counts per collection. Idempotent: step 1 matches nothing on a second run except for a UTC agency, where the rewrite is the identity; steps 2–4 are no-ops when already done.

Deploy note for the PR: stop the API **and the worker** before deploying to an existing database (old worker code reads the integers), as for the mailer-campaigns backfill. Rehearse on the local prod dump, never production.

## 5. Quote date: input on create, editable on PATCH (ticket §1)

- `shared/domain/quote-recap.ts CreateQuoteRecapInput` + `quote-recap-edit.ts UpdateQuoteRecapInput` gain `quoteDate: 'YYYY-MM-DD'` (required on create, optional on update; drop the read-only note L72–77). Export the `ymd` zod rule from `create-sold-deal.dto.ts:36` into a shared `common/dto/` helper and reuse in `create-quote-recap.dto.ts`, `update-quote-recap.dto.ts`.
- `quote-recaps.service.ts create`: `quoteDate = businessDateInstant(dto.quoteDate, access.timeZone)`; `quoteDocument.uploadedAt` (L772) becomes `new Date()`; `recordQuotedActivity` keeps `occurredAt: recap.quoteDate`.
- `update` mirrors `updateSoldDate`: unchanged day → no write, no log; else set `quoteDate`, `moveQuotedActivity` (`updateMany { agencyId, quoteRecapId, type: 'quoted' } → occurredAt`; migrated rows carry only `legacySubjectId` and are not moved — note in PR), `RECAP_CHANGE_FIELDS` gains `{ field: 'quoteDate', label: 'Quote date', kind: 'date', read: (r, { timeZone }) => changeBusinessDate(r.quoteDate, timeZone) }`. No `advanceLeadStatus` re-run.
- Edit view / lead detail (D6): `getEditView` L374, `toLeadDetailQuoteRecap` L651, `lead-detail.service.ts:738,810,224` emit `businessDay(…, access.timeZone)`; shared types annotate the fields as date-only.
- Web: `QuoteRecapForm` gets the date as the first field (`TextField type="date"`; add `min`/`max` props to `components/form/fields/TextField.tsx`), default + `max` = `agencyTodayYmd(user.timeZone)` (D7); `quote-recap-schema.ts` (create + edit schemas, `toQuoteRecapFormValues`, `toUpdateQuoteRecapInput` sends `quoteDate` only when changed); `NewQuoteRecapPage`, `StartQuoteRecapStep`, `EditQuoteRecapPage` (invalidations L66–74 add `["leaderboard"]`; `NewQuoteRecapPage` L65–74 add `["performance"]`, owner/management keys, `["leaderboard"]`). `SoldDateCard` (`features/sold/components/WizardCards.tsx:61`) gets `max` and the same default (replace `localTodayYmd` at `SoldDealWizard.tsx:113`).
- Bruno: `Quote Recaps / Create Quote Recap.bru` sends `quoteDate`; `Update Quote Recap.bru` body + docs; new `Update Quote Recap (Quote Date).bru` asserting the recap moves month on `Performance / Get Performance`.

## 6. Date rules (ticket §1b) — `common/dates/business-date-rules.ts`

One helper comparing agency-calendar days (`businessDay`), returning a `BadRequestException` with the ticket's exact messages; same day always allowed; fires **only when the submitted day differs from the stored one** (never on a notes/premium edit):

- not in the future (`agencyTodayIso`);
- sale ≥ linked quote (`deal.quoteRecapId` only; a deal without one is checked against nothing);
- quote ≤ earliest `soldDate` among `deals { agencyId, quoteRecapId }` (new index, §3);
- lead floor: `soldDate` / `quoteDate` ≥ lead's `createdDate ?? createdAt` — only when the deal has a `leadId` (null on company transfers, `resolve-deal.step.ts:44-48`).

Wired into `POST /sold-deals` (also: load the recap by `{ _id, agencyId }` and 400 when it is not on `dto.leadId` — `sold-deals.service.ts:390` today only casts the id), `PATCH /sold-deals/:id`, `POST /quote-recaps`, `PATCH /quote-recaps/:id`. Unit tests per rule (earlier / same day / later / no linked quote / foreign recap). Bruno negatives: quote-after-sale, sale-before-quote, future, before-lead.

## 7. Lead date editable (ticket §1c)

- `POST /leads` (`leads/dto/create-lead.dto.ts` base schema + public form) takes required `createdDate: ymd`; `leads/intake/resolve-lead.step.ts:286` and `lead-intake.service.ts:281` (`lead_created.occurredAt`) use `businessDateInstant`. Not in the future.
- `PATCH /leads/:id` (`update-lead.dto.ts`, `LeadDetailService.update` L293): optional `createdDate`; rules: not future, ≤ earliest `quoteDate` / `soldDate` on the lead (`Lead date cannot be after the first quote/sale on this lead (<date>)`); unchanged → no write. `moveLeadCreatedActivity` (`{ agencyId, leadId, type: 'lead_created' }`). New `leads/lead-change-log.ts` `LEAD_CHANGE_FIELDS` = `createdDate` (date, "Lead date") + `status`, `temperature`, `leadSourceId` (text; source label via `LeadSourcesService.labelsFor`), written as `field_changed` / `subjectType: 'lead'` / summary `Lead edited` through the same best-effort pattern as `recordDealChanges` (`sold-deals.service.ts:945`). `UpdateLeadInput` / `UpdateLeadResult` (`shared/domain/lead-detail.ts:382-412`) gain the field.
- Web: `LeadIntakeForm` + `lead-intake-schema.ts` gain the date (first field, default/`max` agency today; also fix the DOB bound at L66 to use it); lead page shows "Lead date" with a pencil (pattern `EditContactDialog.tsx:126`), `useUpdateLead.ts` `applyLeadPatch` + invalidate `["leads"]`, lead detail, owner and management keys.
- Migration §4 already covers `leads.createdDate`.
- Bruno: `Leads / Create Lead` sends `createdDate`; `Update Lead` gains it + two negatives.

## 8. Tests, Bruno docs, docs

- Unit: `sold.normalize.unit-spec.ts` (L58–79, L205–212), delete `quote.normalize.unit-spec.ts`, `performance.range.unit-spec.ts` (+`instantWindow`, `agencyTodayIso`), new `business-dates.unit-spec.ts` (Chicago, Kolkata, UTC; DST days 2026-03-08 / 2026-11-01), `business-date-rules.unit-spec.ts`, `change-log.unit-spec.ts`, `deal-change-log.unit-spec.ts`, `time-buckets.unit-spec.ts`, `cells` / `date-window` specs.
- e2e seeds that today set only the integer must set an instant (add a test helper `anchor(iso, TIME_ZONE)` = `businessDateInstant`): `test/api.e2e-spec.ts` L4365–4430, L5002–5026, L7962, L8009–8057, L13324, L13954–14057, L14243–14271, L14414–14432, L14570, L14960; `test/owner-dashboard.e2e-spec.ts` L116, L134, L161–289 (the L110–112 comment describes the deleted rule); `test/analytics.e2e-spec.ts` L184–299; `test/worker/data-export.e2e-spec.ts` L377–407; `test/management-dashboard.e2e-spec.ts` L126–138, L447–450 (drop Ymd only). Replace every `expect(…Ymd)` with a scorecard assertion.
- New e2e: a sale and a quote booked at 11 PM agency time on the last day of a month land in that month; a back-dated one lands in its month; `explain()` on the scorecard, leaderboard and aging queries reports IXSCAN on the new indexes.
- Bruno docs blocks mentioning the fields (prose only): `Sold Deals/{Create Sold Deal, Update Sold Deal (Sold Date), Update Policy, Get Lead (Deal Totals After Patch)}.bru`, `Quote Recaps/Update Quote Recap.bru:159`, `Performance/Get Performance (This Month).bru:85`, `Owner Dashboard/Get Lead Sources.bru:115`, `White Label/Update Agency Profile.bru:71`.
- Docs: `docs/SESSION-HANDOFF.md:965-978`, `scripts/migration/README.md:80`, `.claude/skills/running-the-stack/SKILL.md:108` (sandbox write-denied: hand to Asad), `AGENTS.md` §10 + §11 (new convention bullet beside the "model the domain" rule), `packages/api/CLAUDE.md` if it mentions the labels.

## Commit order (build green at each step)

1. §1 primitives + unit specs + the two `instantWindow` refactors + `timeZone` on the session blob (D7).
2. §2 readers, one commit per service, each with its e2e seeds gaining an instant (Ymd still written and seeded).
3. §3 writers stop writing Ymd, schema props/indexes, seeds, helper deletions, docblocks.
4. §4 migration file.
5. §5 quote date input + edit, §6 rules, §7 lead date (API, then web, then Bruno for each).
6. §8 docs + remaining Bruno docs.

## Verification

1. `npm run shared:build`, then `npm run build -w @sfa/api` (lint does not typecheck) and `npm run lint -w @sfa/api -w @sfa/web`.
2. Unit: `npm run test -w @sfa/api`. e2e (sandbox off, no live `api:dev`, uses `sfa_test`): `npm run test:e2e -w @sfa/api`.
3. Migration rehearsal on the **local prod dump**: record Sold/Quoted scorecards, leaderboard, owner + manager dashboards and the analytics breakdowns for mtd / lastMonth / ytd on the old build; run the new build (migration applies at boot); compare — figures must match except for rows whose int disagreed with its UTC parts (logged by the migration). Confirm `db.deals.find({ soldDateYmd: { $exists: true } }).count() === 0`, same for `quoteRecaps`, and no `soldDate` / `quoteDate` / `leads.createdDate` / sold-quoted-lead_created `occurredAt` at exact UTC midnight for a non-UTC agency. Run the migration a second time via `npm run db:migrate -w @sfa/api` → no-op, one `migrations_changelog` row.
4. `explain('executionStats')` on the performance rollup, leaderboard and aging-audit queries → IXSCAN on `agencyId_1_soldDate_-1` family, no COLLSCAN.
5. Bruno: `cd bruno && npx @usebruno/cli run --env Local` (sandbox off; demo-seeded DB so the demo logins exist).
6. Browser (`localhost:5173`): New Quote form shows the date first, pre-filled with agency today, `max` = today; back-date a quote to last month → Quoted scorecard, leaderboard, owner dashboard and the lead timeline all move, one `Quote recap edited` row with `Quote date: a → b`; saving unchanged writes nothing; re-dating after the linked sale → field error; re-dating a sale before its quote → field error; same day accepted; producer gets 404 on another producer's recap. New Lead form asks for the lead date; editing it on the lead page writes `Lead edited` and moves the first timeline entry; a lead date after the first quote → error. Sold at 11 PM agency time on the 31st appears in that month regardless of browser zone.

---

## Implementation notes (2026-10-12, branch `claude/pac-159-implementation-plan-3cb50f`)

Built as planned, in six commits (primitives → readers → writers → migration → editable dates and rules → docs/Bruno/e2e). Where the build departed from the plan above:

- **`POST /leads` takes `createdDate` as optional, not required.** The New Lead form always sends it (pre-filled with the agency's today), the public share-link form never asks, and an absent value means now. Requiring it on the API would have broken every older client and the public route for no gain; the form is where the requirement belongs.
- **`IntakeContext.timeZone` is optional** for the same reason: the public path carries no day-only date, and `ResolveLeadStep` throws (`requireTimeZone`) rather than guessing if a date ever arrives without a zone.
- **The lead change log** resolves the lead source to its *name* by the caller (`LEAD_SOURCE_CHANGE_FIELD`) rather than through the spec's `read`, which is synchronous.
- **Bruno:** the quote day is computed in `Leads / Create Lead`'s post-response script, a folder ahead of its first use, so the body is interpolated from a variable that already exists. The collection's lead is dated **2026-01-05** so the February sale the Sold Deals folder books on it can never precede it. Against a copy of the dev database the only failures were the Management Dashboard `overdueTickets` card (zero on the old build too — stale demo data) and the Platform Mailer Campaigns folder (needs the worker).
- **Verification on real data:** the migration ran at boot against a `mongodump` copy of the dev database (1,679 deals, 698 recaps, 403 leads, 2,778 activities re-stamped in 7 s, every integer agreeing with its instant); all six dashboard reads (performance ytd and last month, owner summary ytd and last month, leaderboard, lead sources) returned **identical** figures before and after; `explain()` planned every scorecard, leaderboard and aging query on the new `Date` indexes; a second run was a no-op. Full API unit (1,318) and e2e (1,246 + 6 new) suites green; two e2e tests in the main spec are order-dependent and flake on a shared database independently of this change.
- **Still to do by hand:** `.claude/skills/running-the-stack/SKILL.md:108` still names `quoteRecaps.quoteDateYmd` (the skills directory is write-protected in this session). Stop the API **and the worker** before deploying to an existing database, then deploy; the migration runs at the new build's first boot.
- Out of scope, noted: `isWithinClawbackWindow` (`shared/domain/policy-replacement.ts`) still uses `startOfUtcDay(soldDate)`; `ActivityTimeline.formatWhen` still renders `occurredAt` in the browser's zone (a midnight-anchored row reads as 11 PM the previous day for a viewer west of the agency).
