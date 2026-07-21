# AGENTS.md — AIOS-SFA (new platform)

> Auto-loaded when Cursor is opened at the `AIOS-SFA/` repo root. This is the
> **new, greenfield replacement** for the legacy SFA app. Two read-only reference
> checkouts are symlinked in (gitignored, never committed here):
> - `./SFA` → legacy Next.js app, **source-of-truth for behaviour** being ported —
>   see `.cursor/rules/legacy-sfa-reference.mdc`.
> - `./agencyops_fe_mockups` → Figma FE mockups (design screenshots + exported
>   React components/CSS + agent-context docs), **source-of-truth for UI/design** —
>   see `.cursor/rules/figma-mockups-reference.mdc`.

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

npm workspaces (`workspaces: ["packages/*"]`, Node >= 20):

| Package | Stack | State |
|---|---|---|
| `packages/web` | React 18, **Vite 6**, TypeScript, **Tailwind 4**, Radix UI, React Router 7, TanStack Query, Recharts, lucide-react | Figma mockups render from **hard-coded mock data**; auth + api-client scaffolded but **no dashboard is wired to the API yet** |
| `packages/api` | **NestJS 11**, **Mongoose 8 (MongoDB)**, JWT/passport, class-validator | Full **permission/multi-tenancy spine**; every domain module is an **empty stub** returning `{ status: 'ready' }` (no schemas/queries/data yet) |
| `packages/shared` | Shared enums / permission constants / types / role templates | Source of truth for module keys & permissions |

---

## 3. Running it

Workspace scripts (from repo root — see `package.json`):

```bash
npm run api:dev        # NestJS API (watch)
npm run web:dev        # Vite web app
npm run shared:build   # build shared package
npm run api:seed:dev   # seed dev data
npm run api:migrate:dev# run SmartSuite -> Mongo migration (dev)
npm run test:e2e       # API e2e tests
```

Docker (see `Makefile` / `docker-compose.yml`): `make up` starts Mongo + API + web.
- Web: `http://localhost:5173`
- API: `http://localhost:4000/api/v1`
- Mongo: `mongodb://localhost:27017/sfa`

Env: copy `.env.example` → `.env`. Deployment notes in `DEPLOYMENT.md`.

---

## 4. Web app — the 7 mockup dashboards (`packages/web`)

Dev "Screen Navigator" at `/` (`src/pages/DevNavPage.tsx`) links all 7; routes in
`src/app/App.tsx`, all behind `ProtectedRoute`. The **design source-of-truth** for
each screen is the matching Figma-mockup folder in `./agencyops_fe_mockups`
(read-only symlink — see `.cursor/rules/figma-mockups-reference.mdc`).

| Screen | Route | Persona | Design mockup folder |
|---|---|---|---|
| **Producer Dashboard** ← current focus | `/dashboard/producer` | Sales producer (`DataScope = own`) | `Insurance-Producer-Dashboard` |
| Lead Details | `/leads/:id`, `/leads/demo` | Producer | `Insurance-Lead-Details` |
| Management v1 | `/dashboard/management` | Owner + Manager | `Insurance-Management-Dashboard` |
| Management v2 (actually an "Agency Command Center" / lead-distribution board — clarify intent) | `/dashboard/management-alt` | Owner/Manager | `Insurance-Management-Dashboard-2` |
| Service Dashboard | `/crm/service` | Service rep | `Insurance-Service-Dashboard-Design` |
| Ticket Workspace | `/crm/tickets` | CRM/service | `Insurance-Dashboard-Design` |
| Household Details | `/clients/:id`, `/clients/demo` | 360° client view | `Insurance-Household-Details` |

---

## 5. API — permission & tenancy spine (`packages/api` + `packages/shared`)

