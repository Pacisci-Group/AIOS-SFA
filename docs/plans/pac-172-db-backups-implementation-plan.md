# PAC-172 — Weekly MongoDB snapshots: implementation plan

Ticket: https://linear.app/paciscigroup/issue/PAC-172 · branch `awaris/pac-172-add-mongodb-snapshots-pre-deploy-nightly-and-off-cluster`.

Paths are relative to the AIOS-SFA repo root; `api/` = `packages/api/`. The operator-facing runbook is `DEPLOYMENT.md` → "Database backups"; this file records what was decided and built, and why.

## Context

Production Mongo is a single-node DigitalOcean managed cluster (`db-s-1vcpu-1gb`) holding real client data. DigitalOcean backs it up daily with seven days of point-in-time recovery, but those backups belong to the cluster: **destroying the cluster destroys them**, a restore always forks a *new* cluster, and nothing older than a week exists. The docs said prod had "no backups", and Terraform's `enable_backups` flag was read by nothing, with comments claiming retention depended on the cluster tier (it does not).

This change adds the copy that outlives the cluster: a weekly `mongodump` stored in a private bucket of its own, rotated to the newest four, with a report mail every run.

## Decisions (taken with the user, 23 Oct 2026)

| | Decision |
|---|---|
| Where it runs | An Inngest function in the worker ("option B"), not a droplet cron (would fire once per pool member) and not GitHub Actions (the runner cannot reach the cluster through its firewall). |
| Schedule | Weekly, **Sundays 13:00 Pakistan time** (`TZ=Asia/Karachi 0 13 * * 0`) = 08:00 UTC = 03:00 Chicago. The ticket said nightly. |
| Retention | **Count-based in code**: keep the newest 4 (`DB_BACKUP_KEEP`); after a successful upload, delete the oldest beyond that. The ticket proposed lifecycle rules. |
| Bucket | **Dedicated** `sfa-<env>-db-backups`, own bucket-scoped key, no CORS, versioning off. Not the uploads bucket. |
| Alerting | Email on failure **and** on success — the weekly "OK" mail is the heartbeat. |
| Enable | `DB_BACKUP_ENABLED` per GitHub Environment, default off. |
| Encryption | None client-side, deliberately: same posture as the uploads bucket, and a lost key would lose every backup. |
| Scope | Weekly job + an on-demand event (`db-backup/snapshot.requested.v1`). The deploy-workflow pre-deploy snapshot and `make db-snapshot` are follow-ups. |

## What was built

**Terraform** (`infra/terraform`). `modules/db_backup_bucket`: private bucket, versioning off (so rotation is literal — no noncurrent copies behind a delete), lifecycle expiry of 90 days on `manual/` and `pre-deploy/` (nothing on `weekly/`, which the worker rotates), and a `readwrite` key scoped to it. Wired behind `enable_db_backups` (+ optional `db_backup_spaces_region`) through the stack and every env root, with `db_backup_github_secrets` / `db_backup_secret_access_key` outputs modelled on the deploy-config ones. `enable_backups` is gone everywhere and the comments around it now say what DigitalOcean actually does.

**Image** (`api/Dockerfile`). Alpine community `mongodb-tools` (100.14.1 on Alpine 3.24), keeping `mongodump` and `mongorestore` (~26 MB) and dropping the other six binaries in the same layer (~100 MB otherwise, pulled by every pool member on every deploy). `mongodump --version` runs at build.

**Shared plumbing.** `api/src/storage/s3-client.factory.ts` — `readS3Settings(config, prefix)` + `createS3Client()`, lifted out of `StorageService`'s constructor (defaults unchanged, pinned by a unit spec) so the backup client is built the same way rather than hand-rolled. `config/bounded-int.ts` lifted out of `data-export.config.ts`. `config/db-backup.config.ts` holds the schedule and the parsers.

**The function** — `api/src/worker/functions/db-backup-snapshot.fn.ts`, with `worker/backup/{backup-keys,mongodump-runner,backup-store}.ts`:

1. **plan** — refuse (non-retriable) when the bucket settings are missing or mongodump is not installed; mint the key. Memoised, so a retried upload overwrites the same key instead of leaving two archives for one week.
2. **snapshot** — temp dir → `mongodump --config=<0600 yaml with uri> --archive=<file> --gzip --numParallelCollections=2` → one PUT. Dump and upload share a step because in a pool a later step can land on another worker container.
3. **rotate** (scheduled only) — list `weekly/`, keep the newest `DB_BACKUP_KEEP` counting the archive just written, delete the rest. Only exact archive names; never the current archive; nothing at all if the listing does not show the current archive yet.
4. **notify** — report mail (send + record), which **throws** on failure so a lost heartbeat fails the run rather than vanishing. `onFailure` sends the failure mail.

Key layout: `weekly/<YYYYMMDD>T<HHmmss>Z.archive.gz`, `manual/<ts>-<label>.archive.gz`, `pre-deploy/<ts>-<sha>.archive.gz`. Compact UTC sorts chronologically as a string, so rotation is a sort, never a date parse.

