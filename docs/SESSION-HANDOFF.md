# AIOS-SFA — Session Handoff

> **Purpose:** Continuation notes for building the new **AIOS-SFA** platform (replacing the legacy **SFA** app) and migrating users across. This captures everything discovered so far so a fresh chat session can continue without re-exploring. Current focus: **writing user stories → tickets, dashboard by dashboard**, starting with the **Producer Dashboard**.

---

## 1. Project context

- **SFA (Smith Family Agency)** is an insurance-agency operations SaaS. The legacy app is being retired.
- **AIOS-SFA** is the new replacement (monorepo, greenfield). Goal: rebuild the app with improved UI/UX and **migrate existing users over as smoothly as possible**.
- **Data store change:** moving to **MongoDB**. Legacy system-of-record is actually **SmartSuite** (+ **BigQuery** for mailer/property data). The real migration is **SmartSuite → MongoDB** (the new API preserves `legacySmartSuiteId` for reconciliation). BigQuery is only for mailer/property lookups.
- **Data stays mostly the same**, just re-homed and re-modeled in Mongo.
- **Process:** write user stories → tickets → implement dashboard by dashboard.

### Workspace layout (absolute paths)
```
/Users/asad/MyData/dev/pacisci_group/
├── AIOS-SFA/                         # NEW monorepo (target)
│   ├── packages/web/                 # React 18 + Vite + TS (Figma mockups, click-through)
│   ├── packages/api/                 # NestJS 11 + Mongoose (permission spine only; domain = stubs)
│   └── packages/shared/              # shared enums/permissions/types
├── SFA/                              # OLD app (Next.js 14 + SmartSuite + BigQuery + Clerk + Fillout)
├── Figma Mockups.md                  # Owner notes: design system + product direction
├── Form Pipeline Technical Specification.md      # Owner: Lead→Quote→Sold→Audit pipeline (v2.0)
├── Lead-Quote-Sold Form Pipeline Architecture Guide.md  # Owner: same pipeline, arch guide
└── AIOS-SFA-SESSION-HANDOFF.md       # THIS FILE
```
> Note: the workspace root changed to `none` mid-session; use absolute paths above.

---

## 1b. Authorization model change (PAC-25, sub-issue of PAC-7)

The API now treats the **backend store (MongoDB) as the source of truth for
authorization**, resolved on every request — the JWT no longer carries the
effective permission set. Right after auth, `AccessContextGuard` resolves the
caller's live `AccessContext` (via `AccessResolverService`) and attaches it to
`request.access`; the Tenant/Branch/Module/Permissions guards read from there.
Owner permission/role edits and user de-provisioning therefore take effect on the
**next request** (no re-login), and a still-valid token cannot outlive a
revocation.

**Redis is optional:** resolution reads from Mongo unless `REDIS_URL` is set, in
which case resolved contexts are cached in Redis (safety TTL + explicit
invalidation on role/user/module changes). Behavior is identical either way; the
day-one default is DB-only. New env: `REDIS_URL`, `PERMISSION_CACHE_TTL_SECONDS`
(both optional). Key files: `packages/api/src/permissions/access-resolver.service.ts`,
`packages/api/src/permissions/cache/*`, `packages/api/src/common/guards/access-context.guard.ts`.

---

## 2. Tech stacks

**New — `AIOS-SFA/packages/web`:** React 18, Vite 6, TypeScript, Tailwind 4, Radix UI, React Router 7, TanStack Query, Recharts, lucide-react. All screens render from **hard-coded mock data**; auth + api-client scaffolded but **no dashboard is wired to the API yet**.

**New — `AIOS-SFA/packages/api`:** NestJS 11 + Mongoose 8, JWT/passport auth, class-validator. Has a full **permission-based multi-tenancy spine** but **every domain module is an empty stub** returning `{ status: 'ready' }`.

**Old — `SFA`:** Next.js 14 (App Router), TypeScript, Tailwind. Integrations: **SmartSuite** (CRM system-of-record), **BigQuery** (`allstate123.smartsuite_data`, mailer table), **Clerk** (auth, roles in `publicMetadata`), **Fillout** (embedded forms for Quote Recap + Mark Sold).

---

## 3. The 7 mockup dashboards (in `packages/web`)

