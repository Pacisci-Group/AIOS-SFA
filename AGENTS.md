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
| `packages/web` | React 18, **Vite 6**, TypeScript, **Tailwind 4**, **shadcn/ui (Radix UI primitives)**, React Router 7, TanStack Query, **TanStack Form + zod**, Recharts, lucide-react | Auth + **permission-management pages wired to the API**; the 7 mockup dashboards still render **hard-coded mock data** (Producer Dashboard data widgets being wired now) |
| `packages/api` | **NestJS 11**, **Mongoose 8 (MongoDB)**, JWT/passport, class-validator | Full **permission/multi-tenancy spine** + **Mongoose schemas for all ~22 domain collections** + a **SmartSuite→Mongo migration**; the HTTP **feature controllers are still stubs** returning `{ status: 'ready' }` (real query services/DTOs not wired yet) |
| `packages/shared` | Shared enums / permission constants / types / role templates | Source of truth for module keys & permissions |

---

## 3. Running it

Env first: copy `.env.example` → `.env`. That one file serves **both** run modes
— every value in it is the host-mode (localhost) value, and the compose `api`
service overrides the few addresses that differ (`MONGODB_URI`, `CORS_ORIGIN`,
`REDIS_URL`, `STORAGE_*`) with compose-network ones. Never edit `.env` to switch
modes. Deployment notes in `DEPLOYMENT.md`.

### Two run modes

Split by **compose profile** in `docker-compose.yml`: `mongo`, `minio` and
`redis` (+ the two one-shot init containers) carry no profile so they start in
both modes; `api` and `web` sit behind `profiles: [app]`.

**a) Backing services in Docker, app on the host — the default dev loop.** Real
watch mode on both packages.

```bash
make dev                   # Mongo + MinIO + Redis only (alias: make infra)
npm run api:seed:demo:dev  # first run against an empty DB (see below)
npm run api:dev            # NestJS API (watch)  -> :4000
npm run web:dev            # Vite web app        -> :5173
```

**Nothing auto-seeds in this mode** — the auto-seed lives in the containerized
API's start command, which isn't running.

**b) Everything in Docker.** Verifies the built images; no hot reload.

```bash
make up                    # build + start all six services
```

The two modes both want ports 4000/5173, so they can't run at once — `make dev`
stops the app containers for you. `make down` tears down either.

- Web: `http://localhost:5173` · API: `http://localhost:4000/api/v1`
- Mongo: `mongodb://localhost:27017/sfa` · MinIO: `:9000` (console `:9001`) · Redis: `:6379`

Every service is published on its **standard default port** — nothing is
remapped, so any client's out-of-the-box connection settings just work.

Redis is **optional at runtime**: the API caches resolved permission sets only
when `REDIS_URL` is set, otherwise it reads MongoDB per request. The container
runs regardless, so uncommenting `REDIS_URL` in `.env` is the whole switch and it
applies identically in both modes.

Other workspace scripts (from repo root — see `package.json`):

```bash
npm run shared:build       # build shared package
npm run api:seed:dev       # core seed: super admin + empty tenant scaffold (agency, branch, roles)
npm run api:seed:demo:dev  # seed a full synthetic demo tenant (CRM data for local testing)
npm run api:migrate:dev    # run SmartSuite -> Mongo migration (dev)
npm run test:e2e           # API e2e tests
```