**Deploy** (`.github/workflows/deploy.reusable.yml`). `DB_BACKUP_ENABLED=true` makes the five `DB_BACKUP_STORAGE_*` secrets and `DB_BACKUP_ALERT_EMAIL` required, and refuses `INNGEST_ENABLED` off. The runtime env gains `DB_BACKUP_*` and `INNGEST_STREAMING`.

## Findings that changed the design (verified, 23 Oct 2026)

- **Inngest validates incoming events against the trigger schema before running** (`inngest/components/execution/engine.js`, `validateEventSchemas`), failing non-retriably. The catalog's `eventEnvelope` makes `eventLogId` required, and an operator's `curl` carries none — so this one schema makes it optional. Consequence, intended: `InngestService.send` cannot emit it.
- **The dashboard's Invoke sends `inngest/function.invoked`** with the same data. The request is therefore read from `data.reason`, not the event name; keying off the name filed an invoked manual snapshot under `weekly/`, where rotation counts it. An Invoke (or curl) **without** a `reason` is rejected by the schema before the handler runs — checked end to end against the dev server — so only the cron takes a rotated weekly snapshot.
- **mongodump echoes the full URI, password included, when a connection fails.** The runner masks the URI in every error it raises, and the URI is never on argv (it is in the `--config` file).
- **`--config` with `uri:` works with a percent-encoded password, and a URI naming `/sfa` dumps only that database** — checked against Mongo 7 with a second database present.
- **Streaming is a serve-level switch.** With it on, every step response of every function becomes a 201 with a heartbeat body, and the SDK lets a code value override `INNGEST_STREAMING`. So it is **not** set in `inngest-serve.ts` (the original plan); the deploy writes `INNGEST_STREAMING=${{ vars.INNGEST_STREAMING || 'true' }}`, which leaves an off switch that needs no release.
- The worker import boundary covers `test/**` too (only `test/worker/` is exempt), so the fake backup store lives in the spec file, not `test/helpers/`.

## Rollout

1. `docker build -f packages/api/Dockerfile .` and confirm `mongodump --version` (the build runs it).
2. Dev infra: in the live `environments/dev/terraform.tfvars` replace `enable_backups = false` with `enable_db_backups = true`; export `DIGITALOCEAN_TOKEN` and `SPACES_ACCESS_KEY_ID/SECRET`; `make init ENV=dev` (new module), `make plan ENV=dev` — expect **+bucket +key, nothing else** — then `make apply ENV=dev`.
3. GitHub Environment `dev`: the four values from `terraform output db_backup_github_secrets`, `DB_BACKUP_STORAGE_SECRET_ACCESS_KEY` from `-raw db_backup_secret_access_key`, `DB_BACKUP_ALERT_EMAIL`; variable `DB_BACKUP_ENABLED=true`.
4. Deploy dev. Check: the worker serves one more function; the dashboard shows the next run on a Sunday at 08:00 UTC (if the server rejected the `TZ=` prefix, switch to `0 8 * * 0`, which is identical); **an invite or password-reset email still arrives** — streaming changes delivery for every function.
5. Take a manual snapshot through the tunnel (DEPLOYMENT.md). Confirm the object, the mail, every step green, and the `snapshot` step's duration.
6. After the first Sunday on dev, confirm rotation from the mail; restore that archive locally (the rehearsal below).
7. Production: steps 2–5 with `ENV=production` (decide `db_backup_spaces_region` first — changing it later replaces the bucket). Run `doctl databases backups <cluster-id>` once to confirm DigitalOcean's own daily backups are listed. Watch for the first Sunday "OK" mail.

## Rehearsals

| Date | Archive | Size | Restore time | Counts match | By |
|---|---|---|---|---|---|
| | | | | | |

## Risks

| Risk | Mitigation |
|---|---|
| Internal load balancer cuts the minutes-long `snapshot` request; Inngest retries while the dump still runs | `INNGEST_STREAMING` heartbeat; in-process one-dump guard; per-run key so the last PUT wins atomically; dump timeout + SIGKILL |
| Streaming upsets the self-hosted server for every function | Verified on dev first (rollout step 4); `INNGEST_STREAMING=false` variable turns it off without a release |
| Dump load on a one-vCPU node | 2 parallel collections; 03:00 Chicago on a Sunday |
| Archive outgrows one PUT (5 GiB) | Refused past 4.5 GiB with a message naming multipart; size is in every mail |
| Rotation deletes the wrong thing | Prefix-scoped listing, exact-name match, protected current key, skip when the listing lags, versioning off — each tested |
| Torn reads across collections (no `--oplog`) | Documented; DigitalOcean's fork is the exact-instant tool |
| The backup key in `app.env` / the deploy-config object | Same exposure class as `MONGODB_URI`, already there |

## Later (out of scope)

- **Pre-deploy snapshot** in `deploy.reusable.yml`: when migrations will run, post `{"reason":"pre-deploy","label":"<sha>"}` from the Inngest droplet and wait for the run before publishing; fail the deploy if it fails. The function, key prefix and bucket rule already exist.
- `make db-snapshot ENV=<env> LABEL=<label>` wrapping the tunnel + curl.
- Client-side encryption (age), multipart upload, per-collection counts in the report mail (a baseline for rehearsals).
