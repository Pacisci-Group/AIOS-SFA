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

**Phase 1 is done (2026-09-07) and rehearsed on the local dump.** The importer
now reads the household side (`HOUSEHOLD_FIELDS.primaryContact` /
`.householdMembers`, `CONTACT_FIELDS.householdPrimaryBacklink` /
`.householdMemberBacklink`, `LEAD_FIELDS.primaryInsured` /
`.householdMembers`), resolves a contact's household through
`resolveContactHousehold` in legacy's own fallback order, and runs a new
**`Household links`** pass after contacts and leads (`migrateHouseholdLinks`,
stage 6 of 23) that writes `Household.primaryContactId` / `memberContactIds` and
a lead's `householdId` / `primaryContactId` / `memberContactIds`. Existing
databases are repaired instead by
`packages/api/src/migration/backfill/backfill-household-links.ts`:

```
npm run backfill:household-links:dev -w @sfa/api -- \
  --agency smith-family-agency \
  --contacts "<abs>/temp/Contacts 9_4_2026.csv" \
  --households "<abs>/temp/Households 9_4_2026.csv" \
  --policies "<abs>/temp/Policies 9_4_2026.csv" \
  --apply-owner-decisions --dry-run --report ./pac-91-backfill.json
```

Give the CSVs as **absolute** paths — `-w @sfa/api` runs the script with
`packages/api` as its working directory. The exports live in the gitignored
`temp/` of the main checkout only. `--apply-owner-decisions` replays the
committed list in `backfill/pac-91-owner-decisions.json` (five households
removed, test rows flagged, the duplicate 856719796 policy deleted, #HH3149
given a primary); the decision rules themselves are pure functions in
`backfill/household-link-decisions.ts` with a unit spec, and the CSV separator
quirk lives in `backfill/smartsuite-csv.ts` with another. **Production has not
been touched yet** — the local rehearsal is the only run so far.

**How to begin a phase:** follow the plan's numbered steps in order. Run every
script through the workspace (`npm run <script> -w @sfa/api -- --flags`), never a
root alias (they swallow flags). `npm run build -w @sfa/api` catches type errors
(`lint` does not, and `tsc -p packages/api/tsconfig.json` catches more still —
webpack only checks what is reachable from `main.ts`, so an object literal passed
to `persist(…: Record<string, unknown>)` type-checks against nothing);
`npm run build -w @sfa/shared` before e2e/Bruno. Each phase's rehearsal is
`--dry-run` → review → real → re-run, and its before/after report goes on the
ticket as a comment.

**Phase 2 is done (2026-09-07) and rehearsed on the local dump.** `Contact.email`
/ `.phone` are scalars; `Lead.emails`/`.phones` and
`Household.primaryContactName`/`.primaryEmails`/`.primaryPhones` are **deleted**,
and every reader resolves the primary contact through `primaryContactId`
(`contacts/contact-details.ts` `loadContactDetails` is the shared batched
lookup; `households/primary-contact.ts` re-keys it by household). Intake stopped
`$addToSet`-ing a conflicting submission — it fills a blank and records the
disagreement as a new `contact_conflict` activity instead. §9 identity landed
too: `Contact.nameKey`/`.dobKey` stamped by schema hooks
(`contacts/contact-identity.ts`), one `ContactIdentityService.findDuplicate`
shared by intake, the Household form and `PATCH /contacts/:id` (409 carrying the
existing `contactId`), and two partial unique indexes.

Two migrate-mongo migrations, in this order, and the order is load-bearing:

1. `20260907105040-contact-scalars-and-identity-keys.js` — arrays → scalars
   (normalised), keys stamped, the five denormalised fields `$unset`.
2. `20260907110122-contact-identity-indexes.js` — builds the two partial unique
   indexes, and **throws, naming the offending rows, if duplicates remain**.
   That is deliberately a wall: the API applies pending migrations before it
   binds a port, so a deploy that skipped the merge below stops here rather than
   shipping a rule nothing enforces.

Between them runs the reviewed merge script:

```
npm run merge:duplicate-contacts:dev -w @sfa/api -- \
  --agency smith-family-agency --dry-run --report ./pac-91-merge.json
```

It groups by the **full** key only (never a partial one — the 244 name-only
groups are for the agency to judge by hand, follow-up ticket), keeps the row with
a household link (else the oldest), repoints `households`/`leads`
`primaryContactId`+`memberContactIds`, `deals.primaryContactId` and
`dealAuditItems.subjectContactId`, and audits for dangling refs on every run.

⚠ **Phones are now stored normalised to digits.** Every writer already did that
for app-created rows; migration 1 does it for migrated ones, because contact
matching, the identity indexes and the merge script all compare normalised
values — leaving `(918) 808-2556` raw would make 3,000 migrated contacts
invisible to all three. `formatPhone` on the web side renders them.