> **Three ways to populate Mongo:**
> - `api:seed:dev` — **core / platform-required seed only**: the platform super
>   admin (the one login), plus an **empty tenant scaffold** (1 agency, 1 branch,
>   5 role templates) that the migration imports into. **No demo login users, no
>   CRM data.** This is the minimum required for the app to function and is what
>   Docker runs on API startup. Global catalog data (plans, feature definitions,
>   constants) is seeded here too as those collections come online. For a
>   populated agency to test against, use `api:seed:demo:dev` instead.
> - `api:seed:demo:dev` — **full synthetic demo tenant** for local build/test
>   (`src/seed/demo/`): the same "Smith Family Agency" + a 2nd branch, a complete
>   role roster (owner, manager, 5 producers, 2 CRMs, data team — all
>   `ChangeMe123!`), and ~500 realistic CRM records across **every** collection
>   (households, contacts, leads, quotes, deals, policies, audit/hand-off items,
>   service tickets, goals, activities, …). Deterministic (fixed RNG seed) and
>   **idempotent** (upserts on stable `demo:*` keys); pass `--fresh` to purge and
>   reseed. No SmartSuite/network needed. "Pat Producer"
>   (`producer@smithfamily.local`) is the data-rich hero for the Producer Dashboard.
> - `api:migrate:dev` — real **SmartSuite → Mongo** import; needs SmartSuite
>   credentials (run `api:seed:dev` first). BigQuery (legacy mailer prospect data)
>   is **not migrated** — deferred (see arch doc O2).
>
> **After migrating, run `api:backfill:deal-refs:dev`** (deal/recap links +
> policy match keys) — it only rewrites data already in Mongo, so it needs no
> credentials and is safe to re-run. Household `HH-…` references need no
> backfill: the migration and the demo seed each reconcile them at the end of
> their household pass, so whichever one populated the database leaves the
> numbering consistent.

---

## 4. Web app — the 7 mockup dashboards (`packages/web`)

Dev "Screen Navigator" at `/` (`src/pages/DevNavPage.tsx`) links all 7; routes in
`src/app/App.tsx`, all behind `ProtectedRoute`. The **design source-of-truth** for
each screen is the matching Figma-mockup folder in `./agencyops_fe_mockups`
(read-only symlink — see `.claude/rules/figma-mockups-reference.md`).

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
- **Migration key:** `User`/`TenantRecord` carry `legacySmartSuiteId`. The core seed (`src/seed/seed.ts`) is **platform-required data only** — it creates the **platform super admin** plus an **empty tenant scaffold** (agency "Smith Family Agency" + Main branch + default roles) as the migration target. It creates **no demo login users and no CRM data**; a fully populated agency comes from the demo seed (`src/seed/demo/`).
- **Schemas exist; read path does not.** Mongoose schemas now exist for every domain collection (`src/<domain>/schemas/*.schema.ts`, most extending `src/common/schemas/tenant-record.schema.ts`) and are populated by the SmartSuite→Mongo migration (`src/migration/`). The HTTP **feature controllers are still stubs** (`src/feature-modules/feature.controllers.ts`) returning `{ status: 'ready' }` — add real query services/DTOs there as dashboards get wired.

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
- **PAC-7** — [Epic] Producer Dashboard (**in progress**). Done sub-stories: **PAC-8** (dashboard shell + page-level read/write permission model), **PAC-18** (SmartSuite→Mongo migration), **PAC-25** (authz resolved from backend store, not JWT). In progress: **PAC-12** (Deals Pending Service Hand-off board, read). Remaining: scorecards (PAC-10/11), time-range filter (PAC-9), leaderboard (PAC-13), hot leads + quick actions (PAC-15/16), add-lead + ⌘K omni-search (PAC-17), resolve hand-off item (PAC-14).
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
Chakra, etc.).

- **Primitives live in `src/components/ui/`** and are managed by the shadcn CLI —
  add new ones with `npx shadcn@latest add <component>` (from `packages/web`),
  don't hand-write them. Config is `packages/web/components.json`
  (style `new-york`, `cssVariables: true`, icon library `lucide`).
- **`cn` util is `@/lib/utils`** (shadcn convention). Use it for dynamic classes;
  do not use Tailwind `@apply`.
- **Generated `radix-ui` (unified package)** backs the primitives — the older
  individual `@radix-ui/react-*` deps are legacy and being removed.
