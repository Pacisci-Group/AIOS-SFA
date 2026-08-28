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

Flags: `--dry-run`, `--agency <slug>` (default `smith-family-agency`),
`--branch <slug>` (default `main`), `--page-size <n>` (default `500`).