Dev "Screen Navigator" at `/` (`src/pages/DevNavPage.tsx`) links all 7. Routes in `src/app/App.tsx`. All behind `ProtectedRoute`.

| # | Screen | Route | Persona | Notes |
|---|---|---|---|---|
| 1 | **Producer Dashboard** | `/dashboard/producer` | Sales producer | Sidebar+header (⌘K search, Add Lead, time filters), 3 scorecards (Sold/Quoted/Leaderboard), 60/40: Deals Pending Service Hand-off + Hot Leads. **← current focus** |
| 2 | **Lead Details** | `/leads/:id` | Producer | **Built (PAC-38.)** Lead+contact with inline status/temperature/source edits, Prior Insurance (only when sold), Quote Summary, Household card + Activity timeline. Embodies Lead→Quote→Sold. Two documented divergences from the mockup: no current-vs-proposed coverage table and no per-member policy icons — neither is derivable from what the system stores. `/leads/demo` was removed; the page uses real data now. |
| 3 | **Management v1** | `/dashboard/management` | Owner + Manager toggle | Owner Strategy Hub (KPIs, leaderboard, Lead Source ROI) / Manager Action Hub (alerts, Team Activity Monitor + drawer). Global filter bar. |
| 4 | **Management v2** | `/dashboard/management-alt` | ⚠ mislabeled | Actually an **"Agency Command Center" / lead-distribution board** (Unclaimed Leads Pool, claim via call/text, Mailer QCN sidecar). Not analytics. Clarify intent. |
| 5 | **Service Dashboard** | `/crm/service` | Service rep | 4 scorecards (Active Load, Retention Window, Daily Velocity, Book Health), 60/40: Priority Ticket Queue + Proactive Renewal Outreach. |
| 6 | **Ticket Workspace** | `/crm/tickets` | CRM/service | KPI strip + 40/60 ticket feed + workspace panel w/ timeline. Rich Ticket model in `features/tickets/components/ticket-data.ts`. |
| 7 | **Household Details** | `/clients/:id`, `/clients/demo` | 360° client view | 3-column: Household Profile (roster, retention score) + Policy Portfolio (active lines + cross-sell) + Activity Feed. |

---

## 4. Cross-cutting product direction (from `Figma Mockups.md`)

- **Allstate color identity**; full **light + dark** themes.
- **RBAC → permission-based access** (already implemented this way in the new API).
- **Dynamic data:** global **fuzzy omni-search**; **real-time faceted filtering** (chips update instantly, no "Apply" button); **data masking** (raw hashes like Household IDs / QCNs shown as human-readable labels, e.g. `TKT-2026-004`).
- **Layout:** asymmetric **60/40** or **3-column** splits on detail pages.
- Brand names are inconsistent across mockups (AgencyOps / AgencyOS / Allstate Producer Hub / Greenfield / Jenkins) — needs a canonical brand/tenant model.

---

## 5. Canonical entity model + form pipeline (from the two Owner pipeline docs)

The client lifecycle is a **4-phase, session-isolated form pipeline** (forms completed days apart; state passed via URL params `householdId`/`quoteId`, persisted to backend — NOT a single frontend wizard):

**Lead Entry → Quote Recap → Sold Finalization → Post-Sale Audit**

