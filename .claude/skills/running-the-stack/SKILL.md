---
name: running-the-stack
description: How to run, seed, and migrate the AIOS-SFA stack locally — the two run modes (backing services in Docker vs. everything in Docker), what .env does across both, and the three ways to populate Mongo (core seed, demo seed, SmartSuite/BigQuery migrations). Use when starting the dev loop, seeding or resetting the database, running a migration, or debugging why a local service or seed is not behaving.
---

# Running the AIOS-SFA stack


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
>   credentials (run `api:seed:dev` first).
> - `api:migrate:mailers:dev` — **BigQuery → Mongo** backfill of the legacy
>   mailer history (arch decision O2, resolved as *import*). Needs GCP
>   credentials (`BQ_*` + `GOOGLE_APPLICATION_CREDENTIALS_JSON`) and is a
>   **production deploy step**, not part of local development — the Super Admin
>   RTP upload and the demo seed both populate a working `mailers` collection
>   without it. Re-runnable: upserts on the control-number key, so a second run
>   appends what is new and updates what changed.
>
> **Nothing needs running after the migration.** It writes its own cross-record
> refs (`leadId` / `householdId` / `quoteRecapId`), its own match keys
> (`policies.policyNumberKey`, `quoteRecaps.quoteDateYmd`) and reconciles
> household `HH-…` numbering at the end of its household pass. The repair passes
> that used to follow it were for databases migrated by older code and have been
> removed — a run against real data found them doing nothing.
