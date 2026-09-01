# SmartSuite → MongoDB migration

The migration pipeline lives in the API package so it reuses the Mongoose schemas
(the single source of truth for later dashboard API tickets) and the app config:

- Entry point: `packages/api/src/migration/migrate.ts`
- Runner/service: `packages/api/src/migration/migration.service.ts`
- SmartSuite REST client + field/table ids: `packages/api/src/migration/smartsuite/`
- Mapping/derivation helpers: `packages/api/src/migration/helpers/`
- Collection schemas: `packages/api/src/{deals,quote-recaps,leads,households,contacts,policies,service-tickets,deal-audits,audit-records,audit-templates,interested-parties,prior-insurance,prior-policies,producer-assignments,crm-rotations,time-off-requests,activities,producer-goals}/schemas/`

## What it does (PAC-18)

Migrates **all** SmartSuite tables from `docs/SFA SmartSuite Tables` into MongoDB.
Tables are migrated in dependency order so cross-record links resolve to Mongo
`ObjectId`s where possible (and always keep the source `legacy…Id`).

| SmartSuite source | Mongo collection |
|-------------------|------------------|
| Users | `users` (producer refs + `legacySmartSuiteId`) |
| Households | `households` |
| Contacts | `contacts` |
| Leads | `leads` |
| Quote Recaps | `quoteRecaps` |
| Deals (Sold Log) | `deals` |
| Policies | `policies` |
| Deal Audit Items | `auditRecords` |
| Deal Audits | `dealAudits` |
| Audit Templates | `auditTemplates` |
| Interested Parties | `interestedParties` |
| Prior Insurance | `priorInsurance` |
| Prior Policies | `priorPolicies` |
| Service Tickets | `serviceTickets` |
| Producer Assignment | `producerAssignments` |
| CRM Rotation | `crmRotations` |
| Time Off Request | `timeOffRequests` |
| _derived_ | `producerGoals`, `activities` |

- Idempotent/re-runnable: upserts keyed on `{ agencyId, legacySmartSuiteId }`.
- Preserves `legacySmartSuiteId` on every record.
- Resolves producer/CRM scoping by mapping SmartSuite user record ids → Mongo `User._id`,
  and household/deal/policy links → their Mongo `ObjectId`s.
- Normalizes lead source to the 14 canonical sources; flags test/sample/demo and
  propagates the test flag from a linked deal to its children (policies, audits, prior insurance…).
- Derives deal type (Auto/Home/Bundle), lead temperature/aging, and premium
  (rollup with snapshot fallback).
- Scaffolds `producerGoals` (producer × month) from each user's Monthly Goal.
- Emits a reconciliation report (per-collection source/fetched/migrated/test/skipped
  counts) to stdout and `migration-report.json`.

## Prerequisites

1. MongoDB running and `MONGODB_URI` set in `AIOS-SFA/.env`.
2. Seed the agency/branch first: `cd packages/api && npm run seed:dev`.
3. SmartSuite credentials in `AIOS-SFA/.env` (see `.env.example`):
   `SMARTSUITE_API_TOKEN`, `SMARTSUITE_ACCOUNT_ID`, `SMARTSUITE_SOLUTION_ID`.

## Running

Prefer the full pipeline — it seeds, migrates and imports mailers in one
resumable, logged run, with a preflight that fails before the first write:

```bash
./scripts/migration/run-migration.sh --mode dev            # local, ts-node
./scripts/migration/run-migration.sh --mode dev --dry-run  # fetch + report only
./scripts/migration/run-migration.sh --mode compose        # on the droplet
```

Or the migration on its own:

```bash
cd packages/api
npm run migrate:dev -- --dry-run   # fetch + map + report, no Mongo writes
npm run migrate:dev                # full run
npm run build && npm run migrate   # compiled, as a server runs it
```

**Nothing needs running afterwards.** The migration writes its own cross-record
refs (`leadId` / `householdId` / `quoteRecapId`), its own match keys
(`policies.policyNumberKey`, `quoteRecaps.quoteDateYmd`) and reconciles household
`HH-…` numbering at the end of its household pass. The repair passes that used to
follow it existed for databases migrated by older code and have been removed.

The migration **provisions the tenant it imports into** — agency, branch,
default roles, audit templates. The core seed creates no agency; it supplies the
permission catalog the default roles are built from.

**It creates no users but the migrated ones.** To make the tenant reachable it
promotes exactly one of them to Agency Owner — `--owner-email`, default
`davidhowad@allstate.com`. That role carries every `agency:*` permission, so the
holder can assign roles to the rest of the team and trigger their password-reset
emails. If the address is not among the migrated users the step warns and records
it on the report rather than failing the import; pass `--owner-email ''` to skip
it deliberately.

**The owner still needs one manual unlock.** Migrated users get an unusable
password hash, and there is no public "forgot password" endpoint — the only
doors in (`POST /auth/accept-invite`, `POST /auth/reset-password`) need a token
issued by an endpoint requiring `agency:users:write`, which the new owner cannot
call until they are logged in. Break the loop once with the platform account:

1. Log in as the platform super admin.
2. `POST /auth/impersonate/:userId` for the owner — the session resolves *their*
   live permissions, which now include `agency:users:write`.
3. `POST /users/:userId/password-reset` for that same user, which emails them a
   reset link.
4. They set a password, log in normally, and onboard everyone else.

The platform super admin cannot shortcut this: it resolves to
`ALL_PLATFORM_PERMISSIONS` only, holds no `agency:*`, and the platform endpoints
cover agency CRUD and module toggles — not tenant roles.

Flags: `--dry-run` (provisions nothing), `--agency <slug>` (default
`smith-family-agency`), `--branch <slug>` (default `main`), `--agency-name`,
`--branch-name`, `--ticker` (default `SFA`) and `--allstate-id` (default
`A0B9049`) for the mailer identity step 3 attributes rows by, `--owner-email`
(default `davidhowad@allstate.com`), and `--page-size <n>` (default `500`).
