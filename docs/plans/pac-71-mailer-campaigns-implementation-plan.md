# PAC-71 — Mailer Campaigns: implementation plan

Ticket: https://linear.app/paciscigroup/issue/PAC-71 (spec is authoritative; this plan is the execution order).
Paths are relative to the repo root; `api/` = `packages/api/`, `web/` = `packages/web/`, `shared/` = `packages/shared/`.

## Context

Today an operator runs ApexReports' *SFA Processor* on the vendor's mail file, downloads its output, and uploads that output to our **Add Mailers** page (PAC-73). ApexReports is being retired, so PAC-71 takes the file one stage earlier: the operator uploads the **vendor file** (XLSX, ~20k rows × 124 cols), we run the transform ourselves (already ported and proven in `api/src/common/mailers/mailer-processor.ts`, 197/197 fixture rows reproduced), write the mailers, produce the 132-column print CSV, and record everything on a first-class **campaign**. A campaign is run once and can serve many agencies (assignment by the file's `agencyid` matched to PAC-93 carrier appointments, or an explicit list, or all). Leads get a real link to the mailer and campaign that produced them, which is the foundation for the reporting ticket that follows.

Decisions taken with the user (2026-09-06):
- **Output delivery = download button + completion email carrying a time-limited download link.** No attachment support is added to the mail transport.
- **ZIP→market table is platform-global** now; the schema keeps `agencyId: null` so per-agency overrides can be added later without a migration.
- **No New Lead form field.** The Mailers drawer is the control-number entry point. The API still normalizes and links a typed `quoteControlNumber` arriving on any intake (create-lead DTO, public form, share link), because the ticket's attribution path 2 lives server-side.
- **Delivered as four PRs**, each green on lint/build/e2e/Bruno.

Design decisions this plan fixes (the ticket left them open):
- **Append: newest commit owns the mailer.** The upsert `$set`s `campaignId`/`visibleAgencyIds`/`carrierAgencyId`; the old campaign's live count drops; `Lead.mailer.campaignId` is stamped at link time and never rewritten. Preview shows the overlap before commit.
- **Overwrite = import first, then delete leftovers.** Rows in both files keep their `_id` (lead links survive); rows only in the old campaign are deleted (their leads get `mailer.mailerId: null`); the replaced campaign becomes `superseded`. The exact delete count is computed at preview, re-verified at commit, asserted in the delete step.
- **Campaign-exists check** is platform-wide on `{carrierId, campaignNumber, year, status ∈ {imported, processing}}`.
- **Visibility query uses `{ visibleAgencyIds: { $type: 'null' } }`, never `null`** (`null` also matches a missing field, which would expose un-migrated mailers to every agency). `mode: 'all'` stores an explicit `null`.
- **Worker steps never carry rows.** The `process` step writes the output CSV to storage and returns `{outputKey, stats}`; `import` re-streams it. Reconcile iterates *leads* with a pending key, not the 20k imported keys.
- **One lead per mailer, platform-wide**: unique partial index `{ 'mailer.mailerId': 1 }` on `leads`; `logLead` pre-checks and returns 409; E11000 on that index maps to 409.
- **Add Mailers (server + page) is deleted in PR1**, not PR3, because `ImportMailersFn` cannot compile against the new engine signature without a throwaway campaign adapter. Between PR1 and PR3 the panel has no import UI on `dev`; the demo seed still creates mailers. Noted in the PR1 description.

Reference material: `docs/mailers-handoff.md` (settled decisions), `api/test/fixtures/mailers/README.md` (vendor-file profile), `apex-mail-companion/src/components/mail/Part2.tsx` (the source flow; read-only), PAC-93 (carrier appointments, already on this branch).

---

## PR1 — Data model, backfill/index migration, engine + lookup refactor, delete Add Mailers

### 1.1 Shared types
- New `shared/src/domain/mailer-campaign.ts`: `MailerCampaignStatus = 'uploaded'|'previewed'|'processing'|'imported'|'failed'|'superseded'`, `MailerCampaignSource = 'vendor'|'processed'|'migration'|'demo'`, `MailerAssignmentMode`, `MailerCampaignAssignment {mode, agencyIds}`, `MailerCampaignSettings {premiumFloor, fileName, defaultMarket, marketPhones, defaultPhone, runYear, discounts: MailerDiscountRules, zipResolutions: Record<zip5, market>, outputRecipients: string[]}`, `MailerCampaignStats`, `MailerCampaignPreview` (columns check, counts, `unmatchedZips`, premium spread, `floorHitRate`, `assignment: {resolved: {codeKey, agencyId|null, agencyName|null, rows}[], unmatched: string[]}`, `existingCampaigns`, `overlap: {existingInOtherCampaigns, replacedRecordCount, deleteCountIfOverwrite}`, `rejections`, `inconsistentColumns`), `MailerCampaignImportCounts extends MailerImportCounts {deleted, leadsLinked, leadsConflicted}`, `MailerCampaignFile {name, size, sha256?}` (never a storage key), `MailerCampaign`, `MailerCampaignListItem` (+ `recordCount`, `leadsAttributed`, `visibleAgencyNames | null`), `MailerCampaignRecord`, `MailerCommitRequest` (discriminated `append` | `overwrite {replaceCampaignIds, expectedDeleteCount}`), `MailerZipMarket`, `LeadMailerMatchedBy`, `MAILER_CAMPAIGN_REQUIRED_COLUMNS`, `MAILER_CAMPAIGN_RECOMMENDED_COLUMNS`.
- Move `MailerDiscountRules`/`SquareFootageBand` types from `mailer-processor.ts:81-87` to shared and re-export from the processor (processor logic untouched).
- `shared/src/domain/mailer.ts`: delete `MailerImportRunStatus`, `MailerImportRun`; rename `MailerImportDetected.agencyId` → `carrierAgencyId`; `MailerLookupView.alreadyLogged` docblock → platform-wide.

### 1.2 Mailer schema — `api/src/mailers/schemas/mailer.schema.ts`
Replace `agencyId` (L197) with `campaignId: string` (required, index), `visibleAgencyIds: string[] | null` (`@Prop({ type: [String], default: null })` — verify Mongoose stores an explicit `null` rather than `[]`; `bulkWrite` bypasses casting so the importer writes `null` literally), `carrierAgencyId?: string` (trim, uppercase). Export index constants the migration imports:
```ts
export const MAILER_DEDUPE_INDEX_NAME = 'controlNumberKeys_1';
export const MAILER_DEDUPE_INDEX_KEY = { controlNumberKeys: 1 } as const;
export const MAILER_DEDUPE_INDEX_OPTIONS = { unique: true, partialFilterExpression: { controlNumberKeys: { $type: 'string' } } } as const;
```
Plus `{ campaignId: 1, lastName: 1, firstName: 1 }` (records table + count) and `{ campaignId: 1, 'source.runId': 1 }`. Remove the four `agencyId_*` index declarations (the script drops them). No visibility index: the unique key resolves to ≤1 doc and the `$or` is a residual filter (a compound of two array fields is not even buildable).

### 1.3 New schemas
- `api/src/mailers/schemas/mailer-campaign.schema.ts` (collection `mailerCampaigns`, modelled on `Carrier`, not `TenantRecord`): `carrierId: ObjectId` (index), `name`, `campaignNumber`, `weekNumber|null`, `year|null`, `status` (`type: String`, enum, index), `source`, `assignment {mode, agencyIds}`, `carrierAgencyIds[]`, `carrierAgencyNames[]`, `settings` (sub-schema via `SchemaFactory`) `| null`, `vendorFile {storageKey, name, size, sha256?, contentType} | null`, `outputFile` same, `stats | null`, `preview` (`type: Object`) `| null`, `importCounts | null`, `rejections[]`, `commitMode | null`, `replaceCampaignIds[]`, `expectedDeleteCount | null`, `previewAttempt`, `commitAttempt`, `error | null`, `requestedBy: ObjectId | null`, `quoteDate | null`, `finishedAt | null`, `supersededByCampaignId | null`, `recordSource?` (`'demo:seed'` purge key), `migrationKey?` (`${agencyId}|${week}|${year}`, unique partial `$type:'string'`). Indexes: `{carrierId, campaignNumber, year, status}`, `{status, createdAt:-1}`, `{'assignment.agencyIds', createdAt:-1}`.
- `api/src/mailers/schemas/mailer-zip-market.schema.ts` (collection `mailerZipMarkets`): `agencyId: string | null` (default null, Carrier-style null-as-value), `zip5` (validated `/^\d{5}$/`), `market`, `source: 'seed'|'preview'|'manual'`, `updatedBy: ObjectId | null`. Unique `{agencyId, zip5}` — NOT partial (null is a value here, same as `Carrier`).
- `api/src/leads/schemas/lead.schema.ts`: `LeadMailerLink` sub-schema (`@Schema({_id:false})` → `SchemaFactory`, referenced as `@Prop({ type: LeadMailerLinkSchema }) mailer?`): `mailerId: ObjectId | null`, `campaignId: string | null`, `controlNumberKey?`, `matchedBy?` (`type: String`, enum), `linkedAt?`, `linkedBy: ObjectId | null`. Indexes (exported constants): unique partial `{'mailer.mailerId':1}` (`$type:'objectId'`, name `mailer.mailerId_1`); `{'mailer.campaignId':1, agencyId:1}` partial (serves both the platform "leads attributed" count and the agency-scoped query; the ticket's second `{agencyId,'mailer.mailerId'}` is redundant with the unique one); `{'mailer.controlNumberKey':1}` partial (reconcile). Keep `quoteControlNumber` + its index (still the display string and the Leads-list regex search in `leads.service.ts:279`).

### 1.4 Import engine — `api/src/common/mailers/mailer-row.mapper.ts`, `mailer-import.ts`
- `MailerMapContext` (mapper L20): replace `agencyId` with `campaignId: string` and `visibleAgencyIdsFor: (carrierAgencyCodeKey: string | null) => string[] | null | undefined` (`null` = all; `undefined` = unassignable → the row is rejected with `No agency is assigned for carrier agency code X`).
- `mapMailerRow` (L143): derive `carrierAgencyId` from `row.agencyid` (uppercased) and `codeKey = appointmentCodeKey(...)` (from `@sfa/shared` `domain/carrier-appointment.ts:44`); doc gets `campaignId`, `visibleAgencyIds`, `carrierAgencyId`; no `agencyId`. `detectFromRow` (L332): `agencyId` → `carrierAgencyId`.
- `importMailerRows` (L192-228): upsert filter → `{ controlNumberKeys: { $in: keys, $type: 'string' } }` (update the load-bearing comment to name `controlNumberKeys_1`). Docblock on `SINGLE_VALUED_COLUMNS` (L119): several `agencyid`/`quotedate` values are normal for a campaign; `inconsistentColumns` is informational.
- New pure helper `api/src/common/mailers/implicit-campaign.ts`: `implicitCampaignKey({agencyId, weekNumber, year})` and `implicitCampaignDoc(key, {carrierId, agencyName, campaignNumber, fileName, source: 'migration'|'demo'})` (status `imported`, `assignment {mode:'agencies', agencyIds:[agencyId]}`, settings `null`). Used by the migration script, the BigQuery CLI shim and the demo seed.

### 1.5 Callers of the engine and readers of `Mailer.agencyId`
- **Delete**: `api/src/worker/functions/import-mailers.fn.ts` + `.unit-spec.ts`, `api/test/worker/import-mailers.e2e-spec.ts`, `api/src/mailers/platform-mailers.controller.ts`, `platform-mailers.service.ts`, `dto/mailer-import.dto.ts`, `schemas/mailer-import-run.schema.ts`, `bruno/Platform Mailers/` (whole folder), `web/src/features/platform/AddMailersPage.tsx`, `components/ImportReport.tsx`, `web/src/lib/platform-mailers-api.ts`, the `/admin/mailers/add` route (`web/src/app/App.tsx:679-695`) and the `add-mailers` entry in `web/src/features/platform/panel-areas.tsx`. Keep by moving: `MAILER_FILE_CARRIER` → `api/src/common/mailers/mailer-carrier.ts` as `DEFAULT_MAILER_CARRIER`; `ALLOWED_MAILER_CONTENT_TYPES`/`MAX_MAILER_FILE_BYTES` → `api/src/common/mailers/mailer-file-types.ts`; web `uploadToPresignedUrl` → `web/src/lib/presigned-upload.ts`. Remove `ImportMailersFn`/`MailerImportRun` from `api/src/worker/worker.module.ts:55-82`. Manual step after deploy: `db.mailerImportRuns.drop()`.
- `api/src/migration/mailers/import-bigquery-mailers.ts:126-191`: bucket by `implicitCampaignKey` (week from `parseWeekNumber(row.campaignnumber)`, year from `quoteDate`), upsert the campaign via a `MailerCampaign` model added to `mailer-bigquery.module.ts` (requires the global Allstate carrier, abort if missing), pass `{campaignId, visibleAgencyIdsFor: () => [agencyId], system:'bigquery'}`. Compile-only; slated for deletion after cutover.
- `api/src/seed/demo/demo-seed.service.ts` `seedMailers` (L1619): upsert one demo campaign (`recordSource:'demo:seed'`, `migrationKey`), stamp `campaignId`, `visibleAgencyIds: [agencyId]`, `carrierAgencyId: 'A0B9049'` on each mailer; `purge` (L1902) also deletes `mailerCampaigns` by `recordSource`.
- `api/src/mailers/mailers.module.ts`: register `MailerCampaign`, `MailerZipMarket`, `Carrier`, `User`; drop the deleted providers.
- Tests: `api/test/mailer-import.e2e-spec.ts` (ctx shape, `campaignId` filters, `detected.carrierAgencyId`, new cases: unassigned code rejected; explicit `null` stored), `api/test/mailer-lookup.e2e-spec.ts` `insertMailer` helper → `{campaignId, visibleAgencyIds}`.

### 1.6 Lookup, log-lead, intake — `api/src/mailers/mailers.service.ts`, `api/src/leads/intake/*`
- `findByControlNumber` (L199): `findOne({ controlNumberKeys: key, $or: [{ visibleAgencyIds: { $type: 'null' } }, { visibleAgencyIds: agencyId }] })`.
- `resolveExistingLead` (L251): platform-wide `findOne({'mailer.mailerId': mailer._id})`. None → `{alreadyLogged:false, linkedLeadId:null}`. Same agency and inside `buildScopeFilter` → `linkedLeadId`; same agency out of scope, or **another agency** → `{alreadyLogged:true, linkedLeadId:null}` (reveals nothing). Drop the `quoteControlNumber $in` query and the "known gap" note.
- `logLead` (L112): after lookup, `leadModel.findOne({'mailer.mailerId': mailer._id}).select('agencyId')`; other agency → `ConflictException` (409). Pass `mailer: {mailerId, campaignId, controlNumberKey: controlNumberKeys[0], matchedBy: 'drawer'}` on `IntakeInput` (add the optional field to `intake.types.ts` `IntakeInput`).
- New provider `api/src/leads/intake/mailer-link.resolver.ts` (`MailerLinkResolver`, `@InjectModel(Mailer.name)`): `resolve(rawControlNumber, agencyId)` → `{mailerId, campaignId, key}` | `{mailerId:null, campaignId:null, key}` | `null`; runs the visibility query; downgrades to key-only when `leadModel.exists({'mailer.mailerId'})` says another agency's lead owns it (a producer typing a number must still get a lead, never a 409 here). Register the `Mailer` schema in `LeadsModule.forFeature` (`api/src/leads/leads.module.ts:45`) — `MailersModule` already imports `LeadsModule`, so no cycle and no `forwardRef`.
- `resolve-lead.step.ts` `run()` (L132): `link = input.mailer ?? (input.quoteControlNumber ? resolver.resolve(...) : null)`. Signal 2 (L148-158) becomes: `link.mailerId` → `findOne({agencyId, 'mailer.mailerId'})`; else `link.key` → `findOne({agencyId, 'mailer.controlNumberKey': key, 'mailer.mailerId': null})`; drop the raw `quoteControlNumber` equality (after the backfill every lead with one carries the key). `create()` (L195) writes `mailer` (`matchedBy: 'drawer'` when `input.mailer`, `'control_number'` when resolved, absent when key-only; `linkedBy: ctx.actorUserId`). `mergeIntoExisting()` (L265) fills `mailer` only when empty (same rule as `quoteControlNumber`).
- `lead-intake.service.ts:149` catch: E11000 whose `keyPattern` has `mailer.mailerId` → `ConflictException`; otherwise the existing token re-read.

### 1.7 Migration script — `api/src/migration/backfill/mailer-campaigns.ts`
Pattern: `git show b5c318c^:packages/api/src/migration/backfill/fix-legacy-dedupe-indexes.ts` (discover by index name, check data before dropping) + `allstate-id-to-carrier-appointment.ts` (bare `createConnection`, no models, `--dry-run`, `process.exitCode = 1` when blocked). Export `run(db, options)` so an e2e can drive it; `main()` wraps it. npm `backfill:mailer-campaigns[:dev]` + root `api:backfill:mailer-campaigns[:dev]`. Flags: `--dry-run`, `--merge-duplicates`.

**Run order in production: stop API + worker → run the script from the new build → deploy.** Old code would insert un-stamped rows during the run; new code's `autoIndex` would try to build the unique index before duplicates are verified.

Phases (each idempotent, counts logged):
1. Preconditions: global Allstate carrier exists (else "run core seed first"); list `mailers` indexes by name; count un-stamped docs.
2. Implicit campaigns: `$group` un-stamped mailers by `{agencyId, campaign.weekNumber, $year(quoteDate)}` (`allowDiskUse`); per group upsert `mailerCampaigns` on `migrationKey` with `implicitCampaignDoc` (null week/year → one "unknown" campaign per agency).
3. Stamp: per group a pipeline `updateMany` setting `campaignId`, `visibleAgencyIds: [agencyId]`, `carrierAgencyId: $toUpper($trim(source.raw.agencyid))`; verify zero un-stamped remain.
4. Duplicate check **before touching indexes**: `$unwind controlNumberKeys` → `$group` with `n > 1`. Any → print first 20 and stop with exit 1 unless `--merge-duplicates`: keep the doc with the newest `source.lastUpdatedAt ?? updatedAt`, union `visibleAgencyIds`, delete the rest, repoint `leads.mailer.mailerId`. Re-check must be empty.
5. Index swap: `createIndex(MAILER_DEDUPE_INDEX_KEY, {name, ...OPTIONS})` **first** (key pattern differs, so both coexist — no uniqueness window), then drop `agencyId_1_controlNumberKeys_1`, `agencyId_1`, `agencyId_1_campaign.campaignNumber_1`, `agencyId_1_source.runId_1` (each guarded).
6. `$unset agencyId` on all mailers.
7. Lead backfill: cursor over `leads` with `quoteControlNumber` and no `mailer`; `key = mailerControlNumberKey(qcn)`; resolve the mailer with the visibility query for `lead.agencyId`; exactly one lead per mailer → full link (`matchedBy:'control_number'`, `linkedBy:null`); several → key-only and printed as conflicts; not found → key-only. Then create the three lead indexes (unique last, guarded by name).

### 1.8 Core seed — `api/src/seed/zip-markets.seed.ts`
Copy `api/test/fixtures/mailers/zip-markets.csv` to `api/src/seed/data/zip-markets.csv` and add `"assets": ["seed/data/*.csv"]` to `api/nest-cli.json` (the build does not ship `test/`). Reject non-5-digit rows (the `4031` typo) with a warning; upsert `{agencyId:null, zip5}` with `$setOnInsert {market, source:'seed'}` so a later manual edit is never overwritten. Wire into `api/src/seed/seed.ts`.

### 1.9 PR1 tests
- Unit: mapper, import engine (unassigned → rejection; `null` visibility stored), `implicit-campaign.unit-spec.ts`, `zip-markets.seed.unit-spec.ts` (565 → 564).
- e2e: `mailer-import`, `mailer-lookup` (+ visible-to-all resolves; not-visible 404s; un-stamped mailer does not resolve; `alreadyLogged` from another agency with `linkedLeadId:null`; **409 on `POST /mailers/log-lead` from a second agency**; same-agency replay idempotent), new `lead-intake-mailer-link.e2e-spec.ts` (typed number → `control_number`; unknown → key-only; owned elsewhere → key-only), new `migration/mailer-campaigns-backfill.e2e-spec.ts` (old-shape data → stamping, index names, `agencyId` gone, lead links, duplicate block, `--merge-duplicates`, second run is a no-op).
- Bruno: `bruno/Mailers/Log Mailer Lead (Other Agency, 409).bru`; update `Lookup Mailer` asserts (`not.have.property('visibleAgencyIds'|'campaignId')`).

---

## PR2 — Storage put, XLSX reader, ZIP markets API, campaign API, worker jobs

### 2.1 Storage — `api/src/storage/storage.service.ts`
`putObject(key, body: Buffer, contentType)` (`PutObjectCommand` on the internal client); `buildPlatformObjectKey({purpose, filename, parts?})` → `platform/<purpose>/<year>/<parts>/<uuid>-<safeName>`; `assertPlatformKeyOwnership(key, {purpose})`; `createPresignedDownload` gains `expiresIn?` (the emailed link uses 7 days). Purpose constant `MAILER_CAMPAIGN_PURPOSE = 'mailer-campaigns'`.

### 2.2 Vendor file reader — `api/src/common/mailers/vendor-file-reader.ts`; deps `exceljs`, `csv-stringify`
`detectVendorFileKind(filename, contentType, head?)` (extension or `PK\x03\x04` magic); `readVendorFile(body, kind) → {headers, rows}` (XLSX: `new ExcelJS.stream.xlsx.WorkbookReader(body, {sharedStrings:'cache', hyperlinks:'ignore', styles:'ignore', worksheets:'emit'})`, first sheet, `row.values.slice(1)`, first row = headers, pad short rows; CSV: `csv-parse` `columns:false` via `pipeline`, never `.pipe`); `cellToPrimitive` (rich text → text, formula → result, hyperlink → text, **`Date` → Excel serial integer** — the inverse of `excelSerialToDate` — so `quotedate` reaches the processor in the form the CSV path and the print file already use; verify against `mailer-processor.unit-spec.ts`); `writeVendorCsv(headers, rows) → Buffer` (`csv-stringify`, `header:true`). Add the XLSX MIME type to `mailer-file-types.ts`. Rows are collected in memory (the processor sorts/dedupes; 20k rows in 179 ms); streaming applies to the parse only.
Unit spec: build a small xlsx in memory with exceljs (rich-text, date, formula, blank trailing cells), read back, assert `processMailerFile` output equals the CSV-derived output for the same data.

### 2.3 Assignment resolver — `api/src/common/mailers/campaign-assignment.ts`
`resolveAssignment(agencyModel, {carrierId, assignment}, codeCounts) → {byCodeKey: Record<codeKey, string[]|null>, unmatched, resolved[]}`. `all` → every code `null`; `agencies` → the list (validated to exist); `carrier_agency_id` → `agencyModel.find({ carrierAppointments: { $elemMatch: { carrierId, codeKey: {$in}, active: true } } }).select({_id,name,carrierAppointments}).lean()` (hits `CARRIER_APPOINTMENT_LOOKUP_KEY`; `?? []` for pre-PAC-93 docs; the unique key makes >1 match impossible). Blank code → unmatched `'(blank)'`. Message: `No agency holds an active <Carrier> appointment for code <code> (<n> rows). Add the appointment on the agency, or switch assignment to "Specific agencies".` `visibleAgencyIdsFor = key => byCodeKey[key ?? '(blank)']`.

### 2.4 ZIP markets — `api/src/mailers/mailer-zip-markets.service.ts` + `platform-mailer-zip-markets.controller.ts`
`loadFor(agencyIds | null)` (global rows, then agency rows shadow, then campaign `zipResolutions` on top), `upsertMany`, `remove`, `list`. Endpoints (platform stack `@SkipTenant() @SkipBranch() @SkipModule() @UseGuards(PermissionsGuard)`): `GET /platform/mailer-zip-markets?agencyId&q&page&pageSize` (`MailersRead`), `PUT /platform/mailer-zip-markets` `{entries: [{zip5, market, agencyId?}]}` max 1000 (`MailersWrite`), `DELETE /platform/mailer-zip-markets/:id` (`MailersWrite`). In this ticket the UI writes global rows only.

### 2.5 Campaign API — `api/src/mailers/mailer-campaigns.service.ts`, `platform-mailer-campaigns.controller.ts`, `dto/mailer-campaign.dto.ts` (zod, same style as the deleted import DTO)
Schemas: `presignCampaignFileSchema {filename, contentType (csv + xlsx), size ≤ MAX}`, `assignmentSchema` (discriminated on `mode`), `settingsSchema` (floor ≥ 0, fileName, defaultMarket, marketPhones record, defaultPhone, runYear 2000–2100, discounts rules, zipResolutions record of 5-digit keys, outputRecipients ≤ 20 emails), `createCampaignSchema {name?, carrierId?, source: 'vendor'|'processed', storageKey, uploadedFilename, size, contentType, campaignNumber?, assignment, settings}`, `updateCampaignSchema` (partial pick), `commitCampaignSchema` (`append` | `overwrite {replaceCampaignIds ≥1, expectedDeleteCount}`), list/records queries, `emailOutputSchema {recipients?}`.

| Endpoint | Perm | Behaviour |
|---|---|---|
| `GET /platform/mailer-campaigns` | Read | filters agencyId/status/carrierId/q, paginated; `recordCount` via one `$group` on `mailers.campaignId`, `leadsAttributed` via one `$group` on `leads.mailer.campaignId`; `visibleAgencyNames` from assignment (carrier mode → agencies in `preview.assignment.resolved`) |
| `GET …/defaults` | Read | Allstate `carrierId`, `campaignNumberForDate(now)`, `runYear`, last imported campaign's `settings`/`assignment` or `DEFAULT_MAILER_DISCOUNTS` + Apex defaults (floor 1916.44, phones, `Oklahoma City`) |
| `POST …/presign` | Write | platform key → `{key, uploadUrl, requiredHeaders}` |
| `POST /platform/mailer-campaigns` | Write | `assertPlatformKeyOwnership` → `statObject` (size must match) → create `uploaded`, `previewAttempt: 1` → dispatch preview; mark `failed` if the send throws (as `PlatformMailersService.dispatch` did) |
| `GET …/:id` | Read | DTO, never storage keys |
| `PATCH …/:id` | Write | allowed in `uploaded|previewed|failed`; `zipResolutions` also upserted into global `mailerZipMarkets` (`source:'preview'`); bumps `previewAttempt`, status → `uploaded`, re-dispatches preview |
| `POST …/:id/preview` | Write | re-dispatch (recovery) |
| `POST …/:id/commit` | Write | gating below → 202 |
| `GET …/:id/records?q&page&pageSize` | Read | `q` normalizes to a control-number key when possible (`{campaignId, controlNumberKeys: key}`), else anchored case-insensitive name match; sorted last/first name |
| `GET …/:id/files/:kind(vendor|output)/url` | Read | mints a presigned download on click |
| `POST …/:id/email` | Write | status `imported`; dispatches the output-email event |
| `DELETE …/:id` | Write | only `uploaded|previewed|failed`; deletes the vendor object |

`defaults` and `presign` are declared above `:id` (Nest matches in declaration order).

**Commit gating:** status `previewed` (409 naming the current status) → `preview.assignment.unmatched` empty (422 with the messages) → re-run `resolveAssignment` now (appointments may have changed) → for `overwrite`: `replaceCampaignIds ⊆ preview.existingCampaigns` (400); re-count `countDocuments({campaignId ∈ replace})` must equal `preview.overlap.replacedRecordCount` (409 "counts changed, re-run preview"); `expectedDeleteCount === preview.overlap.deleteCountIfOverwrite` (409 with the fresh number) → CAS `findOneAndUpdate({_id, status:'previewed'}, {$set: {status:'processing', commitMode, replaceCampaignIds, expectedDeleteCount, requestedBy}, $inc: {commitAttempt: 1}})`, null → 409 → dispatch commit event.

### 2.6 Events — `api/src/inngest/events/mailer.events.ts` (rewrite)
`campaignJobSchema = {...eventEnvelope, campaignId: objectId, attempt: int ≥1, requestedBy: objectId}`; `mailerCampaignPreviewRequested` (`mailers/campaign.preview.requested.v1`), `mailerCampaignCommitRequested` (`…commit…`), `mailerCampaignOutputEmailRequested` (`…output-email…`, + `recipients: string[] ≥1`). No transforms (Inngest `AssertNoTransform`).

### 2.7 Worker functions — `api/src/worker/functions/mailer-campaign-{preview,commit,output-email}.fn.ts` + `mailer-campaign.support.ts`
Register in `worker.module.ts` with `MailerCampaign`, `MailerZipMarket`, `Mailer`, `Agency`, `Carrier`, `Lead` schemas. Boundary: `*.schema`, `common/**`, `inngest/**` only (eslint enforces). Copy the `handle(event, step)` + `StepLike` seam from the deleted `import-mailers.fn.ts`. Config: preview `concurrency {limit: 3, key: 'event.data.campaignId'}`; commit `concurrency {limit: 1}` (global; same-week campaigns serialize and the count re-check catches staleness); both `idempotency: 'event.data.campaignId + "-" + event.data.attempt'`, `retries: 2`.

**Preview** (one `step.run`, returns a small summary): load campaign (`uploaded` and `previewAttempt === attempt`, else stale no-op) → `readVendorFile(storage.getObjectStream(vendorFile.storageKey))` → required/recommended column check (missing required → `failed` with the list) → distinct `agencyid`/`agencyname` + `codeCounts` → `resolveAssignment` → `zipMarkets = layer(global, settings.zipResolutions)` → `processMailerFile(headers, rows, {...settings, campaignNumber, zipMarkets})` (`source:'processed'` skips it) → blank/invalid ZIP counts, premium spread, `floorHitRate = floorRaised / outputRows` → dry `importMailerRows` (rejections, `inconsistentColumns`) → existing campaigns + overlap (collect keys from processed rows, chunk 5,000, `$group` by `campaignId`; `replacedRecordCount`, `deleteCountIfOverwrite`) → `quoteDate` = min `quotedate`, `weekNumber`/`year` from `campaignNumber` + `runYear` → `$set {preview, status:'previewed', carrierAgencyIds, carrierAgencyNames, quoteDate, weekNumber, year}`. Failure → `failed` + rethrow.

**Commit** (chain of `step.run`s, each returning small JSON; steps 2–7 wrapped so a throw sets `failed` + rethrows):
1. `gate` — status `processing|failed`, `commitAttempt === attempt`.
2. `resolve-assignment` → `byCodeKey`; unmatched → `failed` with the message.
3. `process` — vendor: read → `processMailerFile` → `writeVendorCsv` → `putObject(platform/mailer-campaigns/<year>/<campaignId>/<attempt>/<fileName>.csv)` (deterministic key; a retry overwrites); processed: `outputKey = vendorFile.storageKey`. `$set outputFile {name, size, sha256}, stats`.
4. `import` — `getObjectStream(outputKey)` → `csv-parse` (`columns: h => h.map(normalizeHeader)`, `pipeline`) → `importMailerRows(parser, {campaignId, visibleAgencyIdsFor, system:'spreadsheet', runId: `${campaignId}:${attempt}`, uploadedFilename, storageKey, uploadedAt, updatedBy: requestedBy}, {model})`. Retry-safe (upsert).
5. `delete-replaced` (overwrite only) — ids under `replaceCampaignIds` (chunked); log if `ids.length !== expectedDeleteCount` (never refuse here, the operator confirmed) → `leads.updateMany({'mailer.mailerId': {$in}}, {$set: {'mailer.mailerId': null}})` → `mailers.deleteMany` → replaced campaigns `status:'superseded', supersededByCampaignId`.
6. `reconcile-leads` — `V` = `null` (all) or resolved agency ids; cursor `leads.find({'mailer.mailerId': null, 'mailer.controlNumberKey': {$type:'string'}, ...(V ? {agencyId: {$in: V}} : {})})`; per key `mailers.findOne({controlNumberKeys: key, campaignId})`; exactly one candidate → `updateOne({_id, 'mailer.mailerId': null}, {$set: {...link, matchedBy:'control_number', linkedBy: requestedBy}})`, E11000 (drawer won meanwhile) counted as conflicted; several candidates → `leadsConflicted`.
7. `finalize` — `status:'imported'`, `importCounts {…counts, deleted, leadsLinked, leadsConflicted}`, `rejections`, `finishedAt`.
8. `email-output` — if `settings.outputRecipients.length` → `inngest.send(outputEmailRequested)` (separate function so a mail failure never fails the import).

### 2.8 PR2 tests
- Unit: `campaign-assignment` (three modes, blank code, inactive appointment, pre-PAC-93 agency), `vendor-file-reader` (xlsx ≡ csv), `mailer-campaigns.service` (commit gating matrix: wrong status, unmatched, stale counts, wrong `expectedDeleteCount`, CAS loss).
- e2e: `mailer-campaigns` (presign → create → get → patch → commit 409/422 cases, records search, list filters, defaults prefill), `mailer-zip-markets`, `worker/mailer-campaign-preview` (fixture-derived CSV **and** xlsx; missing required column; unmatched code; existing-campaign + overlap numbers), `worker/mailer-campaign-commit` (append moves rows A→B; overwrite deletes exactly `expectedDeleteCount`, unlinks leads on deleted rows, supersedes A; reconcile links one candidate and reports a two-candidate conflict; retry between `import` and `finalize` does not double-import; processed source skips the transform; the fixture's reconstructed input reproduces the derived columns end to end).
- Bruno: `bruno/Platform Mailer Campaigns/` (Login, Defaults, Presign, Upload File (bare PUT), Create, Get (Previewed, with the poll-loop script from the old chain), Patch Zip Resolutions, Commit (Append), Get (Imported), List, Records, File URL, Commit (Wrong Status 409)); `bruno/Platform Zip Markets/` (List, Upsert, Delete). Each with a `docs` block.

---

## PR3 — Web: campaigns list, run wizard, detail, ZIP table

### 3.1 Clients — `web/src/lib/platform-campaigns-api.ts`, `platform-zip-markets-api.ts`
One function per endpoint in 2.4/2.5; query keys `["platform","campaigns",…]`, `["platform","zip-markets",…]`; `isCampaignSettled(status)`; reuse `uploadToPresignedUrl` from `lib/presigned-upload.ts`.

### 3.2 Routes — `web/src/app/App.tsx` (inside the `/admin` block, L633+)
`/admin/campaigns` (`MailerCampaignsPage`, `MailersRead`), `/admin/campaigns/new` (`RunCampaignPage`, `MailersWrite`; `?source=processed` = "Import a processed file"; `?campaignId=` resumes at step 2), `/admin/campaigns/zip-markets` (`ZipMarketsPage`, `MailersWrite`), `/admin/campaigns/:campaignId` (`MailerCampaignDetailPage`, `MailersRead`) — static paths before `:campaignId`; every gate `redirectTo="/admin"`. `panel-areas.tsx`: the `campaigns` entry (L56-61) gets `to: "/admin/campaigns"`.

### 3.3 Pages — `web/src/features/platform/campaigns/`
- `MailerCampaignsPage.tsx` — header actions (Run campaign · Import processed file · ZIP → market table); filters in URL state via `useUrlState` (`usePlatformUsersUrlState.ts` pattern): agency `MultiSelect`, status `Select`, debounced `q`; rows as a `divide-y` list (`BugReportsPage.tsx` pattern) with name, visible agencies chips or "All", week/year, `CampaignStatusBadge`, requested by/at, record count, floor, quote date, leads attributed; `placeholderData: keepPreviousData`.
- `RunCampaignPage.tsx` — three steps on `useAppForm` (`hooks/form.ts`, `validators: { onBlur: schema }`) with `campaign-schemas.ts`. Step 1: `FileDropzone` (`.xlsx,.csv`) + `CampaignSettingsForm` (`withForm`; `FormSection`/`FormGrid`; `NumberField` floor, `TextField` fileName/defaultMarket/defaultPhone/runYear, market-phone rows, discount-rule editor prefilled from defaults, `AssignmentSection` with `SelectField` mode + agency `MultiSelect` when `agencies`, recipients list) → presign → PUT → create → poll `getCampaign` (`refetchInterval: 1500`, `refetchIntervalInBackground: true`, the docblock from the deleted page). Step 2 `CampaignPreviewReport`: column checklist, stats grid (port the deleted `ImportReport` layout), assignment table ("A0B9049 → Smith Family Agency, 20,024 rows"), unmatched codes as a destructive `Alert` with the actionable text, `UnmatchedZipsResolver` (zip → market; Save → `PATCH zipResolutions` → re-preview), existing-campaign panel with append/overwrite radio; overwrite opens an `AlertDialog` stating "This deletes exactly N mailers from <campaign> that are not in this file" and requires confirmation → Commit → poll to `imported|failed`. Step 3: import counts, rejections `Table`, download output, Email output. `?source=processed` hides floor/discounts/markets, keeps assignment + recipients.
- `MailerCampaignDetailPage.tsx` — header, file cards (download via `openDocumentInNewTab(() => getCampaignFileUrl(id, kind).then(r => r.url))`), settings snapshot, stats, assignment, import outcome + rejections, leads attributed, `CampaignRecordsTable` (search by control number or name, paginated shadcn `Table`, visibility chips), Email output, Resume run (when `previewed|failed`).
- `ZipMarketsPage.tsx` — table with search, inline add (zip5, market), delete, bulk-paste textarea (`zip,market` per line).
- `CampaignStatusBadge.tsx`, `campaign-format.ts`.
- Drawer `web/src/features/lead/components/MailerLookupDrawer.tsx:350-380`: copy "Already logged by another producer." → "Already logged." (no producer/agency hint); on a 409 from `logMailerLead` show a sonner error and refetch the lookup.

### 3.4 PR3 checks
`npm run lint -w @sfa/web`, `npm run build -w @sfa/web`; light + dark inside `.super-admin`; tablet width; no hard-coded colours.

---

## PR4 — Completion email with download link, docs, polish

- `api/src/worker/email/templates/mailer-campaign-output.template.ts` (key `mailerCampaignOutput`, registered in `templates/registry.ts`): data `{campaignName, campaignNumber, year, fileName, outputRows, recordCount, downloadUrl, downloadExpiresAt, detailUrl}` rendered with `layout/paragraph/button/muted`; text part included (the registry spec asserts it). **No attachment.**
- `mailer-campaign-output-email.fn.ts`: `step.run('load')` (campaign, output key) → per recipient `step.run('send:<i>')` → `MailDeliveryService.send('mailerCampaignOutput', data, `mailer-campaign:${campaignId}:${attempt}:${recipient}`, null)` then `record`. `downloadUrl = createPresignedDownload(outputKey, {expiresIn: 7d, disposition:'attachment', filename})`; `detailUrl = `${tenantUrl.platformBaseUrl()}/admin/campaigns/${id}``. `DeliveryContext.agencyId` / `EmailMessage.agencyId` become nullable (platform mail) — check `email-message.schema.ts` indexes tolerate null.
- Config: `MAILER_OUTPUT_LINK_TTL_SECONDS` (default 604800) in `config/env.config.ts` + `.env.example`.
- Bruno `Email Output.bru`; e2e `worker/mailer-campaign-output-email` (renders link, idempotent resend, no agency on the record).
- Docs: `docs/mailers-handoff.md` (campaign era, migration order, `mailerImportRuns` manual drop), `AGENTS.md` §2/§10 (Add Mailers gone; campaign key namespace), `packages/api/src/mailers/**` docblocks that still say "PAC-71 will…".

---

## Verification

```bash
npm run build -w @sfa/shared
npm run build -w @sfa/api            # lint is eslint-only; this catches types
npm run lint -w @sfa/api
npm run test -w @sfa/api -- mailer   # unit: processor, mapper, import, reader, assignment, implicit-campaign, zip seed
npm run test:e2e -w @sfa/api -- mailer-import mailer-lookup lead-intake-mailer-link mailer-campaigns mailer-zip-markets mailer-campaigns-backfill
npm run test:e2e -w @sfa/api -- test/worker/mailer-campaign
npm run lint -w @sfa/web && npm run build -w @sfa/web
npm run api:seed:dev                  # expect "zip markets: 564 upserted, 1 rejected (4031)"
npm run api:seed:demo:dev
npm run backfill:mailer-campaigns:dev -w @sfa/api -- --dry-run   # then for real; a second run reports all zeros
cd bruno && npx @usebruno/cli run --env Local
```
Rebuild `@sfa/shared` before e2e/Bruno; e2e shares one database (no parallel run, no live `api:dev`).

Manual end-to-end (local stack per the `running-the-stack` skill: API + worker + MinIO + Inngest dev server):
1. Seed core + demo; onboard a second agency with Allstate code `A0B9049`; give the demo agency a different code.
2. Save `api/test/fixtures/mailers/rtp-sample.csv` (197 rows) as `.xlsx` too.
3. `/admin/campaigns/new`: defaults prefilled; drop the xlsx; assignment by carrier code; Preview shows "A0B9049 → <agency 2>, 197 rows" and the unmatched ZIPs; resolve one inline → re-preview drops it; Commit (append) → `imported`, created 196 / skipped 1 (the synthetic control-number-less row), output downloads with the print-file headers, records searchable.
4. Agency 2 producer: drawer → control number → Log lead → lead has `mailer.matchedBy: 'drawer'`.
5. Demo agency producer: same number → not found. Run the campaign again with assignment `all` (preview flags the existing campaign; append) → demo drawer resolves, shows "Already logged" with no action; Bruno `POST /mailers/log-lead` from the demo agency → 409.
6. Demo agency: create a lead via the API with a typed control number of an unlogged mailer → `matchedBy: 'control_number'`; with nonsense → key only.
7. Third run with overwrite of the first → dialog states the exact count → first campaign `superseded`, count matches.
8. Set recipients → commit → email with a working download link; `emailMessages` row has `agencyId: null`.
9. A user with `platform:agencies:read` but no `platform:mailers:*` gets 403 on every new endpoint.

## Risks and things to watch
- **Migration window**: the `$type:'null'` visibility filter and the stop-API-first ordering are what prevent cross-agency exposure; both go in the PR1 description. Run `--dry-run` on a production snapshot first; `--merge-duplicates` is deterministic but destructive.
- **Mongoose array default `null`** on `visibleAgencyIds` must be confirmed (Mongoose defaults arrays to `[]`); the importer's `bulkWrite` writes literal `null` regardless.
- **exceljs `Date` → Excel serial** must match the CSV path byte for byte (Alteryx fidelity); the xlsx≡csv reader spec is the guard.
- **Step outputs stay small** (no rows, no key arrays) or Inngest memoization balloons.
- `inconsistentColumns` (several `quotedate`/`agencyid` values) renders as information, never as an error.
- Address-dedupe merge onto a lead that already links a different mailer leaves the new one unlinked (fill-if-empty); surfaced through `alreadyExisted` only.
- ZIP resolutions are written globally in this ticket; the per-agency column exists but no UI writes it.
