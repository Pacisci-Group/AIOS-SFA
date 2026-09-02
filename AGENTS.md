# AGENTS.md — AIOS-SFA (new platform)

> Auto-loaded by coding agents opened at the `AIOS-SFA/` repo root (Claude Code
> reads it via the `@AGENTS.md` import in `CLAUDE.md`). This is the
> **new, greenfield replacement** for the legacy SFA app. Three read-only reference
> checkouts are symlinked in (gitignored, never committed here):
> - `./SFA` → legacy Next.js app, **source-of-truth for behaviour** being ported —
>   see `.claude/rules/legacy-sfa-reference.md`.
> - `./agencyops_fe_mockups` → Figma FE mockups (design screenshots + exported
>   React components/CSS + agent-context docs), **source-of-truth for UI/design** —
>   see `.claude/rules/figma-mockups-reference.md`.
> - `./sfaforms` → standalone Next.js prototype of the Lead→Quote→Sold→Audit
>   intake forms (localStorage mock API), **behavioural reference for the native
>   forms** replacing Fillout — see `.claude/rules/sfaforms-reference.md`.
>
> **Never edit, create, or delete anything under `./SFA`, `./agencyops_fe_mockups`
> or `./sfaforms`.** They are read-only reference checkouts; all work goes in
> `packages/*`.

---

## 1. What this is

**AIOS-SFA** is the rebuild of **SFA (Smith Family Agency)** — an insurance-agency
operations SaaS. Goal: rebuild the app with improved UI/UX, a self-contained
multi-tenant backend, and migrate existing users over smoothly. Replaces the
legacy stack (SmartSuite + Clerk + Fillout + BigQuery) with MongoDB + built-in
JWT auth + native forms.

**Repo:** `github.com/mastaers/AIOS-SFA`.

---

## 2. Monorepo layout & stack

| Package | State |
|---|---|
| `packages/web` | Auth + **permission-management pages wired to the API**; the 7 mockup dashboards still render **hard-coded mock data** (Producer Dashboard data widgets being wired now) |
| `packages/api` | Full **permission/multi-tenancy spine** + **Mongoose schemas for all ~22 domain collections** + a **SmartSuite→Mongo migration**; the HTTP **feature controllers are still stubs** returning `{ status: 'ready' }` (real query services/DTOs not wired yet) |
| `packages/shared` | Source of truth for module keys & permissions |

---

## 3. Running it

Two run modes (backing services in Docker with the app on the host, or
everything in Docker), the three ways to populate Mongo, and what each seed /
migration actually writes: **invoke the `running-the-stack` skill**
(`.claude/skills/running-the-stack/SKILL.md`). Deployment notes in `DEPLOYMENT.md`.

---

## 4. Web app — the 7 mockup dashboards (`packages/web`)

Dev "Screen Navigator" at `/` (`src/pages/DevNavPage.tsx`) links all 7; routes in
`src/app/App.tsx`, all behind `ProtectedRoute`. The **design source-of-truth** for
each screen is the matching Figma-mockup folder in `./agencyops_fe_mockups`
(read-only symlink — see `.claude/rules/figma-mockups-reference.md`).

| Screen | Route | Persona |
|---|---|---|
| **Producer Dashboard** ← current focus | `/dashboard/producer` | Sales producer (`DataScope = own`) |
| Lead Details | `/leads/:id`, `/leads/demo` | Producer |
| Management v1 | `/dashboard/management` | Owner + Manager |
| Management v2 (actually an "Agency Command Center" / lead-distribution board — clarify intent) | `/dashboard/management-alt` | Owner/Manager |
| Service Dashboard | `/crm/service` | Service rep |
| Ticket Workspace | `/crm/tickets` | CRM/service |
| Household Details | `/clients/:id`, `/clients/demo` | 360° client view |

---

## 5. API — permission & tenancy spine (`packages/api` + `packages/shared`)

**Hierarchy:** `Platform (Super Admin) → Agency (tenant) → Branch → User`;
**data scopes** `own` · `branch` · `agency`. The global guard chain order is
load-bearing and the permission *strings* are the contract for the guards and the
whole web app — full detail in `packages/api/CLAUDE.md`, which loads whenever you
work under `packages/api`.

A tenant is created one of three ways: the **SmartSuite migration** (the real
agency), the **demo seed** (a throwaway one), or the Super Admin panel's
**Onboard Agency** wizard (PAC-69) at `/admin/agencies/onboard`, which is the
only one that also creates a user — the agency's owner, invited by email. The
owner then completes a two-phase onboarding: personal (name + password) and a
skippable agency white-label phase, tracked by `Agency.setup`.

---

