# PAC-142 — Mailer campaigns: several files per upload, and "Add records" after commit

## Context

A campaign today holds exactly one `vendorFile`, and once it is `imported` nothing can
touch it (`EDITABLE_STATUSES`, `mailer-campaigns.service.ts:96`; the detail page offers
only "Email the output"). When David misses records or merges the vendor files badly, his
only path is a second campaign for the same week: append splits the week in two, and
overwrite regenerates the whole print CSV so the mail house re-prints rows already mailed.

**Simplest fix, agreed with Asad (2026-09-29):** no new "run" entity. A campaign gets a
**list of files** instead of one, and an imported campaign can be **re-opened** by adding
files. It then goes through the same preview → commit it always did, over *all* its files:
existing rows are updated in place, new rows are created, and the commit also writes a
second CSV containing **only the rows it created**, which is what the completion email
links after a re-commit. Settings stay locked after the first import (ZIP→market
resolutions excepted, since they only feed the platform table). Overwrite semantics,
statuses, events, the import engine and lead attribution are untouched.

Decisions: delta CSV for the mail house · settings locked after first import · append
only for a re-commit is *not* enforced (existing overwrite rules stay as they are) ·
same `platform:mailers:write` permission · one small migrate-mongo migration renames
`vendorFile` → `files[]` on existing documents.

Ticket: **PAC-142** (sub-issue of PAC-67, sibling of PAC-71). One PR.

Trade-off to state in the ticket: `importCounts` and `rejections` describe the **last**
commit only (created = rows that commit added). There is no per-commit history.

### Compatibility with PAC-84 (central `files` collection — Backlog)

PAC-84 will add one `files` row per uploaded object and have owner records keep a
`{ fileId, filename, contentType, size }` display copy, dual-writing on every presign and
verify path first. This change must not pre-empt it or add a second shape for it to fold
in. Rules for this plan:

1. **No new collection, no per-file listing UI.** Campaign files stay embedded subdocs on
   `mailerCampaigns` (`files[]`, `outputFile`, `newRowsFile`), all the *same*
   `MailerCampaignFileDoc` shape, so PAC-84 backfills them with one mapping.
2. **One seam.** Every place this change touches an object goes through two helpers in
   `mailer-campaigns.service.ts`: `verifyUploadedFiles(dtoFiles)` (ownership check +
   `HeadObject` + build the subdoc, used by `create` and `POST /:id/files`) and
   `discardFileObjects(files)` (best-effort delete, used by `DELETE /:id` and
   `DELETE /:id/files/:fileId`). PAC-84 phase 1 dual-writes inside those two functions
   and nowhere else. The worker's `putObject` calls for `outputFile`/`newRowsFile` stay
   where they are; PAC-84 attaches those as `purpose: mailer-campaign-output` rows later.
3. **The client names a file by `id`.** Today that is the subdoc `_id`; when PAC-84 lands
   it becomes the `files` row id (`fileId`) with no change to the web contract or the
   URL shape `GET /:id/files/:kind/url`.
4. **Keep the field names as they are** (`storageKey`, `name`, `size`, `contentType`);
   PAC-84's rename to `filename`/`fileId` is its own sweep across five collections, and
   doing half of it here would give it a sixth dialect.
5. **No new content-type or size rules in DTOs.** `campaignFileSchema` imports
   `ALLOWED_MAILER_CONTENT_TYPES` / `MAX_MAILER_FILE_BYTES` from `mailer-file-types.ts`,
   which is what PAC-84's purpose registry replaces.
6. At implementation start, leave a comment on PAC-84: its metadata table still lists
   `mailerImportRuns.storageKey` (dropped); campaign objects now live in
   `mailerCampaigns.files[]`, `outputFile`, `newRowsFile`, plus the two helpers above.

---

## 1. Schema + shared types

`packages/api/src/mailers/schemas/mailer-campaign.schema.ts`,
`packages/shared/src/domain/mailer-campaign.ts`