**Production has not been run for Phase 2 either.** Local rehearsal only.

**Phase 3 is done (2026-09-07) and rehearsed on the local dump.** Membership is
a join collection: **`householdMembers`** (`households/schemas/household-member.schema.ts`),
one row per `(household, contact)` with the **role** and an **`endedAt`** on the
row, because both are facts about the *pair* — the same person is a Named
Insured at home and a Driver on a parent's policy, and leaving a household is
not ceasing to exist. `HouseholdMembersService` is the only reader/writer;
"current" means `endedAt: null`, which in Mongo also matches an absent field.

**Five fields are gone**: `Contact.householdId` / `.legacyHouseholdId` /
`.isPrimary` / `.roleInHousehold` and **`Household.memberContactIds`**. The last
one goes beyond the plan's letter and is a Phase 3 decision: leaving it would
keep two sources of membership truth with nothing reconciling them, and an array
has nowhere to put a role or an end date — `$pull` *is* the loss §5 describes.
Primacy stays the single `Household.primaryContactId`.

Three migrations, in this order, and the order is load-bearing:

1. `20260907172117-seed-household-members.js` — seeds from the **union of three**
   sources (`primaryContactId` ∪ `memberContactIds` ∪ `Contact.householdId`),
   not the two the plan named: the contact side alone holds **19** memberships
   the household side never lists back, and dropping them is the §6 defect.
2. `20260907172118-drop-contact-household-fields.js` — `$unset`s the five, and
   drops the three now-orphaned contact indexes. Refuses to run if
   `householdMembers` is empty while households exist. `down` throws.
3. `20260907172120-household-primary-contact-index.js` — the partial unique
   index on `{agencyId, primaryContactId}`, **and the wall**: it throws naming
   the offending contacts. Last on purpose, so a database with double primaries
   still gets its memberships and its cleanup; only the enforcement waits.

**⚠ Blocked on the local dump, by design.** Phase 2's merge left three contacts
primary of two households — susan dudley (HH-4790/HH-4792), Justin Rivera
(HH-4774/HH-4775), Cristal Lubbers (HH-4527/HH-4540) — so migration 3 refuses.
That is an **open owner decision** (ticket comment 2026-09-07): merge each pair,
or keep both and name which household the person is primary of.

Behaviour changes worth knowing:

- **Intake adds a membership, never moves the contact.** `LinkEntitiesStep` no
  longer `$set`s a household onto the contact, and it only sets a household's
  `primaryContactId` when the contact is not already primary elsewhere —
  otherwise the new index would fail the whole submission on an E11000.
- **`ResolveHouseholdStep` refuses to guess.** No membership → create; exactly
  one → that one; several → **409 `ambiguous_household`** carrying the
  candidates so the form can ask. The public share-link path cannot pin a
  household, so a public submission from a multi-household contact (14 of 3,082
  contacts) needs the office to log it.
- **`PATCH /contacts/:id` returns `role: null, isPrimary: false`** — always. Both
  are per-membership and that endpoint has no household in hand; the Lead Detail
  page reads them from `GET /leads/:id`.
- **New endpoint** `DELETE /households/:id/members/:contactId` (`clients:write`)
  soft-ends a membership; 409 on the primary contact, 404 when there is nothing
  current to end.
- The duplicate 409 now carries **`householdIds`** (a list), not `householdId`.

**Rehearsal (from `pac91-before-phase2`, replaying the full production
sequence).** Phase 2 migration 1 → the wall fired at 24 duplicate groups → merge
dry-run reviewed (24 groups, all phone-leg, 5 both-linked) → live merge →
snapshot `pac91-before-phase3` → the rest. **2,814 memberships** written
(2,465 primaries + 330 member-list + **19** contact-side), 3,082 contacts and
2,542 households cleaned, 0 dangling refs, 0 duplicate pairs, 0 primaries that
are not members, **16 contacts in more than one household**. Re-running the seed
is `0 inserted, 2,465 already present`; the merge re-run finds 0 groups (its
tiebreak now reads memberships, since `householdId` is gone); the Phase 1
backfill now **refuses** to run once memberships exist.

Two defects the rehearsal itself caught, both fixed: the drop migration left
`legacyHouseholdId_1` behind (that index comes from `index: true` on the
`@Prop`, so grepping the schema for `schema.index(` misses it), and the seed
copied `roleInHousehold: ''` onto 286 memberships as an empty string instead of
leaving the field absent.

Verified: `build -w @sfa/api` + `tsc -p packages/api`, 850 unit, 819 e2e in 26
suites, Bruno **201/201 requests, 583/583 tests**, run twice against one
database. `lint -w @sfa/api` is on its pre-existing baseline (same 7 files).