**Four canonical entities:**
- **Household** — foundational: living address + **array of contacts** (Primary, Spouse, Child, Driver, Additional Named Insured; each has name/DOB/relationship). `POST /api/households → householdId`.
- **Quote** — proposal linked to a Household: policy types (multi-select), premium per policy (+ an item count on the vehicle types only — Auto/Auto - Special/Motorcycle/Boat Owners; every other type is 1 and is not asked), conditional property address ("Same as Household" toggle), quote document upload, notes. `POST /api/quotes → quoteId`.
- **Sold Deal** — execution metrics linked to a Household; contains **multiple Sold Policies**. Multi-step wizard (8 "cards"): Sold Date → Policy Type → Basic Details (carrier, policy # with `GET /api/policies/check` dedupe) → Financials → **Discounts & Required Docs (Card 5, highly conditional)** → Prior Insurance → Cancellation → Loop control. `POST /api/sold-deals` → **auto-triggers audit**.
- **Audit Record** — compliance checklist **auto-generated on Sold submission** (`POST /api/audit-records`). Dynamic flags from Card 5: Escrow verified, Inspection Passed/Waived, Fire Subscription receipt, New Roof receipt, Drivewise (mention registration), Defensive Driver certificates (per selected driver), Student report card/transcript.

**Key reconciliation items flagged (need Owner/user confirmation):**
1. **Replacing Fillout:** legacy uses Fillout embedded forms (`SFA/docs/api-contract-quote-recaps-submit.md`). New plan = **custom native form pipeline** = net-new scope beyond re-skinning dashboards.
2. **Stack mismatch in the docs:** the Architecture Guide says **Next.js** + "build a Mock API using localStorage (Node backend not built)". But AIOS-SFA is **Vite/React web + NestJS/Mongo api**. Docs likely predate the monorepo decision. Confirm the form pipeline lives inside AIOS-SFA (assume yes; don't build localStorage mocks).
3. Sold Form UX should mimic `lead.okinsuranceexchange.com` / `rce.okinsuranceexchange.com`.

---

## 6. New API foundation (`AIOS-SFA/packages/api` + `packages/shared`)

**Multi-tenancy:** `Agency → Branch → User`. Guards run globally in `app.module.ts`: `JwtAuthGuard`, `TenantGuard`, `BranchGuard`, `ModuleGuard`, `PermissionsGuard`. `User`/`TenantRecord` carry `legacySmartSuiteId` (migration key).

**Modules exist only as stubs** (`src/feature-modules/feature.controllers.ts`, each returns `{ status: 'ready' }`). No domain schemas, no queries, no data yet.

**Module keys** (`shared/src/enums/module-key.enum.ts`): `dashboard, leads, quote_recaps, mailers, crm_service, clients, deal_audits, onboardings, management, owner_dashboard, command_center, performance, leaderboard`.

**Permissions** are `"<module>:<read|write>"` plus `platform:*` and `agency:*` (`shared/src/permissions/permission.constants.ts`). Effective set resolved via `resolve-permissions.ts` (role perms + grants − revokes, filtered to agency-enabled modules). `DataScope = own | branch | agency`.

**Default role templates** (`shared/src/permissions/default-role-templates.ts`):
- **Agency Owner** (scope: agency, all agency admin perms + all enabled modules)
- **Branch Manager** (scope: branch; leads, clients, deal_audits, dashboard:read, performance:read, crm_service r/w)
- **Producer** (scope: **own**; `dashboard:read, leads:r/w, quote_recaps:r/w, deal_audits:r/w, clients:write, performance:read, leaderboard:read`)
  - `clients:write` was added by PAC-38 so a producer can correct their own
    lead's primary contact. `Contact` has no `producerId`, so `own` scope is
    **derived** in `ContactAccessService` — the caller must own a lead that
    reaches the contact. Propagate a template change to existing agencies with
    `npm run api:sync:roles:dev`; `seedDefaultRoles` unions, so it never removes.
- **CRM** (scope: branch; clients, crm_service, deal_audits, onboardings, dashboard:read)
- **Data Team** (scope: agency; dashboard, command_center, management, owner_dashboard, performance, leaderboard reads)

Seed (`src/seed/seed.ts`) is platform data only — super admin, carriers, permissions; it creates **no agency**. The SmartSuite migration provisions agency "Smith Family Agency" + Main branch + roles + audit templates, and imports only the users SmartSuite has (no owner account). The demo seed provisions its own `demo-agency`.

---

## 7. Old SFA data sources (for migration mapping)

Old app API routes live under `SFA/app/api/**`; data-access logic under `SFA/lib/**`. Legacy roles (Clerk `publicMetadata.roles`, `SFA/lib/roles.ts`): `admin, Owner, DataTeam, CRM, Producer, Referral Partner, Client`.

Relevant to the Producer Dashboard:
- **Performance/scorecards:** `SFA/lib/performance/getPerformanceBuckets.ts` + `SFA/app/api/producer/performance/summary`. Buckets = `today / week(rolling 7d) / mtd / lastMonth`, each `{ premium, count }`. Sources: **Quote Recaps** table (quoted) and **Deals/Sold Log** table (sold). Scope `me` filters by producer SmartSuite user id; premium uses rollup with snapshot fallback; excludes test/sample/demo.
- **Leaderboard:** `SFA/app/api/leaderboard/route.ts`. Deals Sold Log, MTD (Chicago tz), aggregate premium by producer, top 5, hydrate producer names from Users table. Returns `{ period:'mtd', rows:[{producerName, premium}] }`. (No "goal" concept — goals are NEW in the mockup.)
- **Hand-off board / Deal Audits:** `SFA/app/api/dashboard/deal-audits/route.ts`. **Deal Audit Items** table filtered to `Failed`/`in_progress`. RBAC: admin-like see all; producer/CRM filtered by their SmartSuite user id. Returns `{ id, client, producer, status, item, daysOpen }` + pagination.
- **Hot leads / sources:** `SFA/app/api/leads/*` + `SFA/lib/leadSources.ts` (14 canonical sources: Mailer, Book of Business, Allstate Lead Marketplace, Customer Referral, Data Lot, Facebook, Google, Mail Referral, Quotewizard, Soleo, Stride, Waterstone, JYA, Test).

---

## 8. The "hand-off board" — definition (was a user question)

The Producer Dashboard's **"Deals Pending Service Hand-off"** panel = the front-end for **Audit Records**. When a producer completes the **Sold Form**, an **Audit Record (Post-Sale Audit)** is auto-generated — the moment the deal is *handed off* from sales (producer) to the **office manager / service team**. It holds dynamic verification flags (from Sold Form Card 5) that start **pending/unverified** (escrow, inspection, fire/roof receipts, Drivewise, defensive-driver certs, student transcript). Until cleared, the deal is "pending hand-off." Each open item shows as a row: **client · missing requirement · days open · Resolve**. Legacy source = **Deal Audit Items** SmartSuite table filtered to `Failed`/`in_progress`.

---

## 9. Producer Dashboard mapping (web ↔ new API ↔ old SFA ↔ Mongo)

| Mockup zone | New module → permission | Old SFA source | New Mongo collection(s) |
|---|---|---|---|
| Shell (sidebar, greeting, ⌘K search, Add Lead, time filters) | `dashboard` → `dashboard:read` | n/a (composes others) | — |
| Scorecards: Sold + Quoted (premium, items, avg/HH) | `performance` → `performance:read` | `getPerformanceBuckets` + `/api/producer/performance/summary` (Quote Recaps + Deals/Sold Log) | `quoteRecaps`, `deals`, `households` |
| Motivation Hub / Leaderboard (office total, rank, % to goal) | `leaderboard` → `leaderboard:read` | `/api/leaderboard` (Deals Sold Log, MTD, top 5) | `deals` + **new** `producerGoals` |
| Deals Pending Service Hand-off (client, missing req, days open, Resolve) | `deal_audits` → `deal_audits:read/write` | `/api/dashboard/deal-audits` (Deal Audit Items, Failed/in_progress) | `dealAudits` / `auditRecords` (from Sold pipeline) |
| Priority Contact List / Hot Leads (source, status, Call/Text/Email) | `leads` → `leads:read/write` | `/api/leads` + `lib/leadSources.ts` | `leads`, `activities` |

**Gaps / decisions for the Producer Dashboard:**
1. **`deal_audits` not granted to Producer** in the role template (only Branch Manager/CRM). The hand-off board is on the producer dashboard → likely add `deal_audits:read` (own scope) + write to resolve own items. **Decision pending.**
2. **Goals are new** — old leaderboard is premium-only; mockup shows **% to monthly goal** → needs `producerGoals`.
3. **Office total + leaderboard vs `DataScope.Own`** — `leaderboard:read` must expose **aggregates only**, not cross-producer rows (Figma "own data + shared leaderboard" pattern).
4. **Deal "type" (Auto/Home/Bundle)** and lead **temperature/aging** aren't first-class in old payloads → derive or add to Mongo schema.

---

## 10. Draft user stories (NOT yet finalized/created)

11 stories were drafted in-session for the Producer Dashboard (epic + PROD-1..PROD-11); **the user asked to hold off creating them** pending the pipeline-doc context above. They should be **revised** to align the hand-off board stories (PROD-6/7) with the **Audit Record** entity from the pipeline docs, and to confirm the Fillout-replacement scope. Rough set:
- PROD-1 Shell + permission gating · PROD-2 Time-range faceted filter · PROD-3 Sold scorecard · PROD-4 Quoted scorecard · PROD-5 Leaderboard + office total (aggregate-only) · PROD-6 Hand-off/Audit board (read) · PROD-7 Resolve audit item (write) · PROD-8 Hot Leads · PROD-9 Lead quick actions (call/text/email + activity log) · PROD-10 Add Lead + omni-search · PROD-11 (enabler) SmartSuite→Mongo migration for `deals/quoteRecaps/leads/auditRecords`.

---

## 11. Open questions to resolve next
1. **Hand-off board access:** add `deal_audits:read` (+write) to Producer role? (recommended: read own + write to resolve own)
2. **Where do stories live:** Linear (Linear MCP available), a `docs/` markdown file, or chat?
3. **Next step after stories:** (a) repeat map→stories for the other 6 dashboards, (b) start Producer Dashboard implementation (API modules + Mongo schemas), or (c) design the full Mongo schema/migration plan across all dashboards first.
4. **Form pipeline scope:** confirm the Lead/Quote/Sold/Audit **custom forms** are in scope for AIOS-SFA (replacing Fillout) and live in this monorepo.
5. **Management v2** intent (analytics vs the Agency Command Center it currently shows).

---

## 12. Status
- ✅ Explored all 7 web mockups, the new API (permissions/modules/schemas), and old SFA producer data sources.
- ✅ Produced Producer Dashboard mapping (web ↔ api ↔ old SFA ↔ Mongo).
- ✅ Ingested the two Owner pipeline docs; defined canonical entity model + hand-off board.
- ⏸ **Paused before creating user stories** (per user). Resume by revising Producer Dashboard stories with pipeline context, then confirming Q1–Q5 above.

**Recommended first action in the new session:** confirm the 5 open questions, then finalize + emit the Producer Dashboard user stories.

### Mailers — both halves shipped (PAC-73 + PAC-61)

Mailers no longer live in BigQuery at read time. **PAC-73** created the `mailers`
collection plus the RTP upload and the BigQuery backfill; **PAC-61** added the
agency-facing read path — a **Mailers** button on the Leads page opening a
drawer that resolves a Quote Control Number and logs the recipient as a lead
through the existing `LeadIntakeService`.

Two endpoints: `GET /mailers/:controlNumber` (`mailers:read`) and
`POST /mailers/log-lead` (`mailers:read` **and** `leads:write`). Either printed
form of the control number resolves, and logging is idempotent per mailer across
both forms.

**What PAC-61 settled is recorded on the types it settled**, not in a separate
document: premium presentation and the campaign line on `Mailer`'s sub-schemas,
the Oklahoma-only county table in `common/mailers/county-names.ts`, and the
idempotency key on `buildSubmissionToken`'s `mailer` branch — the ticket's
literal spec was wrong there, and the docblock says why. The hand-typed
control-number gap it left open is **closed**: PAC-71 stores a normalized
`Lead.mailer.controlNumberKey` and resolves it at write time.

⚠ **Existing agencies need `npm run api:sync:roles`**: PAC-61 gave `mailers:read`
to every role template, and editing a template does not touch already-seeded
roles.

### Super Admin — user directory and impersonation (PAC-70)

**Find / Impersonate User** is live in the Super Admin panel at `/admin/users`.
Product decision (2026-09-02): impersonation is a plain support tool with **no
strings attached** — full write access as the target, no audit trail, no
notification, no banner, no "return to admin". The operator logs out when done.
PR #44's `impersonationEvents` collection was removed; drop it by hand
(`db.impersonationEvents.drop()`) wherever that PR was deployed.

Endpoints, all under the platform guard stack:
- `GET /platform/users` — cross-agency directory, `platform:users:read`.
  `q` matches name, email, **agency name** and **role name**; `agencyIds[]` and
  `roleSlugs[]` are multi-select and ORed. Roles filter by **slug**, not id,
  because `producer` has a different id in every agency. Two-phase query
  (resolve agency/role matches to ids, then one `users` find), no new indexes.
- `GET /platform/users/roles` — one `{slug, name}` per distinct slug, for the
  Role filter.
- `POST /auth/impersonate/:userId` (`platform:users:impersonate`) now returns
  the login envelope **plus `appBaseUrl`**.

**The handoff is the non-obvious part.** `HostTenantGuard` refuses a
domain-bearing agency's user on the platform host and a platform admin on any
agency host, and `localStorage` is per origin — so the panel cannot keep the
minted tokens where it is. It navigates the **same tab** to
`<appBaseUrl>/auth/impersonate#accessToken=…&refreshToken=…`; that page (outside
both route guards) stores the tokens in the target origin, calls `/auth/me`,
scrubs the fragment with `replaceState`, and redirects to `/`. Fragment, not
query string, so the tokens never reach any server or proxy log. Same tab, so a
no-domain agency (whose handoff lands on the platform origin) replaces the
operator's session explicitly rather than splitting it across tabs.
`TenantUrlService.baseUrlFor` now inherits scheme and port from `APP_BASE_URL`
so the handoff origin is reachable locally (`http://x.sfa.local:5173`, not a dead
`https://`); production output is unchanged.

Local testing of the cross-host case needs `PLATFORM_HOST`/`BASE_DOMAIN` in
`.env`, `/etc/hosts` entries, and an active `agencyDomains` row. For a second
populated tenant: `npm run api:seed:demo:dev -- --agency texas-holdings
--agency-name "Texas Holdings"` (the roster gets its own email domain now, so it
adds rather than moves users).

### Agency onboarding from the Super Admin panel (PAC-69)

An operator now stands up a whole tenant from `/admin/agencies/onboard`, and the
agency's owner is walked through their own first-run setup. This is the third
provisioning path (after the SmartSuite migration and the demo seed) and the
**only one that creates a user**.

`POST /platform/agencies` replaced its unvalidated `{name, slug}` body — which
created an agency nobody could sign into and no record could be written to —
with a zod DTO and `AgencyProvisioningService`: agency → default roles → first
branch → audit templates → invited Agency Owner. Alongside it,
`GET /platform/agencies/availability` (live slug/email/ticker checks) and
`POST /platform/agencies/:agencyId/owner-invite/resend`.

**Three decisions worth carrying forward:**

1. **The invite email is dispatched outside the rollback and is never undone.**
   `InngestService.send` records the event before handing it over and the sweep
   replays a stranded row, so rolling the tenant back on a delivery failure
   would mail a live link to a deleted account. A failed dispatch is reported as
   `emailStatus: 'failed'` on a **201**, not an error.
2. **`TransactionRunner` is deliberately not used** — on a replica set it takes
   the transaction path, where its compensation registry is a no-op, and none of
   the collaborators accept a session. It would have looked atomic while leaking
   roles, templates and the user. An explicit undo stack instead.
3. **A failed invite dispatch now clears `inviteLastSentAt`** (every invite path,
   not just onboarding), so the person recovering from one is not told "an invite
   was just sent to this address" when none was.

`Agency.setup` tracks the owner's wizard and **defaults to `complete`**, so no
migration was needed and no existing owner is pushed into it. ⚠ `.lean()` does
not apply schema defaults, so a document predating the field reads back
`undefined` — null-guard rather than trusting the default.

**Still open:** there is no delete-agency endpoint, so every Bruno run of the
`Platform Agencies` folder leaves one agency behind, and a mis-typed onboarding
can only be undone in the database. The panel's Agencies directory (PAC-68) is
still unbuilt, so an onboarded agency cannot be viewed or edited afterwards.


---

## 13. PAC-91 — contacts / households domain fix (handoff, 2026-09-07)

**Start here for PAC-91.** Ticket: https://linear.app/paciscigroup/issue/PAC-91
(read §8 and §9 first — they were added 2026-09-07 and carry the measured
numbers). Plan: `docs/plans/pac-91-contact-household-links-implementation-plan.md`
(execution order; the ticket stays authoritative). Branch:
`asad/pac-91-contacts-households-domain-model`, cut from `dev`, pushed. **The
whole ticket ships as one PR in five phases**; each phase is left green before
the next starts. No product code has been written yet — the branch holds only
the plan and this section.

**What was established (analysis session, 2026-09-06/07):**

- Root cause of "contacts not linked / households have no primary" is two
  stacked importer defects: `migrateHouseholds` never reads SmartSuite's
  `Primary Contact` (`sdb36b3217`) / `Household Members` (`suxra4lb`), and
  `migrateContacts` reads only the contact's single `Household` link
  (`s66cf9402f`), which legacy wrote solely from the intake form. Legacy's own
  `SFA/lib/intake/resolveHousehold.ts` falls back to the back-links `sljrnhhg`
  / `su8pm1bp` — that fallback order is what the importer must mirror.
- Measured on the production dump: 1,060 / 3,064 migrated contacts have a
  `legacyHouseholdId` (35%); 1,700 are fillable from the export, 2 disagree
  (#C00023, #C02694), 304 have no link either side; 2 migrated households have
  a primary (both set by intake to app-created contacts); policies need nothing
  (4,192 agree, 0 differ); 42 contacts / 28 households / 25 policies were
  created in the app since go-live and carry no legacy id.
- Owner rules: a contact can belong to several households but is primary of at
  most one; a contact can die; **a contact is unique on DOB + full name + phone
  or email** (§9). The export has 47 full-key duplicate groups (48 contacts)
  and 4 contacts that are primary of two households (#C01036, #C01765,
  #C02116, #C02579) — the latter contradicts the rule and will block the §5
  unique index until David decides.
- No contact in the export has more than one email or phone → the §1 scalar
  change is safe on real data.

**Decisions taken (each confined to one phase, see the plan's "Decisions"):**
repair production with a CSV-driven backfill, never a migration re-run
(`persist` `$set`s every field over employee edits); link semantics are
fill-if-empty with conflicts reported, never written; Phase 1 writes to today's
schema; denormalised phone/email copies on `Lead` and `Household` are deleted
and read through `primaryContactId`; membership becomes a `householdMembers`
join collection; a deceased primary requires a named successor, falling back to
a data-quality flag; migrate-mongo (`packages/api/migrations/`, runs at boot)
for every change needing no external input, a `--dry-run` CLI script under
`src/migration/backfill/` for anything needing a file or a human review.

**Environment state left behind (main checkout, `/Users/asad/MyData/dev/pacisci-group/AIOS-SFA`):**

- Local `sfa` database = **restored production dump** (agency
  `smith-family-agency`, id `6a95edcfb1c4e8eb86f954b9`) with `migrate:tickets`
  (286 reshaped, 60 moved, `service_tickets` dropped) and
  `backfill:appointments` (A0B9049 → Allstate) already applied. `db:migrate:status`
  shows nothing pending. **Do not run the SmartSuite migration against it** —
  it would overwrite the app-created edits the backfill exists to protect.
- David's exports: `temp/Contacts 9_4_2026.csv`, `temp/Households 9_4_2026.csv`,
  `temp/Policies 9_4_2026.csv` (gitignored, main checkout only). Multi-valued
  *rec-id* columns are ` | `-separated; *title* columns are `, `-separated.
- `agencyId` on every `TenantRecord` is a **string**; a query with an
  `ObjectId` silently matches nothing.

**Owner decisions received (David, Slack, 2026-09-07) — see ticket §8 "Owner
decisions" and plan §1.8:** remove households HH-4717 / HH-4718 / HH-4764 /
HH-4313 / HH-0032 (resolves every double primary; HH-4717 has one lead to
re-point to HH-3932; HH-0032 is a test row with junk policy 00006); flag
HH-0001–HH-0017 and the six Sample/Test contacts as test records; delete the
newer of the two identical 856719796 policy rows; unlinked policies and
contacts stay unlinked but the team needs an in-app list → ticket §10 / plan
Phase 5; HH-3149 — Brianne Ray becomes primary. **Nothing is outstanding with
David for Phase 1.**

**How to begin Phase 1:** follow plan §1.1–§1.8 in order. Run every script
through the workspace (`npm run <script> -w @sfa/api -- --flags`), never a root
alias (they swallow flags). `npm run build -w @sfa/api` catches type errors
(`lint` does not); `npm run build -w @sfa/shared` before e2e/Bruno. The Phase 1
rehearsal is `--dry-run` → real → re-run (zero fills), then the before/after
report goes on the ticket as a comment.