- `MailerCampaignFileDoc`: drop `_id: false` so each file has an id the client can name;
  DTO `MailerCampaignFile` gains `id` (still never `storageKey`).
- `vendorFile: FileDoc | null` → **`files: FileDoc[]`** (default `[]`).
- New `newRowsFile: FileDoc | null` — the delta print CSV written by a re-commit. Null on
  a first commit (the full `outputFile` *is* the new rows then).
- New `firstImportedAt: Date | null` — set once, at the first successful finalize. This is
  the "has this campaign ever imported" fact that locks settings, allows Add records,
  refuses delete, and tells `process` to write the delta. (`finishedAt` is set on failure
  too, so it cannot serve.)
- `MailerCampaignPreview.overlap` gains `existingInThisCampaign` (rows the file has that
  this campaign already owns → will be updated, not printed) and `newRows` (rows held by
  no campaign → what the delta will contain).
- `MailerCampaign` DTO: `files`, `newRowsFile`, `firstImportedAt`; `vendorFile` removed.
- Class note on `MailerCampaign`: the re-open rule (below) and the caveat that a re-opened
  campaign is `uploaded`/`previewed` for a few minutes while it still owns mailers, so it
  drops out of `existingCampaigns` for other same-week previews during that window.
- `implicit-campaign.ts` → `files: [], newRowsFile: null, firstImportedAt: null`
  (covers demo seed, BigQuery import, backfill). Update `implicit-campaign.unit-spec.ts`.

## 2. Migration — `packages/api/migrations/<ts>-campaign_files_array.js`

Scaffold with `npm run db:migrate:create -- campaign_files_array` **with `api:dev`
stopped**. `up`: for docs with `files: { $exists: false }`: `files = vendorFile ?
[{ _id: new ObjectId(), ...vendorFile }] : []`, `newRowsFile: null`, `firstImportedAt =
status ∈ imported|superseded ? (finishedAt ?? updatedAt) : null`, `$unset vendorFile`.
`down`: `vendorFile = files[0] ?? null`, `$unset files/newRowsFile/firstImportedAt`;
throw if any doc has `files.length > 1`. Raw `db` handle, idempotent by the filter.

## 3. Worker

### `mailer-campaign.support.ts`
- `readCampaignFiles(storage, files)`: `readCampaignFile` per file, then concatenate.
  Normalize headers with `normalizeHeader`; every file's header **set** must equal the
  first's, else throw `File "<name>" does not match "<first>": missing …, extra …`
  (fails the preview with the file named). Columns re-ordered by name onto the first
  file's order. Duplicate rows across files need no special handling: the vendor
  transform already dedupes (`mailer-processor.ts:400`) and a `processed` import is an
  idempotent upsert.

### Preview fn (`mailer-campaign-preview.fn.ts`)
- `readCampaignFiles(campaign.files)` instead of `vendorFile` (fail if `files` empty).
- `measureOverlap`: the per-campaign `$group` already runs; stop excluding
  `campaignId: this` and split the result into `existingInOtherCampaigns` (as today) and
  `existingInThisCampaign`; `newRows` = rows with a key that matched nothing.

### Commit fn (`mailer-campaign-commit.fn.ts`)
- `process`: `readCampaignFiles`. The processed+CSV shortcut (vendor object reused as
  output) applies only when `files.length === 1 && !firstImportedAt`; otherwise write the
  CSV as the vendor path does. **When `firstImportedAt` is set**: after the transform,
  look up which rows' `controlNumberKeys` already exist (chunked `$in` with
  `$type: 'string'`, as `measureOverlap` does), write the rows with no match to
  `…/output/<campaignId>/<attempt>/<fileName>-new-rows.csv` and store it as
  `newRowsFile`; otherwise `$set newRowsFile: null`. Sound on retry: the step is memoized
  and the commit function is global-concurrency-1, so nothing imports between the lookup
  and the import step.