- **Hierarchy:** `Platform (Super Admin) → Agency (tenant) → Branch → User`.
- **Global guards** (in `app.module.ts`): `JwtAuthGuard` → `TenantGuard` → `BranchGuard` → `ModuleGuard` → `PermissionsGuard`.
- **Data scopes:** `own` · `branch` · `agency`.
- **Module keys** (`shared/src/enums/module-key.enum.ts`): `dashboard, leads, quote_recaps, mailers, crm_service, clients, deal_audits, onboardings, management, owner_dashboard, command_center, performance, leaderboard`. Toggled per agency by Super Admin; disabled ⇒ hidden nav + API 403.
- **Permissions** (`shared/src/permissions/permission.constants.ts`): `"<module>:<read|write>"` + `platform:*` / `agency:*`. Effective set resolved in `resolve-permissions.ts` (role perms + grants − revokes, filtered to agency-enabled modules).
- **Default role templates** (`shared/src/permissions/default-role-templates.ts`): Agency Owner (agency) · Branch Manager (branch) · Producer (**own**: `dashboard:read, leads:r/w, quote_recaps:r/w, performance:read, leaderboard:read`) · CRM (branch) · Data Team (agency).
- **Migration key:** `User`/`TenantRecord` carry `legacySmartSuiteId`. Seed (`src/seed/seed.ts`) creates agency "Smith Family Agency", a Main branch, super admin, and an agency owner.
- **Domain modules are stubs** (`src/feature-modules/feature.controllers.ts`) — add real schemas/services/DTOs here as dashboards get wired.

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
- **Permission-based** UI gating (not RBAC).
- **Dynamic data:** global fuzzy omni-search; **real-time faceted filtering** (instant, no "Apply" button); **data masking** (raw IDs shown as human-readable labels, e.g. `TKT-2026-004`).
- **Layout:** asymmetric **60/40** or **3-column** splits on detail pages.

---

## 8. Current focus — Producer Dashboard

Wire `/dashboard/producer` to the new API (first fully-wired dashboard).
- Scorecards (Sold/Quoted) → `performance:read` → collections `quoteRecaps`, `deals`, `households`.
- Leaderboard / Motivation Hub → `leaderboard:read` (**aggregates only**, never cross-producer rows). Needs **new** `producerGoals` collection for "% to goal".
- Deals Pending Service Hand-off → `deal_audits:read/write` → `auditRecords` (from Sold pipeline).
- Hot Leads / Priority Contact List → `leads:read/write` → `leads`, `activities`.

**Open decisions:** grant Producer `deal_audits:read/write` (own) for the hand-off
board? · derive deal "type" (Auto/Home/Bundle) and lead temperature/aging that
aren't first-class in legacy payloads. See `docs/SESSION-HANDOFF.md` for full state.

---

## 9. Project management — Linear

- Team **Paciscigroup**, project **SFA**, issue prefix **`PAC-`** (Linear MCP available).
- **PAC-6** — Platform Rebuild architecture & migration plan (mirrors `docs/SYSTEM_ARCHITECTURE.md`).
- **PAC-7** — [Epic] Producer Dashboard (in progress).

---

## 10. Reference docs (`docs/`)

- `docs/SYSTEM_ARCHITECTURE.md` — new system architecture (v1.0) + `docs/diagrams/`.
- `docs/SESSION-HANDOFF.md` — most up-to-date session state, mappings, open questions. **Start here for continuation.**
- `docs/form-pipeline/` — Lead→Quote→Sold→Audit spec (`Form Pipeline Technical Specification.md`) + architecture guide.
- `docs/product/Figma Mockups.md` — design system + product direction (owner notes).
- `docs/smartsuite-tables/` — legacy SmartSuite data model (migration source-of-record).
- `./agencyops_fe_mockups/` — **read-only symlink** to the Figma FE mockups repo
  (design screenshots, exported React components/CSS, per-dashboard `guidelines/`).
  UI design source-of-truth — see `.cursor/rules/figma-mockups-reference.mdc`.

> ⚠ The form-pipeline docs mention **Next.js** + a **localStorage mock API** —
> these predate the monorepo decision. Reality: `packages/web` is **Vite/React**
> and the backend is **NestJS/Mongo**. Do not build localStorage mocks.

---

## 11. Conventions

- Keep shared enums/permissions/types in `packages/shared` — never hard-code or duplicate module keys / permission strings.
- Every new API endpoint goes through the guard chain and declares its module + required permission + data scope.
- TypeScript strict; functional React components with named exports; keep reusable UI modular. Use a `cn` (clsx + tailwind-merge) utility for dynamic classes — do not use Tailwind `@apply`.
- Forms: prefer `react-hook-form` + `zod` resolvers.
- Preserve `legacySmartSuiteId` on any schema that maps to legacy data (migration reconciliation).
- Run each package's `lint` (`npm run lint -w @sfa/api` / `-w @sfa/web`) before finishing.
- Prefer real Mongoose schemas + services over extending the mock data / stubs when wiring a dashboard.