## 6. Domain model — Lead → Quote → Sold → Audit pipeline

A **4-phase, session-isolated form pipeline** (forms completed days apart; state
passed via URL params `householdId`/`quoteId` and persisted to the backend — NOT
a single frontend wizard). This is the **custom native-forms replacement for
Fillout** and is net-new scope.

1. **Household** — living address + array of contacts (Primary, Spouse, Child, Driver, Additional Named Insured). `POST /api/households → householdId`.
2. **Quote** — proposal linked to Household (policy types multi-select, premium + item count, conditional property address w/ "Same as Household" toggle, doc upload, notes). `POST /api/quotes → quoteId`.
3. **Sold Deal** — multi-step "card" wizard (Sold Date → Policy Type → Basic Details w/ `GET /api/policies/check` dedupe → Financials → **Discounts & Required Docs, Card 5 highly conditional** → Prior Insurance → Cancellation → Loop). `POST /api/sold-deals` → **auto-triggers audit**.
4. **Audit Record** — compliance checklist auto-generated on Sold submission (`POST /api/audit-records`) with dynamic flags from Card 5 (escrow, inspection, fire/roof receipts, Drivewise, defensive-driver certs, student transcript). This is the producer → office-manager/service "hand-off".

---

## 7. Cross-cutting product rules

- **Allstate color identity**; full **light + dark** themes.
- **Permission-based** UI gating. Roles are real (and relational), but every gate checks a *permission*, never a role name — `usePermissions().can(...)`, never `user.roles.includes(...)`. Role names are display only.
- **Dynamic data:** global fuzzy omni-search; **real-time faceted filtering** (instant, no "Apply" button); **data masking** (raw IDs shown as human-readable labels, e.g. `TKT-2026-004`).
- **Layout:** asymmetric **60/40** or **3-column** splits on detail pages.

---

## 8. Current focus — Producer Dashboard

Wire `/dashboard/producer` to the new API (first fully-wired dashboard). Schemas +
migration are in place (PAC-18); what's left is the API read path + FE wiring per
widget. Collections all exist:
- Scorecards (Sold/Quoted) → `performance:read` → collections `quoteRecaps`, `deals`, `households`.
- Leaderboard / Motivation Hub → `leaderboard:read` (**aggregates only**, never cross-producer rows). Uses `producerGoals` collection (schema exists, derived during migration) for "% to goal".
- Deals Pending Service Hand-off → `deal_audits:read/write` → `auditRecords` (from Sold pipeline). ← current sub-story (PAC-12, in progress).
- Hot Leads / Priority Contact List → `leads:read/write` → `leads`, `activities`.

**Open decisions:** derive deal "type" (Auto/Home/Bundle) and lead
temperature/aging that aren't first-class in legacy payloads. See
`docs/SESSION-HANDOFF.md` for full state.

---

## 9. Project management — Linear

- Team **Paciscigroup**, project **SFA**, issue prefix **`PAC-`** (Linear MCP available).
- **PAC-6** — Platform Rebuild architecture & migration plan (**Done**; mirrors `docs/SYSTEM_ARCHITECTURE.md`).
- **PAC-7** — [Epic] Producer Dashboard (**in progress**). Sub-story breakdown and
  live status: read Linear (MCP available) rather than this file.
- **PAC-19** — [Epic] CSR Role & Pages (backlog).

---

## 10. Reference docs (`docs/`)

- `docs/SYSTEM_ARCHITECTURE.md` — new system architecture (v1.0) + `docs/diagrams/`.
- `docs/SESSION-HANDOFF.md` — most up-to-date session state, mappings, open questions. **Start here for continuation.**
- `docs/form-pipeline/` — Lead→Quote→Sold→Audit spec (`Form Pipeline Technical Specification.md`) + architecture guide. Working prototype of the same flow lives in `./sfaforms` (read-only symlink — see `.claude/rules/sfaforms-reference.md`).
- `docs/product/Figma Mockups.md` — design system + product direction (owner notes).
- `docs/smartsuite-tables/` — legacy SmartSuite data model (migration source-of-record).
- `bruno/` — **API surface source-of-truth**: a version-controlled Bruno
  collection of every implemented endpoint (URL, params, headers, body,
  response shape, module + permission, error codes) in each request's `docs`
  block. **Read this first to understand what the API exposes / how to call it**
  before grepping controllers. Run it with
  `cd bruno && npx @usebruno/cli run --env Local` → see `bruno/README.md` and
  `.claude/rules/api-bruno-docs.md`.
- `./agencyops_fe_mockups/` — **read-only symlink** to the Figma FE mockups repo
  (design screenshots, exported React components/CSS, per-dashboard `guidelines/`).
  UI design source-of-truth — see `.claude/rules/figma-mockups-reference.md`.