- `import`: `uploadedFilename` = file names joined with `, `. Rest unchanged.
- `finalize`: additionally `updateOne({ _id, firstImportedAt: null }, { $set: { firstImportedAt: now } })`.
- Everything else (gate, delete-replaced, reconcile, email) unchanged.

### Output-email fn
`load`: link `newRowsFile ?? outputFile`; `outputRows = newRowsFile ? counts.created :
(stats?.outputRows ?? counts.read)`; `fileName` from the linked file. Template copy: when
the delta is linked, the subject/body say "new rows only" (one optional boolean on
`MailerCampaignOutputData`).

## 4. API

### DTOs (`dto/mailer-campaign.dto.ts`)
- `campaignFileSchema = { storageKey, uploadedFilename, size, contentType? }`;
  `createCampaignSchema.files: z.array(campaignFileSchema).min(1).max(20)` replaces the
  four flat fields.
- `addCampaignFilesSchema = { files }` (same array).

### Routes (`platform-mailer-campaigns.controller.ts`)
| route | rule |
|---|---|
| `POST /` | `files[]`; each key through `assertPlatformKeyOwnership` + `statObject` (exists, non-empty, size matches) as today |
| **`POST /:id/files`** (200) | status ∈ `uploaded\|previewed\|failed\|imported` and `source ∈ vendor\|processed` → push files, `preview: null`, `error: null`, `previewAttempt++`, status `uploaded`, dispatch preview. This is "Add records" and "add another file before committing" in one endpoint |
| **`DELETE /:id/files/:fileId`** | status editable **and** `commitAttempt === 0` (once imported, the file list is the record of what was imported); must leave ≥ 1; delete the object best-effort; re-preview |
| `PATCH /:id` | as today while `commitAttempt === 0`. Once `firstImportedAt` is set: only `settings` may be sent, and every field except `zipResolutions` must deep-equal the stored snapshot, else `409 "Settings are locked once a campaign has imported; only ZIP resolutions can be added."` The existing `zipMarkets.upsertMany` write-through stays |
| `GET /:id/files/:kind/url` | `kind` = `output` \| `new-rows` \| a file id |
| `DELETE /:id` | refuse when `commitAttempt > 0` (replaces the status check — also closes the hole where a failed-after-import campaign could be deleted leaving orphan mailers). Delete every file object best-effort |
| `POST /:id/preview`, `POST /:id/commit`, `POST /:id/email`, list, records, defaults, presign | unchanged |

`toDto`: `files` with `id`, `newRowsFile`, `firstImportedAt`. `defaultName` uses the
first file's name where it used `vendorFile`. `create` and `POST /:id/files` share
`verifyUploadedFiles`; `DELETE /:id` and `DELETE /:id/files/:fileId` share
`discardFileObjects` (the PAC-84 seam, see Context).

## 5. Web (`packages/web`)

- `lib/platform-campaigns-api.ts`: `createCampaign({ files: File[], … })` presigns and
  PUTs each file then posts `files[]`; new `addCampaignFiles(campaignId, files)`,
  `removeCampaignFile(campaignId, fileId)`; `getCampaignFileUrl(id, kind)` where kind is
  `'output' | 'new-rows' | fileId`. Export `canAddFiles(campaign)` (status rule above)
  and `canRemoveFiles(campaign)`.
- `components/upload/FileDropzone.tsx`: add a `multiple` mode (`files`/`onSelectFiles`)
  alongside the single-file props, sharing the type/size check. One component, no fork.
  Grep for other callers before touching prop shapes.