- **Compose, don't fork.** Build features from `ui/` primitives (`Card`, `Button`,
  `Table`, `Badge`, `Dialog`, `Sheet`, …). App-specific composites live in the
  relevant `features/*` folder, never in `components/ui`. Add variants via `cva`
  inside the primitive rather than one-off wrappers.
- **Style with design tokens, never hard-coded hex/inline styles.** The mockup
  palette is encoded as CSS-variable tokens in `src/styles/theme.css`
  (`bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`,
  `border-border`, `text-primary` = Allstate sky, `text-success` = emerald,
  `text-destructive` = amber). **Tokens theme automatically; raw palette values
  do not.** ⚠ `--accent` is **not** the brand emerald — it is shadcn's subtle
  hover/focus surface (`focus:bg-accent` on every menu item, `hover:bg-accent` on
  ghost buttons, `bg-accent` on `Skeleton`). It held emerald until PAC-56, which
  is why menus and skeletons rendered green. The brand emerald is `--success`. `theme.css` defines the light theme on `:root` and the navy brand
  theme on `.dark`, so anything written as `amber-500`, `slate-400`,
  `white/[0.04]` or a hex literal is a *dark-only* value that will be wrong —
  often invisible — on the light theme. Reach for the token
  (`text-destructive`, `text-muted-foreground`, `border-border`, `bg-sunken`)
  first. Note the two are not interchangeable even where they look it: Tailwind
  v4's `amber-500` is `oklch(0.769 0.188 70.08)`, which is *not* quite
  `--destructive`'s `#F59E0B`.
- **Theme mechanics.** `app/ThemeProvider.tsx` (next-themes) owns the
  `light`/`dark` class on `<html>`; an inline script in `index.html` writes it
  before first paint to avoid a flash. It defaults to **dark** with system
  detection **off** on purpose — the navy theme is what the app shipped as, and
  enabling system detection would silently repaint every existing user whose OS
  is light. When a light fix would shift the dark rendering, pin the original
  with a `dark:` override rather than accepting the drift (see
  `components/form/FormError.tsx`).
- The 5 prototype dashboards (management, management-alt, service, tickets,
  household) are **not** light-theme clean and are not meant to be — they are
  slated for replacement. They also reference ~9 CSS variables (`--kpi-*`,
  `--navy-900`, `--emerald`, `--red`, `--amber`) that are defined nowhere and
  render transparent. Don't copy those patterns into new work.
- **We own UI/UX. The mockups are the starting point, not a contract.** There is
  no dedicated designer on this team, and the product owner has said explicitly
  that UI/UX calls are ours. `./agencyops_fe_mockups` is where a screen's layout,
  spacing and visual language come *from* (see
  `.claude/rules/figma-mockups-reference.md`) — but where a mockup produces
  something confusing, unreadable or unbuildable against the real data, **improve
  it rather than porting the problem**. Three standing constraints on that
  freedom: stay inside the **shadcn/ui design language** (compose `ui/`
  primitives, add variants via `cva`, no second component library), stay inside
  the **`theme.css` token palette**, and keep **light + dark** at parity. Say in
  the PR what you changed and why, so it can be put to the owner in one batch.
  Where the design asks for data we do not capture, the honest move is to say so
  (see the docblock on `QuoteRecapCard.tsx`), not to render empty rows.
- **Follow the type & sizing scale** in `packages/web/src/styles/TYPOGRAPHY.md` —
  text roles, icon sizes, radii and the "every clickable thing goes through
  `Button`" rule. It exists because the first pass over Leads/Lead Detail drifted
  into three competing label tiers and the same pill at three sizes.

### General

- Keep shared enums/permissions/types in `packages/shared` — never hard-code or duplicate module keys / permission strings.
- Every new API endpoint goes through the guard chain and declares its module + required permission + data scope.
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
- Run each package's `lint` (`npm run lint -w @sfa/api` / `-w @sfa/web`) before finishing.
- Prefer real Mongoose schemas + services over extending the mock data / stubs when wiring a dashboard.