> ⚠ The form-pipeline docs mention **Next.js** + a **localStorage mock API** —
> these predate the monorepo decision. Reality: `packages/web` is **Vite/React**
> and the backend is **NestJS/Mongo**. Do not build localStorage mocks.

---

## 11. Conventions

### UI: shadcn/ui is the component base (`packages/web`)

The web app is built on **shadcn/ui** — Radix UI primitives + Tailwind, with the
component **source copied into the repo** (we own & edit it). This is the base for
the whole app; do **not** introduce a second component library (MUI, Radix Themes,
Chakra, etc.). **Style with design tokens from `src/styles/theme.css`, never
hard-coded hex/inline styles, and keep light + dark at parity.**

The full rules — token traps, theme mechanics, the typography scale, and how much
freedom we have over the mockups — live in `packages/web/CLAUDE.md`, which loads
whenever you work under `packages/web`.

### General

- Keep shared enums/permissions/types in `packages/shared` — never hard-code or duplicate module keys / permission strings.
- Every new API endpoint goes through the guard chain and declares its module + required permission + data scope.
- **Anything that builds a user-facing URL must go through `TenantUrlService.baseUrlFor(agencyId)`**, never `APP_BASE_URL` / `PUBLIC_FORM_BASE_URL` directly. A link on the wrong host is not merely off-brand — `HostTenantGuard` rejects the recipient there, so the link is broken. Same for the logo URL in an email, which must be absolute and unauthenticated.
- **Mirror every new/changed API endpoint in the Bruno collection (`bruno/`)** — our version-controlled API docs + test client. Add/update the matching `.bru` request (with a real `docs` block) and verify with `cd bruno && npx @usebruno/cli run --env Local`. See `.claude/rules/api-bruno-docs.md` and `bruno/README.md`.
- TypeScript strict; functional React components with named exports; keep reusable UI modular.
- Forms: prefer **TanStack Form** + `zod` (wired via Standard Schema — pass the
  zod schema straight to `validators`, no resolver package). Build forms from the
  shared `useAppForm` hook in `src/hooks/form.ts` and the field components in
  `src/components/form/fields/`; never bind an input to the library by hand.
  **Field components take a field-path prop and must never hardcode a path** —
  that is what makes a schema rename a compile error instead of a runtime break.
  Layout comes from `src/components/form/` (`FormSection`, `FormGrid`, …), which
  is deliberately library-agnostic. Reusable fragments shared by more than one
  form are `withFieldGroup`/`withForm` components taking a `fields`/`form` prop
  — never a component that reaches for the form off context and names its own
  paths. react-hook-form is fully removed; there is no second forms idiom.
  Two API traps are written up in `docs/tanstack-form-spike-findings.md` —
  read it before touching the Sold wizard's per-card validation.
- Preserve `legacySmartSuiteId` on any schema that maps to legacy data (migration reconciliation).
- **Changing the *options* of an existing index needs a migration script.** Mongoose's `autoIndex` only creates indexes that are missing — it never rebuilds one whose options changed. Editing the schema therefore fixes only collections created *afterwards*, and silently leaves existing ones on the old definition (this is how the `agencyId + legacySmartSuiteId` dedupe index stayed `sparse` on three collections after being corrected to a partial filter, breaking lead creation with E11000). Write a one-off script that discovers affected collections by index name rather than hard-coding them (which collections are stale depends on when each was created, so it differs per environment), checks for conflicting data *before* dropping — rebuilding a unique index over real duplicates fails, and failing after the drop leaves no uniqueness at all — and stays idempotent. `git log -- packages/api/src/migration/backfill/fix-legacy-dedupe-indexes.ts` has a worked example; the script itself was deleted once production had no database old enough to need it.
- **`createdBy` / `updatedBy` are stamped for you — except on `bulkWrite`.** `authorshipPlugin` (`src/common/mongo/authorship.plugin.ts`) is registered connection-wide and fills both fields from the request context for `save()`/`create()`, `updateOne`, `updateMany`, `findOneAndUpdate` and `insertMany` on every schema extending `TenantRecord`. **`Model.bulkWrite()` bypasses Mongoose middleware entirely**, so a bulk call site that should record an author must spread `authorshipForInsert()` into the document itself — see `AuditGenerationService.buildItem`. Writes with no request context (migration, seeds, the worker) leave both null, which reads as "system"; never mint a placeholder user id, and never backfill.
- Run each package's `lint` (`npm run lint -w @sfa/api` / `-w @sfa/web`) before finishing.
- Prefer real Mongoose schemas + services over extending the mock data / stubs when wiring a dashboard.