- `RunCampaignPage.tsx`:
  - Step 1: multi-file dropzone; hint "One or more XLSX/CSV files with the same columns".
  - Step 2 and step 3: a **Files** card listing the campaign's files (download each,
    remove while `canRemoveFiles`, "Add files" while `canAddFiles`). Adding files from
    step 3 is the Add-records flow: the campaign drops back to `uploaded`, the page
    polls into the preview, and the operator commits again.
  - `CampaignPreviewReport`: header lists the file names; when `firstImportedAt` is set
    show tiles "New rows (will be printed)" = `overlap.newRows` and "Already in this
    campaign (updated)" = `overlap.existingInThisCampaign`, and hide "Edit settings"
    (ZIP resolver stays).
  - Step 3: "Download new rows" button when `newRowsFile` exists, next to the full output.
- `MailerCampaignDetailPage.tsx`: `Files` renders every vendor file, the output, and
  "New rows (last commit)"; a **Add records** button when `canAddFiles` and status is
  `imported` → `/admin/campaigns/new?campaignId=<id>` (the existing resume path); the
  settings section notes "locked since first import".
- Tokens only, light + dark parity, `NOT_AVAILABLE` for missing values.

## 6. Bruno (`bruno/Platform Mailer Campaigns/`)
Update `Create Campaign` (body `files: [...]`; tests on `files[0].name`, no `storageKey`),
`Get Campaign (*)`, `Get Output File URL` (kind), docs blocks. Add `Add Campaign Files`,
`Remove Campaign File (Last File, 400)`, `Get Vendor File URL`, `Get New Rows URL`,
`Add Files (Superseded, 409)`. Verify with `cd bruno && npx @usebruno/cli run --env Local`.

## 7. Tests
- `test/mailer-campaigns.e2e-spec.ts`: create with two files; add files on `imported`
  resets to `uploaded` and bumps `previewAttempt`; add files refused on `processing` /
  `superseded` / `migration` source; remove file refused after commit and when it is the
  last; PATCH after first import allows only ZIP resolutions (409 otherwise); DELETE
  refused once committed; file URL by id and `new-rows`.
- `test/worker/mailer-campaign-preview.e2e-spec.ts`: two files concatenate; header
  mismatch fails naming the file; `existingInThisCampaign` / `newRows` reported.
- `test/worker/mailer-campaign-commit.e2e-spec.ts`: `stage` helper builds `files`;
  first commit → `newRowsFile: null`, `firstImportedAt` set; re-commit with 90 existing +
  10 new rows → `outputFile` has 100 rows, `newRowsFile` has 10, `importCounts.created`
  10 / `updated` 90; existing retry/overwrite/processed cases keep passing.
- `test/worker/mailer-campaign-output-email.e2e-spec.ts`: links the delta and reports
  `created` when `newRowsFile` exists.
- Migration: a small e2e that runs the file's `up` against an old-shape doc twice.

## 8. Docs
`AGENTS.md` §10 mailer paragraph: one sentence on Add records. Docblocks on
`MailerCampaign` (re-open rule, `firstImportedAt`), `updateCampaignSchema` ("a different
file is a different campaign" is no longer true — reword), and the stale
`mailerImportRuns` comment in `app.module.ts:206-208`.

## 9. Verification
1. `npm run build -w @sfa/shared`, `npm run build -w @sfa/api` (lint does not
   typecheck), `npm run lint -w @sfa/api` / `-w @sfa/web`.
2. Stop `api:dev`; run the e2e specs above one at a time (shared database).
3. Boot the API against the local prod dump only: `migrations_changelog` shows the new
   entry; an existing campaign's detail page shows its file, output, counts as before.
4. Bruno collection against the seeded local stack.
5. Browser at `localhost:5173`: create a campaign from two CSVs → preview shows combined
   rows → commit → Add records with a file mixing existing and new rows → preview shows
   the two tiles → commit → "Download new rows" has only the new rows, the full output
   has all, and the completion email links the new-rows file. Light and dark.

## Known, deliberately untouched
- Partial overwrite (ticking some but not all `existingCampaigns`) still 409s at commit.
- `sha256` is never populated on file records.