⚠ **Two environment traps this phase hit.** A running `npm run api:dev` applied
the Phase 3 migrations to the local dump *while they were still empty
scaffolds*, recording them as applied so the real ones could never run — stop
the watch server before touching migrations. And Bruno's
`Platform Mailer Campaigns` folder needs the API on **port 4000** (the Inngest
container's `-u` target) plus a running worker; on any other port those 12
requests fail for want of a queue, not a defect.

**Production has not been run for Phase 3 either.** Local rehearsal only. Next:
Phase 4 (`Contact.deceasedAt`, `POST /households/:id/primary-contact`), which is
also what resolves a household left without a primary.


**Phase 4 is done (2026-09-08) and rehearsed on the local dump.** `Contact.deceasedAt`
is a **date** (not a boolean, not a delete), and `POST /households/:id/primary-contact`
is the reassign operation that **did not exist for any reason at all** —
`Household.primaryContactId` was only ever *filled* by intake and never changed,
so a death, a divorce and a wrong primary picked at intake had no supported fix.
Reassignment is the first-class operation; the death flow in
`PATCH /contacts/:id` calls it, not the reverse.

Rules, all in `households/primary-contact.service.ts` (`PrimaryContactService`,
its own `PrimaryContactModule` because `clients` and `contacts` both perform it):
a new primary must be a **current member**, must **not be deceased**, and must
**not already lead another household** — pre-checked in application code so the
409 can name the other household, with the partial unique index as the backstop
(E11000 → the same 409). ⚠ On a database where Phase 3's index migration has not
run, the pre-check is the *only* enforcement.

`contactId: null` + `allowNoPrimary: true` is a legitimate answer and goes
beyond the plan's letter: it records "this household deliberately has no primary
contact" as `Household.dataQuality: 'no_primary'`. A bare `null` is a **400** —
a body that cleared the ref by accident is the one mistake a household record
cannot survive quietly. This is also **the tool that resolves the three
double-primary pairs blocking Phase 3's index migration**.

Marking a **primary contact** deceased requires an answer in the same request:
`successorContactId` (rule a) or `allowNoPrimary` (rule c). Without one it is a
**409 `primary_contact_succession_required`** carrying the household and every
eligible member — and it writes **nothing**, because succession is settled
*before* the contact is saved. Auto-promotion by role precedence (rule b) is
deliberately absent.

Forward-looking exclusions: the intake fuzzy matcher filters `deceasedAt: null`;
a *definite* identity hit on a deceased contact **refuses the submission**
(409 `contact_deceased`) rather than filing a lead against a dead person or
creating a duplicate the identity indexes would reject as a bare E11000 — those
indexes deliberately still cover deceased rows. Successor pickers, the
defensive-driver picker, quote prefill and every `tel:` / `mailto:` skip them;
the roster, the Lead Detail card and every historical record keep the name.

**No migration.** Both new fields are optional with nothing to backfill, and
neither is indexed (nothing queries them yet — `dataQuality`'s reader is Phase 5).

**Rehearsal (local `sfa`, from `pac91-before-phase4`).** Phase 4 changes no data,
so the rehearsal is behavioural: the services were driven against the dump
through a standalone Nest context (no HTTP — the dump's users carry a junk
password hash). Both guard rails fired on real records; the three double-primary
pairs were resolved **as a demonstration** (Rivera keeps HH-4775 with the 2
policies and the deal, Sarah Rivera leads HH-4774; dudley keeps HH-4792, karen
stoke leads HH-4790; Lubbers keeps HH-4527 and HH-4540 has no other member, so
it is flagged `no_primary`) — and `20260907172120-household-primary-contact-index.js`
**then applied**, `[PAC-91] built agencyId_1_primaryContactId_1`. Re-applying
every resolution changed nothing. **The database was restored afterwards**: the
three pairs are still David's decision, and `sfa` is back at 4 changelog entries
with the index absent.

⚠ **The rehearsal caught one defect, fixed:** clearing an already-cleared primary
appended another `primary_contact_changed` row reading `null → null`. Data
identical, timeline one row longer — the shape of history that makes an audit
trail useless. There is now a no-op guard and an e2e case for it.

⚠ **Deployment ordering.** Migration 3 runs at boot *before* the API binds a
port, so a deploy carrying Phase 3 and Phase 4 together stops at the wall and
never serves the UI that fixes it. Production therefore needs a stop point:
boot once with `DB_MIGRATE_ON_BOOT=false`, resolve the pairs through the new
endpoint, then restart with migrations on.

Verified: `build -w @sfa/api` + `tsc -p packages/api` + `build -w @sfa/web`,
**850** unit, **831** e2e in 26 suites, Bruno **208/208 requests, 606/606 tests**,
run twice against one database. `lint -w @sfa/api` is on its exact pre-existing
baseline (same 7 files, 140 problems); `lint -w @sfa/web` clean.

**Production has not been run for Phase 4 either.** Local rehearsal only. Next:
Phase 5 (the "unlinked records" work list, ticket §10).
