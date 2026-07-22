# AGENTS.md

## Cursor Cloud specific instructions

This is the **SFA Platform** (`sfa-apps`), an npm-workspaces monorepo with three packages:

- `@sfa/api` (`packages/api`) — NestJS 11 REST API, serves `/api/v1` on port **4000**.
- `@sfa/web` (`packages/web`) — React 18 + Vite SPA on port **5173** (dev), proxies `/api/v1` to the API.
- `@sfa/shared` (`packages/shared`) — shared TS enums/types/permissions consumed by both.

### Services & how to run them

Standard commands live in the root `package.json` scripts. Non-obvious caveats:

- **MongoDB is required** and is not part of the update script. Start it before the API or tests:
  `mongod --dbpath /var/lib/mongodb --bind_ip 127.0.0.1 --port 27017` (the data dir is created during setup). The API connects to `mongodb://localhost:27017/sfa` from `.env`.
- **`.env` is required** by the API and is gitignored. Copy it from `.env.example` if missing (`cp .env.example .env`).
- **`@sfa/shared` must be built before running the API** (`npm run shared:build`): the API imports `@sfa/shared` from its compiled `dist/`, unlike web which bundles it from source via a Vite alias. Rebuild shared after editing files in `packages/shared`.
- Run dev servers with `npm run api:dev` and `npm run web:dev` (separate terminals). Do NOT use `docker compose`/`make up` for dev — those build production images.
- **Seed accounts** with `npm run api:seed:dev` (idempotent-ish; safe to re-run). Logins: super admin `admin@sfa.local` / `ChangeMe123!`, agency owner `owner@smithfamily.local` / `ChangeMe123!`.

### Lint / test

- `npm run lint -w @sfa/web` = `tsc --noEmit` (passes).
- `npm run lint -w @sfa/api` currently reports pre-existing eslint errors (mostly `no-unsafe-*` in existing `src`/`test` files) — this is the repo baseline, not a setup problem.
- There are **no unit tests** (`npm run test -w @sfa/api` exits with "No tests found").
- E2E: `npm run test:e2e` (from root) needs a running MongoDB; it uses the `sfa_test` database (auto-created).
