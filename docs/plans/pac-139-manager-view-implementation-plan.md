# PAC-139 — Manager View dashboard ("Action Hub")

## Context

`/dashboard/management?view=manager` is still the Figma export byte for byte
(`packages/web/src/features/management/components/{ManagerDashboard,ProducerDrawer,GlobalFilterBar}.tsx`
+ `ManagerPrototype` in `ManagementDashboardPage.tsx`): six fake producers, fixture counts, inline
styles, undefined colour variables. David walked the page with Asad on 22 Sep (transcript 00:14–00:31):
it is a **read-only "checks and balances" summary** for the Office / Branch Manager — nothing on it
approves, sends back or edits anything (Deal Audits is a separate nav page, PAC-106). PR #121 already
shipped §6 of the ticket (user availability status). This plan is the rest: three alert cards with
side drawers, the Team Activity table counted in households, the producer drawer, and the Owner view's
filter bar reused — backed by a real `management-dashboard` API module.

Sources read: the ticket, the full 22 Sep scrum doc (notes + transcript), PAC-106/PAC-138, the PAC-135
plan and code, and the local prod dump (`sfa`).

## Decisions (settled with Asad 23 Sep; these override the ticket text where noted)

| # | Topic | Decision |
|---|---|---|
| D1 | **Stalled lead** | `lastActivityAt < now − 48h` **or `lastActivityAt` missing**, status **not terminal** (`terminalLeadStatusValues()` in `packages/shared/src/domain/lead-status.ts:149` — already expands raw codes), test records excluded. **Overrides the ticket's `updatedAt`**: `leads.service.ts:219` documents `updatedAt` as unusable (the migration stamped every imported lead with the import run time, the demo seed re-stamps it on every reseed, nothing indexes it). Prod dump: all 1,129 leads are >48h old; 266 Sold / 10 Closed / 7 Lost / 14 Not Qualified would otherwise sit on the card forever. |
| D2 | **Aging audit** | A **new-business deal sold in the period** whose `dealAudits` row has `auditStatus != 'Pass'` (Not Submitted, Pending, Fail all count — David 00:25:26 "any deal that is not completed by that time, that's aging") and whose `soldDateYmd` is before the business-day cutoff (more than 5 business days elapsed; weekends + US federal holidays excluded; Chicago calendar). A deal with no audit row is not aging. |
| D3 | **Overdue ticket** | One shared Mongo predicate mirroring `deriveStepStatus` (`crm/scheduling/step-status.ts:34`): stored `status:'overdue'` for plain or overridden tickets, **plus** onboarding/renewal steps with `completedAt: null` and `dueAt < now` and no `statusOverriddenAt`. Prod dump has 0 stored `overdue` and 1,134 open renewal steps — derived status is the whole card. `stats()` in `service-tickets.service.ts:725` is switched to the same predicate (it currently misses derived overdue). |
| D4 | **Open Audit Items** | **All-time backlog**: Σ `openFailedCount` over every audit of the producer's deals, regardless of sold date. The one number on the page the period chips do not move — label its sub-text "all open items". The producer drawer's list is the same set. |
| D5 | **Team roster** | Active users holding the `producer` role slug (branch-clamped under Branch scope) ∪ any `producerId` with a sale or quote in the window (deactivated → name via `namesFor`, availability `null` → `N/A`). Producer filter does **not** apply to the table (spec §5). |
| D6 | **Filters** | Period = created (leads) / sold (deals+audits) / opened (tickets) in window. Lead source: leads by `leadSourceId`; deals through the lead (`sourceStages`); tickets through `leadId` (most have none → drop under a source filter; documented). LOB: leads `policiesOfInterest.policyType` (empty on migrated leads → approximate, like the Owner view's quoted premium); deals `policyTypes`; tickets `policyType`. Person filter on tickets = `assignedUserId` (a CSR picked in the multi-select narrows tickets; ticket Q4 built this way). |
| D7 | **Producer drawer** | Active Pipeline = the producer's non-terminal leads created in the window (source/LOB applied), newest activity first, cap 50; stage = normalised lead status; LOB from `policiesOfInterest` else `N/A`; age = days since `createdDate`; value = latest quote recap premium for the lead else `N/A` (ticket Q8 assumptions). |
| D8 | **Row targets** | Stalled → `/leads/:id`; overdue → `/crm/tickets?ticket=<id>`; aging + open audit items → `/clients/:householdId` (no deal-audit route exists yet; PAC-106 adds it — non-link with tooltip when no household). |
| D9 | **Permission** | Add `management:read` to the Branch Manager template **and** a migrate-mongo migration upserting the `rolePermissions` row for every `branch_manager` role (self-applies on deploy; `api:sync:roles` for dev DBs). |
| D10 | **Shipping** | **One PR** into `dev`, branch `asad/pac-139-manager-view-dashboard`. Drop the "Live" pill; no auto-refresh. |

---

## 1. Shared (`packages/shared`) — build first (`npm run build -w @sfa/shared`)

- **New `src/domain/management-dashboard.ts`** (export from `src/index.ts` beside `owner-dashboard`):
  `MANAGEMENT_STALLED_HOURS = 48`, `MANAGEMENT_AUDIT_SLA_BUSINESS_DAYS = 5`,
  `MANAGEMENT_DRAWER_KEYS = ['stalled','aging','overdue']`;
  `ManagementAlerts { period: OwnerDashboardPeriod; stalledLeads; agingAudits; overdueTickets }`;
  `StalledLeadRow { leadId, name, status, producerId, producerName, householdId, leadSourceName, lastActivityAt, hoursSinceActivity }`;
  `AgingAuditRow { dealAuditId, dealId, householdId, clientName, producerId, producerName, auditStatus, openFailedCount, soldDate, businessDaysOpen }`;
  `OverdueTicketRow { ticketId, ticketNumber, clientName, category, assignedUserId, assignedRep, householdId, dueAt, openedAt, daysOverdue }`;
  `ManagementAlertList<T> { period, page, pageSize, total, totalPages, items }`;
  `TeamActivityRow { producerId, name, initials, availability: UserAvailability|null, householdsQuoted, householdsSold, householdCloseRatio: number|null, openAuditItems }`;
  `TeamActivityResponse { period, rows, totals }`;
  `ProducerPipelineLead { leadId, name, householdId, status, lineOfBusiness, ageDays, value, lastActivityAt }`;
  `ProducerOpenAuditItem { dealAuditId, dealId, householdId, clientName, itemTitle, daysOpen, soldDate }`;
  `ProducerDrawerResponse { period, producer: {producerId,name,initials,availability}, stats, activePipeline, openAuditItems }`.
- **`src/permissions/default-role-templates.ts:33-51`** — add `modulePermission(ModuleKey.Management, 'read')` to Branch Manager.

## 2. API (`packages/api`)

### 2.1 Business days — new `src/common/dates/business-days.ts` (pure) + `business-days.unit-spec.ts`
`usFederalHolidays(year)` by rule (New Year, MLK 3rd Mon Jan, Presidents 3rd Mon Feb, Memorial last Mon
May, Juneteenth, Independence, Labor 1st Mon Sep, Columbus 2nd Mon Oct, Veterans, Thanksgiving 4th Thu
Nov, Christmas; observed Sat→Fri / Sun→Mon); `isBusinessDay`, `addBusinessDays`, `businessDaysBetween`,
`agingCutoff(today, slaDays)` → the Ymd such that `soldDateYmd < cutoff` ⇔ more than `slaDays` business
days elapsed. Reuse `CalendarDate`, `addDays`, `toYmd`, `chicagoParts` from
`src/performance/performance.range.ts`. Spec: observed shifts, cutoff on a Saturday/Monday, Thanksgiving week.

### 2.2 Shared sales pipelines — extract from Owner, don't fork
- Move `src/owner-dashboard/owner-dashboard.pipelines.ts` → `src/common/sales-metrics/sales-pipelines.ts`
  (same exports: `linesPrefix`, `sourceStages`, `sourceMatch`, `policyTypeValues`, `SOLD_LINES`,
  `QUOTED_LINES`, `LEAD_CREATED_YMD_EXPR`, `ymdWindow`); update owner imports.
- New `src/common/sales-metrics/sales-matches.ts`: lift `resolvePeriod`, `scope`, `soldMatch`,
  `quotedMatch` verbatim from `owner-dashboard.service.ts:313-367`; owner service calls them. Move
  `namesFor` (`:540`) to `src/common/domain/user-names.ts`.
- New `src/common/dashboard/dashboard-filter-query.dto.ts`: export the field map now inlined in
  `owner-dashboard/dto/owner-dashboard-query.dto.ts:29-53` as `dashboardFilterFields`; the owner schema
  becomes `z.object(dashboardFilterFields).superRefine(refineCustomRange)` (zod `superRefine` schemas
  cannot `.extend()`, hence the field map).

### 2.3 Ticket predicate — new `src/crm/service-ticket-queries.ts`
> **Superseded on merge with dev (24 Sep 2026).** PAC-102 materialises `status` via `SyncTicketStatusFn`,
> so `overdueTicketMatch` was removed: the card and `stats()` both match the stored `status: 'overdue'`.
> `ticketTenantFilter` stands. Kept below as approved.

`overdueTicketMatch(now)` = `$or` of `{onboarding:null, renewal:null, status:'overdue'}`,
`{statusOverriddenAt:{$ne:null}, status:'overdue'}`, `{statusOverriddenAt:null, 'onboarding.completedAt':null, 'onboarding.dueAt':{$ne:null,$lt:now}}`,
same for `renewal`. `ticketTenantFilter(access, branchId)` lifted from the private `scopeFilter`
(`service-tickets.service.ts:224`; ObjectId tenancy — `buildScopeFilter` cannot serve this collection).
`stats()` (`:725`) uses `countDocuments({...filter, ...overdueTicketMatch(now)})` for `needsActionToday`.

### 2.4 Module — new `src/management-dashboard/`
- `management-dashboard.module.ts`: `forFeature` Lead, Deal, DealAudit, DealAuditItem, QuoteRecap,
  ServiceTicket, User, AgencyRole, UserRole; imports `LeadSourcesModule`, `PermissionsModule`. Register in
  `src/app.module.ts` next to `OwnerDashboardModule` (`:198`, before `FeatureModulesModule`).
- `dto/management-dashboard-query.dto.ts`: `managementDashboardQuerySchema` (= filter fields +
  `refineCustomRange`); `managementAlertListQuerySchema` adds `page` (default 1) / `pageSize` (default 50, max 200).
- `management-dashboard.controller.ts` — `@Controller('management-dashboard')`,
  `@RequireModule(ModuleKey.Management)`, `@RequirePermissions(modulePermission(ModuleKey.Management,'read'))`,
  handlers take `@Access()`, `@BranchId()`, `@Query(new ZodValidationPipe(...))` exactly like
  `owner-dashboard.controller.ts`:

| Route | Returns |
|---|---|
| `GET alerts` | `ManagementAlerts` — the three counts (`Promise.all`) |
| `GET alerts/stalled-leads` · `alerts/aging-audits` · `alerts/overdue-tickets` | `ManagementAlertList<Row>` — same prefix as the count, `$facet {total, items}` so card number == drawer total by construction |
| `GET team` | `TeamActivityResponse` |
| `GET producers/:producerId` | `ProducerDrawerResponse`; invalid id → 400; outside the caller's scope → 404 |

- `management-dashboard.pipelines.ts` (pure stage builders, `*.unit-spec.ts`) + `management-dashboard.service.ts`.

### 2.5 Pipelines (which index each rides)

| Read | Outline | Index |
|---|---|---|
| Stalled leads | `$match {...buildScopeFilter(leads,{producerIds}), status:{$nin: terminalLeadStatusValues()}, $or:[{lastActivityAt:{$lt: now−48h}},{lastActivityAt:null}]}` → `sourceMatch(leadSourceIds,'leadSourceId')` → LOB `{'policiesOfInterest.policyType':{$in: policyTypeValues}}` → `$addFields createdYmd: LEAD_CREATED_YMD_EXPR` → `ymdWindow('createdYmd')` → count / `$sort {lastActivityAt:1}` + page → names via `namesFor`, sources via `LeadSourcesService.labelsFor` (no `$lookup`) | `{agencyId, producerId, lastActivityAt:-1}` |
| Aging audits | `$match soldMatch(deals)` + `soldDateYmd:{$lt: agingCutoff}` → source/LOB only when set (`sourceStages(true)`+`sourceMatch`; LOB = `policyTypes ∩ policyTypeValues`, deal level) → `$lookup dealAudits {dealId, pipeline:[{$match:{isTestRecord:{$ne:true}, auditStatus:{$ne:'Pass'}}}]}` → `$match {'_audit.0':{$exists:true}}` → count / sort `soldDateYmd` asc + page; `businessDaysOpen` computed in Node | `{agencyId, producerId, soldDateYmd:-1}` / `{agencyId, soldDateYmd:-1}`; lookup on `{agencyId, dealId}` |
| Overdue tickets | `$match {...ticketTenantFilter, ...(producerIds → assignedUserId $in), ...overdueTicketMatch(now), openedAt in window (Chicago instants from `YmdRange`), ...(policyTypes → policyType $in)}` → source via `sourceStages(false)` on `leadId` when set → count / sort `dueAt` asc + page | `{agencyId,'onboarding.dueAt'}`, `{agencyId,'renewal.dueAt'}`, `{agencyId,branchId,status}` |
| Team sold / quoted | `linesPrefix(soldMatch **without producerIds**, SOLD_LINES, filter)` → `$group {_id:$ifNull[$producerId,null], households:$addToSet HOUSEHOLD_KEY_EXPR}` → `$size`; same over `quoteRecaps` with `QUOTED_LINES` (`HOUSEHOLD_KEY_EXPR` from `src/common/sales-metrics/household-key.ts` — one household definition with the Owner view) | as Owner |
| Team open audit items (all-time) | `$match {scope(deals) without producerIds, NEW_BUSINESS_MATCH}` (no window) → `$lookup dealAudits` → `$group {_id:$producerId, openAuditItems:{$sum:{$sum:'$_audit.openFailedCount'}}}` | `{agencyId, producerId, soldDateYmd:-1}` |
| Roster | `AgencyRole.findOne({agencyId, slug:'producer'})` → `roleAssignments.roleUserIds` → `User.find({_id $in, isActive:true, isPlatformAdmin:{$ne:true}, ...(Branch → branchId)})` (pattern: `ServiceTicketsService.listAssignees`, `service-tickets.service.ts:159`) ∪ group keys | users `_id` |
| Producer drawer | stats = the three team pipelines with `producerId` pinned via `buildScopeFilter({producerId})`; pipeline = stalled match minus the 48h clause, `$sort lastActivityAt:-1 $limit 50`, `$lookup quoteRecaps {leadId, sort quoteDate:-1, limit 1, project premium}`; open items = deals (scope + producerId, no window) → `$lookup dealAuditItems {dealId, $match {isFailed:true, isResolved:{$ne:true}, isTestRecord:{$ne:true}}}` → `$unwind` → project (`daysOpen` = calendar days since `firstCreatedAt ?? createdAt`, as the board does) | `{agencyId, leadId, ...}` on quoteRecaps; `dealAuditItems.dealId` |

### 2.6 Remove the stub
`src/feature-modules/feature.controllers.ts:104-107` delete `ManagementController` (leave a note like the
`owner-dashboard` one at `:108`); `feature-modules.module.ts:6,30` drop it. `test/api.e2e-spec.ts`: remove
`management` from `featureRoutes` (`:3353`) and `mutatingFeatureRoutes` (`:3643`); change `'management'` in
`csrDeniedFeatureRoutes` (`:3599`) to `'management-dashboard/alerts'`; assert bare `GET/PATCH /management`
now 404 like the PAC-135 block.

### 2.7 Permission migration
With `api:dev` **stopped**: `npm run db:migrate:create -- management_read_for_branch_managers`, modelled on
`migrations/20260923113506-user_availability_backfill.js` (raw `db`, constants copied in, idempotent, logs counts).
`up`: `perm = permissions.findOne({key:'management:read'})` (missing → log + return); for each
`roles.find({slug:'branch_manager'})`: `rolePermissions.updateOne({roleId, permissionKey:'management:read'},
{$set:{agencyId, permissionId, source:'template', updatedAt}, $setOnInsert:{roleId, permissionKey, createdBy:null, updatedBy:null, createdAt}}, {upsert:true})`
— idempotent on the unique `{roleId, permissionKey}` index (`permissions/schemas/role-permission.schema.ts:52`).
`down`: `deleteMany({permissionKey:'management:read', roleId:{$in: branchManagerRoleIds}})`, documented as
lossy for hand-added grants. Cache: cannot invalidate Redis from a migration — TTL / next login cover it
(same caveat `seed/sync-role-templates.ts:46`). Dev DBs: `npm run api:sync:roles:dev`.

### 2.8 Demo seed (`src/seed/demo/demo-seed.service.ts`, `demo-data.ts`)
Add a **new step at the end of `run()`** (existing comments insist the RNG draw order stays intact) that
`$set`s deterministic fixtures: 6 leads → non-terminal status, `createdDate = lastActivityAt = daysAgo(3)`;
3 deals → `soldDate = daysAgo(12)` + their audit `auditStatus` non-Pass with one open item; 3 tickets →
`status:'overdue'`, `openedAt = daysAgo(10)`. `DEMO_CONFIG` gets `stalledLeads / agingAudits / overdueTickets`.
Derived (step) overdue is covered by e2e, not the seed.

### 2.9 Tests + Bruno
- **`test/management-dashboard.e2e-spec.ts`** (pattern `owner-dashboard.e2e-spec.ts`): count == list total for
  all three; stalled excludes terminal + raw codes (`jp76g`) and includes a missing `lastActivityAt`; aging
  business-day cutoff (4 business days out, 6 in; Pass out; no-audit deal out); overdue: stored, derived
  onboarding, derived renewal, overridden, future `waiting` step out; team ignores `producerIds`, includes
  a deactivated producer with sales (availability `null`), totals = Σ rows, ratio `null` at quoted 0,
  open items ignore the window; drawer 404 outside scope; producer + CSR 403; a **branch manager user**
  (create in-spec; `seedTestData` seeds roles from templates) sees only their branch; invalid `range` 400.
- Unit: `business-days.unit-spec.ts`, `management-dashboard.pipelines.unit-spec.ts`, `service-ticket-queries.unit-spec.ts`.
- **`bruno/Management Dashboard/`**: `Login as Manager` (`manager@demoagency.local` — the seeded branch
  manager; asserts `management:read` in the login body, which proves the migration/template), `Get Alerts`,
  `List Stalled Leads` / `List Aging Audits` / `List Overdue Tickets` (each asserts `total` equals the
  count captured from `Get Alerts`), `Get Team`, `Get Producer Drawer`, `Forbidden for Producer`,
  `Invalid Range`; real `docs` blocks; rows in `bruno/README.md` + `collection.bru` folder list.

## 3. Web (`packages/web/src`)

1. **Filters, shared (not a second bar):** move `features/owner-dashboard/{useOwnerFilters.ts, owner-range.ts,
   components/OwnerFilterBar.tsx}` → `features/management/filters/{useDashboardFilters.ts, dashboard-range.ts,
   DashboardFilterBar.tsx}`; `OwnerDashboardParams` + `toSearch` from `lib/owner-dashboard-api.ts` →
   `lib/dashboard-filter-params.ts`. Update the six Owner imports.
2. **`lib/management-dashboard-api.ts`**: `managementDashboardKey = ['management-dashboard']`, one function per
   endpoint, shared types re-exported. Invalidate it beside `ownerDashboardKey` in
   `features/sold/EditSoldDealPage.tsx:207`, `features/sold/PolicyTransferPage.tsx:73`,
   `features/quote-recap/EditQuoteRecapPage.tsx:71`, `features/lead/components/useUpdatePolicy.ts:88`.
3. **`components/common/AvailabilityBadge.tsx`**: `AvailabilityDot` + `AvailabilityBadge` (`Badge size="sm"`,
   `bg-success` / `bg-destructive`, `USER_AVAILABILITY_LABELS`, `NOT_AVAILABLE` for `null`);
   `components/layout/AvailabilityToggle.tsx:34-37` drops its private `DOT_CLASS` for it.
4. **`features/management/` rewrite** (tokens only, light + dark, `TYPOGRAPHY.md` scale):
   - `ManagementDashboardPage.tsx`: keep the tab/URL logic; `ManagerPrototype` → `<ManagerDashboard/>`.
   - `ManagerDashboard.tsx`: `useDashboardFilters()` → `DashboardFilterBar` + `AlertCards` + `TeamActivityTable`;
     `useUrlState({ defaults:{drawer:'', producer:''}, allowed:{drawer: MANAGEMENT_DRAWER_KEYS, producer: objectId} })`
     drives the two drawers so a manager can paste a link.
   - `components/AlertCards.tsx`: three `Card rounded-xl` buttons; count `tabular-nums`; labels
     **Stalled Leads · "No update > 48h"**, **Aging Audits · "Open > 5 business days"**, **Overdue Tickets · "Breached SLA"**;
     `placeholderData: keepPreviousData`.
   - `components/AlertDrawer.tsx`: `Sheet side="right"` 440px (class string from
     `features/lead/components/MailerLookupDrawer.tsx:208`), header = label + total, `Table` rows,
     skeleton/error/empty from `features/clients/components/drawer-primitives.tsx`, pagination footer; row
     targets per D8, links gated with `canRead`.
   - `components/TeamActivityTable.tsx`: `OwnerPanel` shell; columns **Producer · Status · Households Quoted ·
     Households Sold · Household Close Ratio · Open Audit Items** (sub-text "all open items"); initials avatar as
     `ProducerLeaderboard.tsx`; `TableFooter` "Team Total"; `formatCount`/`formatPct` from `owner-format.ts`;
     row click → `setUrl({producer:id})`.
   - `components/ProducerDrawer.tsx`: `Sheet`; header (avatar, name, `AvailabilityBadge`); stats strip with the
     same four labels; **Active Pipeline** list (name → `/leads/:id`, status `Badge` via `statusBadgeClass` in
     `features/lead/components/lead-display.ts`, LOB · age, `formatMoney` value, `N/A` fallbacks);
     **Open audit items** list → `/clients/:householdId`.
   - Delete `components/GlobalFilterBar.tsx`, old `ManagerDashboard.tsx`, old `ProducerDrawer.tsx` (only the page
     imports them); update the prototype note in `packages/web/CLAUDE.md`.

## 4. Docs
`docs/SESSION-HANDOFF.md` §15 (PAC-139): decisions D1–D10, the migration + `sync:roles` note, and the
PAC-106 hook point (audit rows → household page until the Deal Audit page exists). `AGENTS.md` §2 table:
Manager view is live.

## 5. Verification
1. `npm run build -w @sfa/shared` → `npm run build -w @sfa/api` (lint does not typecheck) → `npm run lint -w @sfa/api`
   (diff the count against the baseline; it already exits 1) → `npm run lint -w @sfa/web` → `npm run build -w @sfa/web`.
2. With `api:dev` **stopped**: `npm run test:unit -w @sfa/api`; `npm run test:e2e -w @sfa/api` (whole suite once —
   suites share one database).
3. `npm run api:seed:demo:dev`, start `api:dev` (migration applies at boot; confirm its log line), then
   `cd bruno && npx @usebruno/cli run --env Local` twice against one DB.
4. Migration rehearsal on the **local prod dump only** (`sfa`): `db:migrate:status` → `db:migrate` → inspect
   `rolePermissions` for the `branch_manager` role → `db:migrate:down` → `up` again; never against production.
5. Browser at `localhost:5173/dashboard/management?view=manager` as `owner@demoagency.local` (tabs) and
   `manager@demoagency.local` (no tabs, branch-clamped), light + dark, 375px; open each drawer, paste a
   `?drawer=aging` URL, click through to lead / household / ticket; confirm each card number equals its
   drawer total under a period + LOB + source filter and that the producer filter moves only the cards.

## 6. Still open for David (assumptions built in, listed on the ticket)
- Status vocabulary Available / Busy (PR #121); "open" audit = anything not Pass (D2); person filter on
  tickets = assigned CSR (D6); active pipeline = every non-terminal status, $ = latest quoted premium (D7);
  roster = active producers + anyone with activity (D5); Open Audit Items is all-time (D4); audit rows open
  the household until PAC-106; "Live" pill dropped.
