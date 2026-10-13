# PAC-152 — Data Export: implementation plan

Ticket: https://linear.app/paciscigroup/issue/PAC-152 (spec is authoritative; this plan is the execution order).

Paths are relative to the AIOS-SFA repo root; `api/` = `packages/api/`, `web/` = `packages/web/`, `shared/` = `packages/shared/`.

## Context

The agency's **data team (Carl)** builds reports in **Alteryx** and, until now, read the agency's operational data out of **BigQuery** (`allstate123.smartsuite_data`), which the legacy SFA app fed from SmartSuite. AIOS-SFA replaces SmartSuite + BigQuery with MongoDB, so once the agency cuts over the data team loses its data feed entirely. Today the only way to get bulk data out of the new system is a one-off dump that an engineer runs (David's `Contacts/Households/Policies 9_4_2026.csv` exports, Carl's "all-purpose audit spreadsheet" — see PAC-124, PAC-125). The data team's current tool, ApexReports, has an admin-only **Data Export** tab (bulk table dumps + an export audit trail); that is the mental model they bring.

This feature gives the agency a self-service **Data Export** page: a user with the right permission picks a **curated, report-ready dataset** (leads, quote recaps, sold deals, policies, households, contacts, then audits/activities/tickets), narrows it with filters (date range on the dataset's date field, branch, producers, status, policy types, lead sources) and downloads it as **CSV or XLSX**. Every download is logged (who, what, filters, row count) — the audit trail PAC-84 flagged as missing. Access is a permission like every other page, so the agency owner grants it to the **Data Team** role (already a default template, `data_team`, scope `agency`) or to any individual from the existing role / per-user permission matrix.

**Decisions taken with the user (2026-10-06):** curated joined datasets (not raw table dumps) shaped after the legacy SmartSuite tables the data team's Alteryx flows were built against (`docs/smartsuite-tables/*.md` — their lookup/rollup columns: Producer Name, Household Name, Lead Source, Policy Number(s), Policy Count, Total Premium, Failed/Passed Audit Items, Sold Year/Month…); **CSV + XLSX**; **personal data included** (name, phone, email, DOB, free-text notes); deliverable = **Linear ticket + `docs/plans/` file, then implement**.

Related, not in scope: PAC-124 (carrier book *import*), PAC-84 (central `files` collection), PAC-52 (Alteryx → production reports), PAC-123 (payroll export), mailers export (see "Later").

### Data volumes (production dump, 30 Sep 2026)

| Collection | Docs | | Collection | Docs |
|---|---|---|---|---|
| leads | 1,076 | | households / contacts / householdMembers | 2,606 / 3,164 / 2,892 |
| quoteRecaps | 805 | | dealAudits / dealAuditItems | 548 / 5,204 |
| deals | 1,713 | | activities | 3,151 |
| policies | 4,427 | | serviceTickets | 2,166 |
| **mailers** | **~738,000** | | | |

Every dataset in scope is a few thousand rows → a **synchronous, streamed response** is right (no job table, no storage object, no polling). Mailers is the one outlier and stays out of v1.

### Exploration findings that shape the design (verified in code)

- **Permissions.** A page is a `ModuleKey`; the owner's role matrix and the per-user override page render one row per entry of `PAGES` (`shared/src/permissions/permission-catalog.ts`), so a **new module key `data_export`** appears there automatically. Only `{module}:read|write` survives `RolesService.updateLevels` and `resolvePermissionSet`'s enabled-module filter; an `agency:*` capability cannot be granted to an individual. No module key has been added since the scaffold, so enabling it for *existing* agencies (`Agency.modules`, Super-Admin-only toggle) and seeding its catalog rows (`permissions` collection, not written at boot) needs a first-of-its-kind migration. Read-only modules never use `:write` (`owner_dashboard`, `performance`, `leaderboard`), so `data_export:write` being a no-op has precedent. Controller pattern: `api/src/owner-dashboard/owner-dashboard.controller.ts`.
- **Data scope.** `buildScopeFilter` (`api/src/common/access/scope-filter.ts`) for `producerId` collections; `clientScopeFilter` (`api/src/clients/client-scope.ts`) for households/contacts/policies (no owner → `own` collapses to branch; callers add `isTestRecord`); `buildTicketScopeFilter` (`api/src/crm/ticket-scope.ts`) for tickets. **Neither clamp narrows an agency-scoped caller by `X-Branch-Id`.** `agencyId`/`branchId` are **strings** on `TenantRecord` collections but **ObjectIds** on `serviceTickets`/`users`/`branches`/`agencies` — the wrong type silently matches nothing. Windows are cut in `access.timeZone` (`api/src/performance/performance.range.ts`, `api/src/common/sales-metrics/sales-matches.ts`).
- **Data model.** No `auditRecords`: audits are `dealAudits` + `dealAuditItems`. Contacts ↔ households is `householdMembers`. Policies have no `producerId` (via `dealId`). Lead source lives on the lead (`sourceStages()` in `sales-pipelines.ts`, `Deal.leadSourceId` only as fallback). Labels: `LeadSourcesService.labelsFor`, `displayNamesFor` (`api/src/common/domain/user-names.ts`), `loadContactDetails` (`api/src/contacts/contact-details.ts`); no branch-labels helper exists. Migrated rows carry raw codes → `normalize*` helpers from `@sfa/shared`. PII present: contact `email`/`phone`/`dateOfBirth`, `interestedParties.loanNumber`, `notes`; no SSN/licence/bank fields. Never export: storage keys (`*.key`), `submissionToken`/`policyAdditionTokens`, user secrets.
- **Infra.** `csv-stringify` and `exceljs` already in `api/package.json` (`writeVendorCsv` in `api/src/common/mailers/vendor-file-reader.ts` is the only CSV writer; ExcelJS is used for reading only). `main.ts` CORS has no `exposedHeaders`. Web: `apiFetchBlob` (`web/src/lib/api-client.ts`) omits `X-Branch-Id` and the filename; `DateRangePicker` caps at 366 days; `MultiSelect`, `RangeChips`, shadcn `Table`, `TablePagination`, sonner available; `MODULE_CATALOG` (`web/src/features/platform/onboard/module-catalog.ts`) is `Record<ModuleKey,…>` so the web build fails until the new key is described.

---

## Design decisions (built to; do not re-litigate)

| # | Topic | Decision |
|---|---|---|
| D1 | Gate | New `ModuleKey.DataExport = 'data_export'`; `data_export:read` is the whole gate, no per-dataset permission. `data_export:write` exists (the model requires the pair) and does nothing. A Producer granted it gets own rows on producer-scoped datasets and branch rows on client-scoped ones — the clamp is never bypassed. |
| D2 | Shape | **Curated joined datasets**: each row is one entity with lookups resolved (`*_id` + `*_name` side by side so files still join in Alteryx) **and** child aggregates rolled up server-side (policy numbers per deal, members per household, converted deal per quote…). snake_case stable headers; a server-side **data dictionary** documents them. |
| D3 | Formats | `format=csv` (default) or `format=xlsx`, same column model, one writer per format. CSV: UTF-8 with BOM, `csv-stringify` stream, **no formula escaping** (would corrupt the ids/policy numbers the data team joins on — Excel users take XLSX). XLSX: `exceljs` streaming `WorkbookWriter` piped to the response, typed cells (Date / number / text so leading zeros survive), bold header. |
| D4 | Delivery | ~~Synchronous streamed response~~ **Superseded 6 Oct — background jobs** (see the last section): the request is validated, counted and queued (202); a worker writes the file to object storage; the requester is emailed; the page downloads it later through a presigned link. `DATA_EXPORT_MAX_ROWS` (default 100 000, read per call) still refuses an oversize request up front with **400** `{ code: 'EXPORT_TOO_LARGE', rowCount, maxRows }`, logged as `failed`. `truncated` is a boolean for the count-vs-cursor race. |
| D5 | Date range | Export-specific: `from`/`to` each optional `YYYY-MM-DD`, both omitted = all time, no 366-day cap (the row cap bounds the work). Presets (All time / This year / Last 12 months / Custom) resolve client-side; the server cuts by date-field *kind*: `ymd` (`soldDateYmd`…), `instant` (`zonedDayStart` in `access.timeZone`), `utcDate` (UTC-midnight calendar fields), `leadCreated` (`leadCreatedYmdExpr`). |
| D6 | Branch filter | Explicit `branchId` query param honoured for **agency-scope callers only** (narrow-only). `GET /data-export/options` returns the branches + producers the caller may pick, behind `data_export:read` alone (Data Team holds no `agency:branches:read`; those names appear in every exported row anyway). |
| D7 | Policies under `own` | Collapse to branch via `clientScopeFilter`, consistent with the Clients pages (a Producer already sees branch policies there). Producer attribution is on the row as `deal_producer_*`. |
| D8 | Export log | `dataExports` collection; **does not extend `TenantRecord`** (`branchId` is `required: true` there and Mongoose rejects `''`, but an agency-wide export has no branch clamp). Declares `createdBy`/`updatedBy` itself to opt into `authorshipPlugin` (the `RolePermission` precedent). |
| D9 | Routing | ~~`GET /data-export/:dataset/download?format=`~~ (now `POST /data-export/:dataset/exports` + `GET /data-export/exports/:id/url`, see the last section) — one handler, literal last segment (Express 5 / path-to-regexp v8 treats `:dataset.csv` differently from Express 4). Unknown dataset → 400 via a zod enum on the param. |
| D10 | Nav | New one-item **"Data"** nav section after "Service & CRM" (precedent: "Workspace" has one item); matching "Data" group in `MODULE_GROUPS`. `RoleLanding` unchanged (Data Team keeps landing on `/dashboard/management`). |
| D11 | New agencies | Add `ModuleKey.DataExport` to `ONBOARDING_DEFAULT_MODULES` (`shared/src/domain/agency-onboarding.ts`); otherwise a panel-onboarded agency's Data Team holds a permission the enabled-module filter drops and the owner cannot grant it. `provision-tenant.ts` and the demo seed already enable `ALL_MODULE_KEYS`. |
| D12 | PR split | PR1 = plumbing + migration + engine + 6 core datasets + dictionary/options/history + e2e + Bruno (+ the one web file the build needs). PR2 = web page. PR3 = audits / activities / tickets / chargebacks — three real engine variations (polymorphic owner, changelog permission gate, ObjectId tenancy) that deserve their own review; independent of PR2. |
| D13 | Duplicates *(added 8 Oct, review)* | **One live export per request.** A request is identified by the requester, their data scope, the dataset, the format and every filter, with the multi-selects sorted. While an export is `queued`, `processing` or `ready` (and not past `expiresAt`), the same request is refused with **409** `{ code: 'EXPORT_DUPLICATE', existing }`, and nothing is queued or logged. A `failed` or `expired` export does not block. Enforced by `activeKey`, a hash with a partial unique index, which the worker clears on failure and the retention sweep on expiry, so a racing double click queues one export. |
| D14 | Re-run *(added 8 Oct, review)* | `POST /data-export/exports/:id/rerun` re-runs a **failed** export as a **new** request with the same parameters, linked by `rerunOf` / `rerunId`; the failed row stays as audit. Requester only (403 otherwise), never for `EXPORT_TOO_LARGE` or an export already re-run (409). It goes through `request` in full, so it is re-validated, re-counted and scoped under the caller's access *now*, and D13 applies. A re-run refused as too large still counts as the re-run (Re-run would only log the same refusal). The worker's `claim` admits `queued` rows only, so replaying a failed export's event from the Inngest dashboard is a no-op: Re-run is the one way back, because a replay would skip D13 and the access re-check. |

---

## Step 0 — ticket and plan document (before any code)

1. Create the Linear issue (team **Paciscigroup**, project **SFA**, label **Feature**): title "Data Export page — curated CSV/XLSX datasets for the data team, gated by a new `data_export` module", body = the Context + Decisions above + acceptance criteria (every dataset downloads as CSV and XLSX; owner can grant/revoke from the matrix; Producer with the permission sees only own/branch rows; module disabled → nav hidden + 403; every download logged and listed; Bruno folder green). Note the ticket number as `PAC-152`.
2. Save this plan as `docs/plans/pac-152-data-export-implementation-plan.md` (house style: `docs/plans/pac-139-manager-view-implementation-plan.md`) and link it from `AGENTS.md` §10.
3. Branch from `dev`: `<you>/pac-152-data-export-api`.

---

## PR1 — shared + permission plumbing + migration + API engine + core datasets

### 1. Shared (`shared/`) — build first (`npm run shared:build`)

| File | Change |
|---|---|
| `src/enums/module-key.enum.ts` | append `DataExport = 'data_export'` (last — `ALL_MODULE_KEYS` order drives catalog `sortOrder`). |
| `src/permissions/permission-catalog.ts` | append to `PAGES`: `{ moduleKey: ModuleKey.DataExport, label: 'Data Export', description: 'Download report-ready datasets (leads, quotes, sold deals, policies, households, contacts…) as CSV or Excel. View is all the page needs; Edit grants nothing further.' }` |
| `src/permissions/default-role-templates.ts` | Data Team (L131–146) + `modulePermission(ModuleKey.DataExport, 'read')`, with a comment that existing agencies get it from the `data_export_module` migration, not this line. |
| `src/domain/agency-onboarding.ts` | `ONBOARDING_DEFAULT_MODULES` + `ModuleKey.DataExport` (D11). |
| `src/domain/data-export.ts` (new, export from `src/index.ts`) | `DATA_EXPORT_DATASET_KEYS = ['leads','quote_recaps','sold_deals','policies','households','contacts'] as const` (PR3 appends); `DataExportFormat = 'csv'\|'xlsx'`; `DataExportColumnType = 'string'\|'number'\|'boolean'\|'date'\|'datetime'\|'id'\|'list'`; `DataExportFilterKey = 'branchId'\|'producerIds'\|'status'\|'policyTypes'\|'leadSourceIds'`; descriptors `DataExportColumnDescriptor { key, description, type, requiresPermission? }`, `DataExportDateFieldDescriptor { key, label, isDefault }`, `DataExportDatasetDescriptor { key, label, description, scope, dateFields, filters, statusValues?, columns }`, `DataExportDictionaryResponse { datasets, maxRows, formats }`, `DataExportOptionsResponse { branches, producers }` (`{id,name}[]`), `DataExportStatus = 'completed'\|'failed'\|'truncated'`, `DATA_EXPORT_TOO_LARGE = 'EXPORT_TOO_LARGE'`, `DataExportFilterEcho`, `DataExportHistoryRow { id, datasetKey, datasetLabel, format, filters, rowCount, bytes, durationMs, status, error, filename, createdAt, createdById, createdByName }`, `DataExportHistoryResponse` (paged). |
| `src/permissions/permission-model.spec.ts` | the CSR `expected` map iterates `ALL_MODULE_KEYS` → add `[ModuleKey.DataExport]: 'none'`; new describe: `data_team` holds `data_export:read` and not `:write`; withheld from producer/csr/crm/branch_manager; owner only via `grantsAllEnabledModules`. `permission-catalog-parity.spec.ts` passes unchanged. |

### 2. API (`api/src/`)

**2.1 Config** — new `config/data-export.config.ts` (pattern `config/invite.config.ts`): `dataExportMaxRows()` (`DATA_EXPORT_MAX_ROWS`, default 100 000, clamp 1 000–1 000 000), `dataExportBatchSize()` (`DATA_EXPORT_BATCH_SIZE`, default 500). **Functions read per call** so e2e can set the cap. Document both in `.env.example` next to `PERMISSION_CACHE_TTL_SECONDS`.

**2.2 Filename header** — new `common/http/content-disposition.ts`: move `sanitizeFilename` out of `storage/storage.service.ts` (export it; one definition) + `attachmentDisposition(filename)`. `main.ts` `enableCors` gains `exposedHeaders: ['Content-Disposition']`.

**2.3 Export log schema** — new `data-export/schemas/data-export.schema.ts`, collection `dataExports` (D8): `agencyId: string` (index), `branchId: string|null` (the clamp that applied), `datasetKey`, `format: 'csv'|'xlsx'`, `dateField`, `filters: DataExportFilterEcho` (sanitised echo, never the raw query), `dataScope`, `rowCount`, `bytes`, `durationMs`, `status`, `error: string|null`, `filename`, `createdBy`/`updatedBy: ObjectId|null`, timestamps. Indexes `{agencyId, createdAt:-1}`, `{agencyId, createdBy, createdAt:-1}`. New collection → no migration needed.

**2.4 Dataset registry** — `data-export/datasets/`

```ts
// dataset.types.ts
export type DateFieldKind = 'ymd' | 'instant' | 'utcDate' | 'leadCreated';
export interface DatasetDateField { key: string; label: string; path: string; kind: DateFieldKind; isDefault?: true }
export type CellValue = string | number | boolean | Date | Types.ObjectId | readonly unknown[] | null | undefined;
export interface RowContext { lookups: LookupResolver; timeZone: string; permissions: ReadonlySet<string> }
export interface ColumnDefinition<Row> extends DataExportColumnDescriptor { pick: (row: Row, ctx: RowContext) => CellValue }
export interface DatasetDefinition<Row extends { _id: Types.ObjectId }> {
  key: DataExportDatasetKey; label: string; description: string;
  model: string;                                   // Mongoose model token, resolved by the engine
  scope: 'producer' | 'client' | 'ticket' | 'audit';
  owner?: Pick<ScopeFilterOptions, 'producerField' | 'ownerField'>;
  dateFields: readonly DatasetDateField[];         // exactly one isDefault
  filters: readonly DataExportFilterKey[];
  statusMatch?: (values: readonly string[]) => Record<string, unknown>;   // expands raw codes, e.g. leadStatusQueryValues
  statusValues?: readonly string[];
  policyTypePath?: string;                         // expanded with policyTypeValues()
  preStages?: (ctx: { timeZone: string }) => PipelineStage[];   // leads: $addFields createdYmd; deals: sourceStages(true)
  columns: readonly ColumnDefinition<Row>[];
  collect: (row: Row, into: LookupRequest) => void;   // which ids / parent ids feed which lookup, batched by the engine
}
```

`columns.ts` — shared builders so datasets agree: `tenantColumns()` (`branch_id`, `branch_name`, `created_by_id/_name`, `created_at`, `updated_at`, `legacy_smartsuite_id`), `addressColumns(prefix, path)`, `userRef(prefix, path)`, `householdRef(path)` (`household_id`, `household_ref`, `household_name`), `contactRef(prefix, path)` (`_id/_name/_email/_phone`), `leadSourceRef(path)`. `registry.ts` — `DATASETS` + `describeDataset()` (strips `pick`/`collect`). `registry.unit-spec.ts`: keys match the shared enum; headers unique, `/^[a-z][a-z0-9_]*$/`, none matching `/_key$|token/`; exactly one default date field; descriptor JSON-serialisable.

**Always excluded:** `submissionToken`, `policyAdditionTokens`, `*.key` storage keys (export `*_filename` instead), `addressKey`/`nameKey`/`dobKey`/`policyNumberKey`, `*Error` diagnostics, stale `agingDays`/`daysOpen` (recompute). `isTestRecord` rows filtered (client datasets add it explicitly). `legacy_smartsuite_id` **included** everywhere (reconciliation).

**Core datasets (PR1).** Headers below are the shape; child aggregates (marked ⤷) are batched per cursor batch by parent id through the `LookupResolver` (2.6).

- **`leads`** — `Lead`, producer scope; filters `branchId · producerIds · status · leadSourceIds · policyTypes`; dates `created` (default, `leadCreated` kind via `preStages` `$addFields { createdYmd: leadCreatedYmdExpr(tz) }`), `last_activity` (instant). `statusMatch` = `leadStatusQueryValues` (`leads.service.ts` L497 pattern); `statusValues` = canonical lead statuses.
  Columns: `lead_id`, `first_name`, `last_name`, `status`/`status_raw` (`normalizeLeadStatus`), `temperature`, `created_at` (`createdDate ?? createdAt`), `created_date` (agency calendar), `last_activity_at`, `quote_control_number`, `lead_source_id/_name`, `producer_id/_name`, `household_id/_ref/_name`, `primary_contact_id/_name/_email/_phone/_date_of_birth`, `policies_of_interest` (normalised, `; `-joined), `policies_of_interest_item_count`, `address_*`, `property_*`, `property_same_as_household`, `mailer_id`, `mailer_campaign_id`, `mailer_matched_by`, `mailer_linked_at`, `intake_channel`, `intake_submitted_at`, `replacement_policy_id/_reason/_consumed_at/_deal_id`, ⤷ `quote_count`, `first_quote_date`, `latest_quote_date`, `latest_quote_premium` (quoteRecaps by `leadId`), ⤷ `sold_deal_id`, `sold_date`, `sold_premium` (deals by `leadId`, latest), `legacy_producer_id`, `legacy_household_id`, `notes`, tenant columns.
- **`quote_recaps`** — `QuoteRecap`, producer; filters `branchId · producerIds · status · policyTypes`; dates `quote_date` (default, `quoteDateYmd`), `created`. `statusMatch` on `recapStatus`; `policyTypePath = 'productsQuoted'`.
  Columns: `quote_recap_id`, `quote_recap_number`, `title`, `quote_date`, `quote_date_at`, `premium`, `item_count`, `products_quoted` (normalised)/`products_quoted_raw`, `recap_status`, `insurance_renewal_month` (`normalizeInsuranceMonth`), `producer_id/_name`, `lead_id`, ⤷ `lead_status`, `lead_source_id/_name` (via lead), `household_id/_ref/_name`, `primary_contact_name/_email/_phone` (via household), `quoted_lines_count`, `quoted_lines` (`type premium/items; …`), `property_*`, `property_same_as_household`, `quote_document_filename`, `quote_document_uploaded_at`, ⤷ `converted_deal_id`, `converted_sold_date`, `converted_premium`, `days_to_close` (deals by `quoteRecapId`, else by `leadId` with `soldDate ≥ quoteDate` — the quote-to-sold join), `notes`, `legacy_*`, tenant columns.
- **`sold_deals`** — `Deal`, producer; filters `branchId · producerIds · status · leadSourceIds · policyTypes`; dates `sold_date` (default, `soldDateYmd`), `created`. `preStages = () => sourceStages(true)`; `leadSourceIds` → `sourceMatch`; `policyTypePath = 'policyTypes'`; `statusMatch` on `status`.
  Columns: `deal_id`, `deal_number`, `title`, `sold_date`, `sold_at`, `sold_year`, `sold_month` (agency calendar — legacy "Sold Year/Month"), `premium`, `premium_source`, `chargeback_adjustment`, `net_premium`, `item_count`, `policy_count`, `deal_type`, `business_type` (`?? DEFAULT_BUSINESS_TYPE`), `is_bundle`, `policy_types`, `lead_source_id/_name` (effective `sourceId`), `deal_lead_source_id` (raw fallback), `producer_id/_name`, `lead_id`, `household_id/_ref/_name`, `quote_recap_id`, `primary_contact_id/_name/_email/_phone`, `client_name`, `assigned_crm_id/_name`, `ticket_id`, `mortgagee`, `audit_trigger_*` (8 booleans), `audit_trigger_defensive_driver_names`, ⤷ `policy_numbers`, `policy_carriers`, `policy_statuses` (policies by `dealId`, `; `-joined), ⤷ `deal_audit_id`, `audit_status`, `audit_item_count`, `audit_failed_count`, `audit_resolved_count`, `audit_due_at`, `audit_submitted_at` (dealAudits by `dealId`), `crm_assigned_at`, `crm_assignment_status`, `status`, `legacy_*`, tenant columns.
- **`policies`** — `Policy`, **client** scope (D7); filters `branchId · status · policyTypes`; dates `effective_date` (default), `renewal_date`, `expiration_date` (`utcDate` — ⚠ confirm at implementation that the Sold form stores UTC midnight; else `instant`), `created`. `statusMatch` on `policyStatus`; `policyTypePath = 'policyType'`.
  Columns: `policy_id`, `policy_number`, `policy_type`/`_raw`, `carrier`/`_raw`, `active`, `policy_status`, `effective_date`, `expiration_date`, `renewal_date`, `premium`, `items`, `household_id/_ref/_name`, ⤷ `household_property_*` address, `primary_contact_name/_email/_phone` (via household), `assigned_crm_id/_name` (household), ⤷ `deal_id`, `deal_number`, `sold_date`, `deal_type`, `deal_producer_id/_name` (via deal), `transferred_to_policy_id`, `transferred_from_policy_id`, `discount_*` (flatten `SoldPolicyDiscounts`: booleans + `_proof_filename`, never keys), `new_business_application_filename/_uploaded_at`, ⤷ `interested_party_mortgagee`, `interested_party_loan_number` (interestedParties by `policyId`, first), `notes`, `legacy_*`, tenant columns.
- **`households`** — `Household`, client; filters `branchId · status`; date `created`. Status via the `household-status.ts` vocabulary (label + raw codes).
  Columns: `household_id`, `household_ref`, `name`, `status`/`_raw`, `property_*`, `mailing_*`, `primary_contact_id/_name/_email/_phone/_date_of_birth`, `assigned_crm_id/_name`, ⤷ `member_count`, `members` (`Name (Role); …`, current memberships), ⤷ `active_policy_count`, `policy_numbers`, `policy_types`, `total_premium` (policies by `householdId`, active), `total_active_policies_stored`, `lead_count`, `lead_ids`, `data_quality`, tenant columns.
- **`contacts`** — `Contact`, client; filters `branchId`; date `created`. One row per contact (legacy Contacts export shape).
  Columns: `contact_id`, `first_name`, `last_name`, `email`, `phone`, `date_of_birth`, `deceased_at`, ⤷ `household_count`, `household_refs`, `household_roles` (`Ref: Role; …`), `is_primary_contact_of` (household refs where `primaryContactId` = this), `notes`, tenant columns.

**2.5 Query building** — `data-export/query/`
- `export-window.ts` (pure + `unit-spec`): `exportWindow(field, from?, to?, timeZone)` → `$match` clause per kind: `ymd` → `$gte toYmd(from)`, `$lt toYmd(to + 1 day)` (`customRange`/`ymdWindow`); `instant` → `zonedDayStart` bounds; `utcDate` → UTC-midnight bounds; `leadCreated` → `ymdWindow('createdYmd')` as a second `$match` after `preStages`. Each bound only when given. Cases: open-ended, Chicago vs Asia/Kolkata, `to` inclusive, leap day.
- `export-scope.ts`: `producer`/`audit` → `buildScopeFilter(access, branchId, { producerIds, ...def.owner })`; `client` → `{ ...clientScopeFilter(access), isTestRecord: { $ne: true } }`; `ticket` (PR3) → `buildTicketScopeFilter` with ObjectId `branchId`; then D6 (`access.dataScope === Agency && query.branchId` → `filter.branchId`). Supplying a filter the dataset does not list → 400 (a hand-built URL cannot pretend it applied). Pipeline: `[$match scope, ...preStages, $match window, status, policyTypes ($in policyTypeValues), leadSourceIds (leads: $in ids + null for LEAD_SOURCE_NONE as `leads.service.ts` L503–511; deals: sourceMatch), $sort {_id:1}]`.

**2.6 Lookups** — `data-export/lookups/lookup-resolver.ts`: one instance per run, memoised across batches; `prime(request)` fetches only unseen ids. Scalar lookups: `users` (`displayNamesFor`), `leadSources` (`labelsFor`, once), `contacts` (`loadContactDetails` + `dateOfBirth`), `households` (`{householdRef, name, propertyAddress, primaryContactId, assignedCrmId}`), `deals` (`{dealAutoNumber, producerId, soldDate, dealType}` → its `producerId`s feed `users`), `branches` (once, **ObjectId** agencyId; inject the `Branch` model — no helper exists). **Child aggregates keyed by parent id** (one batched `find`/`aggregate` per batch, `$in` parent ids, grouped in memory): `policiesByDeal`, `policiesByHousehold`, `auditByDeal`, `quotesByLead`, `dealsByLead`, `dealsByQuoteRecap`, `membersByHousehold` (+ their contacts), `membershipsByContact`, `interestedPartiesByPolicy`. Accessors return `null`/`[]` on a dangling ref (cell renders empty).

**2.7 Writers** — `data-export/writers/`
- `cell.ts`: `formatCell(value, type)` → `null/undefined → ''`; `datetime` → ISO; `date` → `YYYY-MM-DD`; `id` → string; `list` → `'; '`-joined; `boolean` literal; number passthrough. Unit-tested per branch (+ `csv-stringify` quoting of lists containing commas/quotes/newlines).
- `csv-writer.ts`: `stringify({ header: true, columns, bom: true })` piped through a byte-counting Transform to `res`; `writeRow` awaits `'drain'` on backpressure.
- `xlsx-writer.ts`: `new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res, useStyles: true, useSharedStrings: false })`, one worksheet named after the dataset; header row bold; per column `type` → cell: `date`/`datetime` as `Date` with `numFmt` `yyyy-mm-dd` / `yyyy-mm-dd hh:mm:ss`, `number` as number, `id`/`string`/`list` as text, `boolean` as boolean; `row.commit()` per row, `workbook.commit()` at end. Both writers implement `ExportWriter { start(headers), write(cells), end(): Promise<{bytes}> }`.

**2.8 Engine** (⚠ as first built — the streaming half is superseded by the "Background jobs" section at the end) — `data-export/data-export.service.ts`: `dictionary()` (registry → descriptors + `maxRows` + `formats`); `options(access, branchId)` (branches: agency → all, else own; producers: active non-platform users, branch-clamped, `own` → self); `stream(access, branchId, key, query, res)`: validate `dateField ∈ def.dateFields`, `filters ⊆ def.filters` → pipeline → count (`aggregate([...pipeline, {$count}])` when `preStages`, else `countDocuments`) → cap check (D4; log `failed` + throw) → headers (`Content-Type` `text/csv; charset=utf-8` or `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `Content-Disposition: attachment; filename="<agency-slug>_<dataset>_<from|all>_<to|all>.<ext>"`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`) → `for await` over `model.aggregate(pipeline, { allowDiskUse: true }).cursor({ batchSize })`, buffering `batchSize` rows → `def.collect` → `lookups.prime()` → write rows → stop at `maxRows` (`truncated`) → `writer.end()` → log `completed`. `res.on('close')` before finish → close cursor, log `failed: client_disconnected`; any throw after headers → `res.destroy(err)` (client sees a failed download, not a complete-looking truncated file), log `failed`. `data-export-history.service.ts`: `record(entry)` (`authorshipPlugin` stamps `createdBy` — verify the AsyncLocalStorage request context survives the awaited stream) and `list(access, page, pageSize)` (Agency scope → `{agencyId}`; Branch/Own → `{agencyId, createdBy: self}`; names via `displayNamesFor`).

**2.9 DTOs** — `data-export/dto/`: `dataExportQuerySchema = z.object({ format: z.enum(['csv','xlsx']).default('csv'), from: isoDate.optional(), to: isoDate.optional(), dateField: z.string().trim().min(1).max(40).optional(), branchId: objectId.optional(), producerIds: dashboardFilterFields.producerIds, leadSourceIds: dashboardFilterFields.leadSourceIds, policyTypes: dashboardFilterFields.policyTypes, status: z.preprocess(multiValue, z.array(z.string().trim().min(1).max(60)).max(50).optional()) }).superRefine(to ≥ from)`; `datasetKeySchema = z.enum(DATA_EXPORT_DATASET_KEYS)`; `dataExportHistoryQuerySchema { page ≥1 default 1, pageSize 1–100 default 20 }`. Export the `objectId` regex from `common/dashboard/dashboard-filter-query.dto.ts` instead of re-declaring.

**2.10 Controller** — `data-export/data-export.controller.ts`, `@Controller('data-export') @RequireModule(ModuleKey.DataExport) @RequirePermissions(modulePermission(ModuleKey.DataExport,'read'))`: `GET datasets`, `GET options(@Access, @BranchId)`, `GET history(@Access, @Query zod)`, `GET :dataset/download(@Access, @BranchId, @Param('dataset', ZodValidationPipe(datasetKeySchema)), @Query(ZodValidationPipe(dataExportQuerySchema)), @Res() res)`. Pattern: `owner-dashboard.controller.ts` + the `@Res()` stream-through in `tenant-branding.controller.ts` (a thrown `HttpException` before any write still reaches the global filter). No collision with `feature-modules/feature.controllers.ts` (verified).

**2.11 Module** — `data-export/data-export.module.ts`: `MongooseModule.forFeature([Lead, QuoteRecap, Deal, Policy, Household, HouseholdMember, Contact, DealAudit, InterestedParty, User, Branch, Agency, DataExport])` + `LeadSourcesModule` (pure read model: schemas, not feature modules — the `owner-dashboard.module.ts` house pattern). Register in `app.module.ts` after `ManagementDashboardModule`, before `FeatureModulesModule`.

**2.12 Migration** — with `api:dev` stopped: `npm run db:migrate:create -- data_export_module`; model on `migrations/20260923185801-management_read_for_branch_managers.js` (raw `db`, **constants copied not imported**, idempotent, logs counts). Constants: `MODULE_KEY='data_export'`, `READ_KEY='data_export:read'`, `WRITE_KEY='data_export:write'`, `DATA_TEAM_SLUG='data_team'`, and the two catalog rows exactly as `moduleDefinitions()` in `shared/src/permissions/permission-catalog.definitions.ts` would emit for index 13 (`kind:'module'`, `resource`, `action`, `label: 'View Data Export'|'Edit Data Export'`, `description` = PAGES text (+ ' Includes everything View grants.'), `group:'Pages'`, `sortOrder: 130|131`, `assignableToUser:true`, `isDeprecated:false`). `up`: **(a)** upsert both `permissions` rows (same upsert `seed/permissions.seed.ts` runs); **(b)** `agencies.updateMany({ 'modules.data_export': { $exists: false } }, { $set: { 'modules.data_export': { enabled: true, enabledAt: now } } })` — only agencies lacking the key, so a later Super-Admin disable survives a retry; **(c)** for each `roles.find({ slug: 'data_team' })` upsert `rolePermissions { roleId, permissionKey: READ_KEY }` (`$set { agencyId, permissionId, source:'template', updatedAt }`, `$setOnInsert { …, createdBy:null, updatedBy:null, createdAt }`) — byte-for-byte the management migration's loop; read only. `down`: delete (c) rows; `$unset modules.data_export` only where `enabledBy` is absent (ours); mark (a) rows `isDeprecated: true`, never delete. Docblock: Redis permission cache → TTL or next login is the cutover; `ModuleGuard` reads the agency live so the entitlement is immediate; `npm run api:sync:roles:dev` also grants the role on dev DBs **but does not enable the module** — only the migration (applied at API boot) does.

**2.13 Tests** — unit: `cell`, `export-window`, `registry`, `xlsx-writer` (read back with `exceljs` and assert cell types). e2e `test/data-export.e2e-spec.ts` (pattern `test/owner-dashboard.e2e-spec.ts`; parse CSV with `csv-parse/sync`; XLSX read back with `exceljs`):
1. Fixtures: Data Team user (`person()` helper from `management-dashboard.e2e-spec.ts` L218, slug `data_team`); 3 leads (two the producer's, one the owner's, one `isTestRecord`), 1 deal + 2 policies + its `dealAudit`, 1 quote recap with raw `productsQuoted: ['PYgez']` and a converting deal, 1 household + 2 members + contacts; a lead at exactly UTC-midnight June 1.
2. `GET /data-export/datasets` → keys = `DATA_EXPORT_DATASET_KEYS`; one default date field each; no column key matches `/_key$|token/`; `formats = ['csv','xlsx']`.
3. For **each** dataset, CSV and XLSX: 200, correct content type, `content-disposition` `attachment; filename="test-agency_<key>_all_all.<ext>"`, header row === dictionary column keys, row count = seeded minus test records; leads: `producer_name`, `lead_source_name` resolved, `status` normalised, `sold_deal_id` filled; sold deals: `policy_numbers` joined, `audit_status` filled; quote recaps: `products_quoted` normalised, `converted_deal_id` filled; households: `member_count = 2`.
4. Window: leads `from=2026-05-01&to=2026-05-31` excludes the June-1 UTC-midnight lead; `from` alone open-ended; `to < from` → 400; `from=2026-02-31` → 400; `dateField=renewal_date` on policies honoured; `dateField=nonsense` → 400; `format=pdf` → 400.
5. Scope: grant the producer `data_export:read` via `roleAssignments.setUserOverrides` → leads = own rows only; `producerIds=<owner>` ignored under `own`; policies = branch rows (D7); `branchId=<other>` ignored under `own`; Data Team `branchId=<other-branch>` narrows; CSR without the permission → 403.
6. Module disabled (`modules.data_export.enabled:false` + `invalidateAgency`) → 403 `Module Disabled`; restore.
7. Cap: `process.env.DATA_EXPORT_MAX_ROWS='2'` → 400 `code: EXPORT_TOO_LARGE` with `rowCount`/`maxRows`; history shows the `failed` row.
8. History: lists completed + failed rows with `createdByName`, `format`, `filters.from`; producer sees only own rows; `pageSize=1` paginates.
9. Options: Data Team → all branches + producers; producer → self only.
Note `test/seed-test-data.ts` grants `${key}:read` for `ALL_MODULE_KEYS` to the read-only role — now includes `data_export:read`; harmless.

**2.14 Bruno** — `bruno/Data Export/` (model `bruno/Owner Dashboard/`; `environments/Local.bru` + `dataTeamEmail: dana.park@demoagency.local`, the demo Data Team user from `seed/demo/demo-data.ts` L162): `Login as Data Team` (captures `dataExportToken`, asserts `data_export:read` present — proves template + migration), `List Datasets`, `Download Leads CSV` (`from=2026-01-01`, disabled `~to/~producerIds/~status/~branchId` rows; asserts content type, disposition, first line starts `lead_id`), `Download Sold Deals XLSX` (`format=xlsx`), `Get History` (≥ 2 rows, newest `completed`), `Download (Forbidden for Producer)` → 403, `Download (Unknown Dataset)` → 400, `Download (Invalid Range)` → 400. Real `docs` blocks (module, permission, scope behaviour, params, response, errors). Add rows to `bruno/README.md` and the folder to `collection.bru`.

**2.15 The one web file in PR1** — `web/src/features/platform/onboard/module-catalog.ts`: `[ModuleKey.DataExport]: { label: 'Data Export', description: 'Downloading report-ready datasets as CSV or Excel for the data team's own tooling — Alteryx, spreadsheets, reconciliation.' }` + `MODULE_GROUPS` group `{ title: 'Data', modules: [ModuleKey.DataExport] }`.

**2.16 Docs** — `api/CLAUDE.md` (39 → 41 permission strings, 13 → 14 module keys); `docs/SYSTEM_ARCHITECTURE.md` §8.1 row; `AGENTS.md` §2/§10; `docs/SESSION-HANDOFF.md` new section (decisions D1–D12, migration + `sync:roles` note, PR3 pointer).

---

## PR2 — Web page (`web/src/`)

**3.1 Download plumbing** — `lib/api-client.ts`: new `apiFetchDownload(path): Promise<{ blob, filename: string|null }>` = `apiFetchBlob` + **`X-Branch-Id`** (its omission is a bug for branch-clamped callers) + `Content-Disposition` filename parse + `ApiError` built from the JSON body on `!res.ok` (so `body.code === 'EXPORT_TOO_LARGE'` reaches the UI). `apiFetchBlob` becomes a thin wrapper. New `lib/save-blob.ts`: `saveBlob(blob, filename)` (`URL.createObjectURL` → hidden `<a download>` click → revoke next tick).

**3.2 API client** — `lib/data-export-api.ts`: `dataExportKey`, `getDataExportDictionary()`, `getDataExportOptions()`, `getDataExportHistory(page, pageSize)`, `DataExportParams { dataset, format, dateField?, from?, to?, branchId?, producerIds, status, policyTypes, leadSourceIds }`, `dataExportSearch(p)` (comma-joined arrays like `dashboardFilterSearch`), `downloadDataset(p)` → `apiFetchDownload` → `saveBlob` (fallback filename `${dataset}_${from ?? 'all'}_${to ?? 'all'}.${format}`). Types from `@sfa/shared`.

**3.3 Route + nav** — `app/App.tsx`: lazy `DataExportPage`, route `/data-export` under `<RequirePermission permission={`${ModuleKey.DataExport}:read`} />`. `components/layout/nav-items.ts`: new section `{ title: 'Data', items: [{ to: '/data-export', label: 'Data Export', icon: FileDown, module: ModuleKey.DataExport }] }` after "Service & CRM" (D10).

**3.4 Component tree** — `features/data-export/`:
```
DataExportPage.tsx            AppShell · header · useDataExportUrlState() (useUrlState; dataset/range/from/to/dateField/format/branchId/producerIds/status/policyTypes/leadSourceIds)
├─ DatasetList.tsx            left column (lg:grid-cols-[280px_1fr]; a Select below md): ghost Button per dataset, label + description + scope Badge
└─ right column
   ├─ ExportFilterPanel.tsx   Card: RangeChips (All time / This year / Last 12 months / Custom → DateRangePicker with new `maxSpanDays?` prop, Infinity here)
   │                          · Select dateField (only when > 1) · MultiSelect branches (agency scope, > 1 branch) · producers (when 'producerIds' ∈ filters)
   │                          · status (dataset.statusValues) · policy types (POLICY_TYPES) · lead sources (useLeadSources + "No source")
   │                          · Format toggle (CSV / Excel) · DownloadButton: useMutation(downloadDataset) → toast.success / toast.error
   │                            (EXPORT_TOO_LARGE → "This export has N rows; the limit is M. Narrow the date range.") → invalidateQueries(dataExportKey)
   ├─ ColumnPreview.tsx       Card "Columns (n)": Table (header · type Badge · description) in ScrollArea; `requiresPermission` columns the user lacks muted + tooltip
   └─ RecentExports.tsx       Card: useQuery(history, keepPreviousData) · Table: When · Dataset · Format · Range · Rows · Size · By · Status Badge · TablePagination · empty-state sentence · skeleton rows
export-range.ts               EXPORT_RANGE_CHIPS + resolveExportRange(key, today) → { from?, to? }
```
Rules: theme tokens only; `NOT_AVAILABLE` for missing values; every clickable thing is a `Button`; `TYPOGRAPHY.md` scale; light + dark; 375 px. Changing the dataset clears `dateField`/`status` in the same `setValues` call. Docs: `AGENTS.md` §4 table row; `web/CLAUDE.md` note that `apiFetchDownload` is the way to download an authenticated file.

---

## PR3 — remaining datasets (independent of PR2)

Append keys to `DATA_EXPORT_DATASET_KEYS` (shared rebuild), one `*.dataset.ts` each, extend `forFeature`, one e2e `it.each` row per dataset + the three variation tests, Bruno `Download Deal Audits CSV` + `Download Service Tickets XLSX`.

| key | model · scope | default date | curated columns / notes |
|---|---|---|---|
| `deal_audits` | `DealAudit` · **audit** (`owner: { ownerField: { path: 'auditAssignee', polymorphic: true } }`) | `audit_date` (`auditDate ?? createdAt`, preStage) | deal number/sold date/producer/client via `dealId`; `assignee_type/_id/_name` (user → `displayNamesFor`, role → `roles.name` — add a `roles` lookup), `reviewer_*`, `reason_codes`, counts, ⤷ `failed_item_names` (items by `dealAuditId`); `producerIds` not supported (`buildScopeFilter` ignores it with `ownerField`). |
| `deal_audit_items` | `DealAuditItem` · producer | `first_created` (`firstCreatedAt ?? createdAt`) | deal + policy number + producer + status labels + `days_open` recomputed + `resolved_by_name` + `attachment_count`/`attachment_filenames` (never keys). |
| `activities` | `Activity` · agency/branch clamp only (`userId` is the actor, not an owner → refuse `own` scope with 403) | `occurred_at` | `actor_name`, subject label (lead name / deal number / household ref), `summary`; `changes` column **and** `type === 'field_changed'` rows only when the caller holds `agency:changelogs:read` (`$match type ≠ field_changed` otherwise; descriptor flags `requiresPermission`). |
| `service_tickets` | `ServiceTicket` · **ticket** (`buildTicketScopeFilter`, ObjectId tenancy, `isTestRecord` added explicitly) | `opened_at` | assigned rep name, household ref, policy number/type, category/status/priority, `timeline_count`, `last_timeline_at`, onboarding/renewal step fields; `branchId` filter cast to **ObjectId**; `producerIds` → `assignedUserId`. |
| `chargebacks` | `Chargeback` · producer | `occurred_at` | policy/deal/replacement refs, `amount`, `sold_adjustment`, `within_clawback_window`, `reason`. |
| later candidates | `prior_insurance`, `prior_policies`, `interested_parties`, `producer_goals` (`month` needs a `yearMonth` window kind) | | add on request; the registry makes each a one-file change. |

Variation tests: audit `own` scope matches a role-assigned audit for a caller holding that role; `field_changed` rows hidden without `agency:changelogs:read`; ticket ObjectId `branchId` narrowing returns rows.

---

## Later (explicitly out of scope)

- **Mailers export** (~738k rows, platform-wide `visibleAgencyIds`): needs the background path (worker → storage → presigned link + email), i.e. the mailer-campaign pattern; separate ticket.
- Saved export presets / scheduled exports (would give `data_export:write` a meaning).
- Multi-dataset ZIP bundle (`archiver`).

---

## Verification

1. `npm run shared:build` → `npm run build -w @sfa/api` → `npm run lint -w @sfa/api` → `npm run lint -w @sfa/web` → `npm run build -w @sfa/web` (PR1 must pass this too — `module-catalog.ts`).
2. `npm run test -w @sfa/shared` (permission-model + parity specs).
3. With `api:dev` stopped: `npm run test:unit -w @sfa/api`; `npm run test:e2e -w @sfa/api` (whole suite — suites share one DB).
4. Migration rehearsal on the **local copy of the prod dump only**: `db:migrate:status` → `db:migrate` → inspect `permissions` (2 rows), `agencies.modules.data_export`, `rolePermissions` for `data_team` → `db:migrate:down` → `up` again. Never against production.
5. `npm run api:seed:demo:dev`, start `api:dev` (watch the migration log line), then `cd bruno && npx @usebruno/cli run --env Local` **twice** against one DB (the folder is read-only and re-runnable).
6. Browser (PR2) at `/data-export`: as `dana.park@demoagency.local` (agency scope — branch filter visible), as `producer@demoagency.local` after granting `data_export:read` in `/settings/users/:id/permissions` (own rows only, no branch/producer selects), as the owner (`grantsAllEnabledModules`); light + dark; 375 px; download each dataset in both formats and open in Excel and Alteryx (BOM, dates, `; ` lists, typed XLSX cells); force the cap (`DATA_EXPORT_MAX_ROWS=10`) → toast + `failed` history row; disable the module in `/admin` → nav item gone, API 403.
7. Role matrix: `/settings/roles` shows the new "Data Export" row; grant/revoke round-trips; per-user override works.

## Gotchas to repeat in PR descriptions

- Scope clamps ignore `X-Branch-Id` for agency-scoped callers — the `branchId` query param (D6) is the only branch narrowing an owner gets.
- `serviceTickets`/`branches`/`users`/`agencies` store tenancy as **ObjectId**; every `TenantRecord` collection as **string**. The wrong type matches nothing, silently.
- `required: true` on a Mongoose string rejects `''` — hence D8.
- `DATA_EXPORT_MAX_ROWS` must be read per call or the e2e cap test cannot set it.
- CORS `exposedHeaders: ['Content-Disposition']` or the browser never sees the filename.
- `permission-model.spec.ts`'s CSR map iterates `ALL_MODULE_KEYS` — add the `'none'` entry.
- The migration grants the role; **only the migration** enables the module on existing agencies (`sync:roles` does not).
- Redis permission cache: Data Team members keep their old set until TTL/login.
- No CSV formula escaping (D3) — say so in the dictionary description of the page.

## Open questions (assumptions built in)

1. Linear ticket number → plan filename and handoff section (`PAC-152`).
2. `effectiveDate`/`renewalDate`/`expirationDate` storage shape (UTC-midnight date vs instant) — decides `utcDate` vs `instant` kind; check `sold-deals.service.ts` and the migration mapper at implementation.
3. Whether `household-status.ts` exposes a query-values helper like `leadStatusQueryValues`; otherwise match label + raw codes by hand.
4. Preset "today" on the web is the browser's calendar, not the agency's (`/auth/me` does not expose `timeZone`) — acceptable for All time / This year / Last 12 months, or add `timeZone` to `AuthUser`.
5. Over-cap refusals appear in "Recent exports" as `failed` (the audit trail records attempts) — confirm with David.
6. Column set per dataset is a first cut mapped from the legacy SmartSuite tables; expect Carl to request additions once he sees the dictionary — each is a one-line column entry.

---

## Background jobs (user decision, 6 Oct 2026) — supersedes D4

The user changed the workflow after PR1/PR2 were built: instead of downloading immediately,
an export is **requested**, shown in the log as being prepared ("you will be notified"),
produced by a **worker task** that uploads the file to object storage, and **downloaded
later** by the data team.

| # | Topic | Decision |
|---|---|---|
| A1 | Request | `POST /data-export/:dataset/exports` (JSON body = the former query fields) → plan + count (over cap: 400 `EXPORT_TOO_LARGE`, logged `failed`) → `dataExports` row `queued` → `InngestService.send(dataExportRequested, { exportId, agencyId, requestedBy, brand })` → **202** `{ export }`. `GET :dataset/download` is removed. |
| A2 | Worker input | The row stores the filter echo plus a **scope snapshot** (`userId`, `branchId`, `requestBranchId`, `dataScope`, `roleIds`, `timeZone`); the worker rebuilds an `AccessContext` and re-plans. A pipeline cannot be stored (`$` keys). The file reflects what the requester could see when they asked. |
| A3 | Engine location | `api/src/common/data-export/` (`engine/`, `datasets/`, `writers/`, `plan.ts`, `run.ts`) so the worker may import it. `data-export` and `lead-sources` added to `FEATURE_DIRS`. |
| A4 | Feature imports dropped | `ExportLookups` reads the `LeadSource` model (same query as `labelsFor`); `contactDisplayName` → `common/domain/contact-names.ts`; `client-scope.ts` → `common/access/` (re-exported from `clients/`). |
| A5 | File | Temp file → `StorageService.putObjectFromFile` (streamed `PutObject` with `ContentLength`). Key `agencies/<agencyId>/data-exports/<year>/<exportId>/<filename>`, deterministic (`buildObjectKey` gained `parts`/`unique`). |
| A6 | Status | `queued → processing → ready \| failed`, then `expired`. `truncated` boolean. |
| A7 | Notification | Email `dataExportReady` to the requester with a button to `/data-export` on the agency's host — **never a presigned link**. Agency brand resolved by the API and carried on the event. A mail failure is written to `notification.error` and never fails the export. The page polls while a row is pending. No in-app notification system exists; email + the live log is the notification. |
| A8 | Download | `GET /data-export/exports/:id/url` → presigned attachment (5-minute default TTL), minted on click; same visibility as the history (404 otherwise); 409 while preparing; 410 once expired. Counts `downloadCount` / `lastDownloadedAt`. |
| A9 | Retention | `DATA_EXPORT_RETENTION_DAYS` (default 7, 1–30). Hourly `DataExportExpireFn` deletes the object and marks the row `expired`; the row is kept. |
| A10 | Idempotency | `idempotency: event.data.exportId`, `retries: 2`, `concurrency: 2`. `claim` admits `queued`, or `failed` only if the job had started — a cap refusal is never run; a replay of a finished export is a no-op. |

Removed with the synchronous path: web `apiFetchDownload` / `saveBlob`, CORS
`exposedHeaders: ['Content-Disposition']`, `common/http/content-disposition.ts`.

Tests: `test/worker/data-export.e2e-spec.ts` replaces `test/data-export.e2e-spec.ts` — it lives
under `test/worker/` because it drives `DataExportGenerateFn` after each HTTP request (the only
test directory the worker boundary admits). New `plan.unit-spec.ts` and template cases.

