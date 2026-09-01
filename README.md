# AIOS-SFA

Operations platform for **Smith Family Agency**, an insurance agency — a
ground-up replacement for the legacy SFA app.

The old stack stitched together SmartSuite (data), Clerk (auth), Fillout
(intake forms) and BigQuery (reporting). This rebuild replaces all four with a
self-contained multi-tenant backend: **MongoDB**, built-in **JWT auth**, and
native forms. Existing users and their data migrate across.

---

## Requirements

- **Node >= 20** (npm workspaces)
- **Docker** — for MongoDB, MinIO, Redis and the Inngest dev server

## Quick start

```bash
cp .env.example .env        # one file serves both run modes; see "Configuration"
npm install
make dev                    # Mongo + MinIO + Redis + Inngest, in Docker
npm run api:seed:demo:dev   # first run against an empty database
```

Then, in two more terminals:

```bash
npm run api:dev             # http://localhost:4000/api/v1
npm run web:dev             # http://localhost:5173
```

Sign in as the demo agency owner: `owner@smithfamily.local` / `ChangeMe123!`.

### The two run modes

Split by Docker Compose **profile**. `mongo`, `minio`, `redis` and `inngest`
carry no profile, so they start in both modes; `api` and `web` sit behind
`--profile app`.

| | Command | What runs where |
|---|---|---|
| **Default dev loop** | `make dev` | Backing services in Docker, app on the host — real watch mode on both packages |
| **Everything in Docker** | `make up` | Verifies the built images. No hot reload |

Both want ports 4000 and 5173, so they can't run at once — `make dev` stops the
app containers for you. `make down` tears down either. Run `make help` for the
full list.

**Nothing auto-seeds in the default dev loop.** The auto-seed lives in the
containerised API's start command, which isn't running in that mode.

### Ports

Every service is on its **standard default port** — nothing is remapped, so any
client's out-of-the-box settings just work.

| Service | Address |
|---|---|
| Web | http://localhost:5173 |
| API | http://localhost:4000/api/v1 |
| MongoDB | `mongodb://localhost:27017/sfa` |
| MinIO | http://localhost:9000 (console `:9001`) |
| Redis | `redis://localhost:6379` |
| Inngest dashboard | http://localhost:8288 |

---

## Repository layout

npm workspaces, `packages/*`:

| Package | Stack |
|---|---|
| `packages/api` | NestJS 11, Mongoose 8 (MongoDB), JWT/passport, class-validator |
| `packages/web` | React 18, Vite 6, Tailwind 4, shadcn/ui, React Router 7, TanStack Query, TanStack Form + zod |
| `packages/shared` | Enums, permission constants, role templates, domain types — the source of truth for module keys and permission strings |

Supporting directories:

- **`bruno/`** — a version-controlled [Bruno](https://usebruno.com) collection of
  every implemented endpoint, with its permission, params, response shape and
  error codes in each request's `docs` block. **Read this first** to understand
  what the API exposes; it is faster than grepping controllers. Keep it in sync
  when you touch a controller or DTO.
- **`docs/`** — architecture, the form-pipeline spec, the legacy SmartSuite data
  model, and `SESSION-HANDOFF.md` (start there for current state).
- **`infra/terraform/`** — DigitalOcean infrastructure.
- **`scripts/`**, **`Makefile`**, **`docker-compose*.yml`** — local and deployed
  orchestration.

---

## Configuration

Copy `.env.example` → `.env`. **That one file serves both run modes.** Every
value in it is the host-mode (localhost) value; the Compose `api` service
overrides the few addresses that differ (`MONGODB_URI`, `CORS_ORIGIN`,
`REDIS_URL`, `STORAGE_*`) with compose-network ones.

> Never edit `.env` to switch modes. `.env.example` documents every variable,
> including which are optional and what happens when they are unset — several
> degrade **silently**, which is why the comments there are worth reading rather
> than skimming.

**Redis is optional at runtime.** With `REDIS_URL` set, resolved permission sets
are cached; without it, they resolve from MongoDB on every request. The
container runs either way, so uncommenting one line is the whole switch.

---

## Seeding

Three ways to populate MongoDB:

| Command | What you get |
|---|---|
| `npm run api:seed:dev` | **Platform minimum.** The super admin, plus an empty tenant scaffold (1 agency, 1 branch, 5 role templates) for the migration to import into. No demo users, no CRM data. This is what Docker runs on API startup. |
| `npm run api:seed:demo:dev` | **Full synthetic demo tenant** — a complete role roster and ~500 realistic records across every collection. Deterministic and idempotent; pass `--fresh` to purge and reseed. **Use this for local development.** |
| `npm run api:migrate:dev` | The real **SmartSuite → Mongo** import. Needs SmartSuite credentials; run the core seed first. |

After migrating, run `npm run api:backfill:deal-refs:dev` — it only rewrites
data already in Mongo, so it needs no credentials and is safe to re-run.

---

## Architecture notes

### Permissions and tenancy

`Platform (Super Admin) → Agency (tenant) → Branch → User`.

Every request passes eight global guards, in order (`app.module.ts`):

`TrustedProxyThrottlerGuard` → `JwtAuthGuard` → `AccessContextGuard` →
`HostTenantGuard` → `TenantGuard` → `BranchGuard` → `ModuleGuard` →
`PermissionsGuard`

- **Module keys** (`dashboard`, `leads`, `crm_service`, …) are toggled per
  agency by a super admin. Disabled means hidden nav *and* a 403 from the API.
- **Permissions** are `<module>:<read|write>` plus `platform:*` / `agency:*`.
  The effective set is role permissions + per-user grants − revokes, filtered to
  the agency's enabled modules.
- **Hostname binds the session.** `HostTenantGuard` refuses a token used on a
  hostname belonging to another agency, so white-labelling is a boundary rather
  than a coat of paint. See "White labelling" below.
- **Data scopes** are `own` · `branch` · `agency`.
- Authorization is resolved **live from the database**, not read off the JWT, so
  a permission change takes effect on the user's next request rather than at
  token expiry.

Keep every enum, permission string and role template in `packages/shared` —
never hard-code or duplicate them.

### White labelling

Each agency can serve the app on its own hostname — a subdomain of ours
(`texasholdings.smithfamily.agency`) or a domain they own (`texasholdings.com`)
— and it carries their logo and name through the app **and** into every outbound
email.

The hostname is not decoration. `HostTenantResolver` maps it to an agency via
the `agencyDomains` collection, and `HostTenantGuard` refuses any session used on
a hostname belonging to a different agency; the platform host admits super
admins only. A token minted on one tenant's host is rejected on another's.

- **Owners self-serve** at `/settings/branding`, `/settings/domains` and
  `/settings/email`, behind `agency:branding:*`, `agency:domains:*` and
  `agency:email:*`.
- **Custom domains prove ownership** with a `_sfa-verify` TXT record before they
  serve anything — `hostname` is unique platform-wide, so without proof the first
  agency to type a name would take it from whoever actually owns it.
- **TLS is automatic.** Caddy obtains a certificate on first request, gated by
  `GET /public/domains/allow` so we cannot be made to request certificates for
  domains we do not serve.
- **Logo assets:** square PNG/WebP with transparency, **256 × 256** (renders at
  32px, so 256 covers 4× displays); browser icon **128 × 128**; 2 MB cap; no SVG
  (it is executable markup served from our origin). The app renders it beside
  the agency name and inside a 56px collapsed rail, which is why square is the
  requirement rather than a preference — a wide banner is scaled to fit and ends
  up a sliver. Exact boxes live in `components/common/BrandMark.tsx`.
- **Email** carries the same logo, and an agency may verify its own sending
  domain. Until it verifies, mail goes out from the platform address under the
  agency's display name — sending from an unverified domain is rejected
  outright, so the fallback is deliberate.

An agency with **no domain yet** may still sign in on the platform host — it has
nowhere else to go, and without that exception deploying this would lock every
existing agency out. It closes the moment that agency gets its first domain.

Set `PLATFORM_HOST` (and `BASE_DOMAIN` for subdomains). To exercise it locally:

```bash
echo "127.0.0.1  app.sfa.local texasholdings.sfa.local" | sudo tee -a /etc/hosts
# then set PLATFORM_HOST / BASE_DOMAIN in .env and restart both dev servers
```

The dev server needs `changeOrigin: false`, an IPv4 `host` and `allowedHosts` for
this to work at all — all three are set and explained in
`packages/web/vite.config.ts`. Symptoms if one regresses: every tenant renders
the platform brand, a blank page, or `Blocked request. This host is not allowed.`

### Asynchronous work

Every outbound email and every scheduled job runs as an **Inngest** function
served from `packages/api/src/worker/`. The API hands work over by emitting a
typed event from `src/inngest/events/` — it never calls the worker directly,
which is what keeps the worker liftable into its own container (a `WORKER_INLINE`
config change, not a refactor). An ESLint boundary enforces that separation.

Events are also written to MongoDB before they reach Inngest, so work that never
made it to the queue can be recovered and failed runs are queryable from the
application.

### The intake pipeline

A four-phase, session-isolated form flow that replaces the legacy Fillout forms:
**Household → Quote → Sold Deal → Audit Record**, with the audit auto-generated
on sold submission. Forms are completed days apart and state is persisted to the
backend between them — this is not a single frontend wizard. Spec lives in
`docs/form-pipeline/`.

---

## Testing

```bash
npm run test:e2e                        # API e2e — needs `make dev` running
npm run test:unit -w @sfa/api           # unit only, no database needed
npm test -w @sfa/api                    # everything
```

Unit tests are `*.unit-spec.ts` and live beside the code; e2e tests are
`*.e2e-spec.ts` under `packages/api/test/` and run against a real MongoDB.

Lint before finishing — the API's lint enforces the worker import boundary:

```bash
npm run lint -w @sfa/api
npm run lint -w @sfa/web    # tsc --noEmit
```

To exercise the API by hand, run the Bruno collection:

```bash
cd bruno && npx @usebruno/cli run --env Local
```

---

## Deployment

DigitalOcean droplets provisioned by Terraform (`infra/terraform/`), deployed by
GitHub Actions. Inngest runs self-hosted on its own droplet.

See **[DEPLOYMENT.md](DEPLOYMENT.md)** for the environment secrets, the deploy
workflow and the operational warnings — including several settings whose absence
causes a *silent* failure rather than a loud one.

---

## Further reading

| Document | What's in it |
|---|---|
| [`docs/SESSION-HANDOFF.md`](docs/SESSION-HANDOFF.md) | Most current state and open questions — **start here** |
| [`docs/SYSTEM_ARCHITECTURE.md`](docs/SYSTEM_ARCHITECTURE.md) | System architecture and diagrams |
| [`docs/form-pipeline/`](docs/form-pipeline/) | Lead → Quote → Sold → Audit specification |
| [`bruno/README.md`](bruno/README.md) | Using and extending the API collection |
| [`AGENTS.md`](AGENTS.md) | Conventions and context for coding agents — also the fullest single description of the codebase |
| [`DEPLOYMENT.md`](DEPLOYMENT.md) | Infrastructure and deploys |

Issue tracking is in Linear: team **Paciscigroup**, project **SFA**, prefix
`PAC-`.

Trigger 1
