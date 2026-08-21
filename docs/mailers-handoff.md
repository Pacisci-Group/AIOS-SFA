# Mailers — session handoff (PAC-61)

> Continuation notes for **PAC-61 — Log a lead from a mailer by Quote Control Number**.
> <https://linear.app/paciscigroup/issue/PAC-61>
>
> **The Linear ticket is the spec.** Read it first — it holds the full requirements,
> schema, and acceptance criteria. This file holds what the ticket does not: how we
> got here, what was verified against real data, what is still unanswered, and the
> traps that cost time to find.
>
> Last updated 2026-08-21.
>
> **Status.** The write side is built — PAC-73 shipped the `mailers` collection,
> the shared import engine, the Super Admin RTP upload and the BigQuery backfill
> script. PAC-61 (the drawer) is still to come. The ticket splits and the
> measurements taken against the real RTP file live in **PAC-73**; this file is
> the BigQuery-side profiling and the decision history behind both.
>
> Two things below are now out of date and are left in place rather than edited,
> because the reasoning still matters: §5 open item 1 (Carl's raw spreadsheet)
> was overtaken by the real RTP file arriving, and §6's "not yet ticketed"
> super-admin upload is PAC-73.

---

## 1. The feature

A producer gets a **Mailers** button next to *Add New Lead* on the Leads page. It opens
a drawer, they type the Quote Control Number (QCN) printed on the mail piece, see the
recipient and what was quoted, and save it as a lead.

Legacy did this in three steps: a Mailers search page → a mailer detail page → a *Log
Lead* button. We collapse it to one drawer, and move mailer data off BigQuery into our
own `mailers` collection.

**This is a port plus an improvement**, per the owner. See "Improvements over legacy"
in the ticket.

### Where things live

| What | Where |
|---|---|
| Legacy lookup | `SFA/app/api/mailers/[controlNumber]/route.ts` → `SFA/lib/bigquery/mailers.ts` |
| Legacy save | `SFA/app/api/mailers/log-lead/route.ts` (→ `SFA/lib/intake/processNewLead.ts`) |
| Legacy UI | `SFA/components/mailers/MailersPageClient.tsx`, `MailerDetailClient.tsx` |
| Design reference | `packages/web/src/features/management-alt/ManagementDashboardAltPage.tsx:120` (`SidecarMailer`) |
| Where the button goes | `packages/web/src/features/lead/LeadsPage.tsx:93` |
| Intake pipeline to reuse | `packages/api/src/leads/intake/lead-intake.service.ts` |

The design reference is David's prototype from the `Insurance-Management-Dashboard-2`
mockup, already ported verbatim-as-mock into `management-alt`. Read the in-repo copy,
not the mockups repo. **Do not copy its markup** — `management-alt` is a throwaway
prototype dashboard with hard-coded palette values and no light-theme support.

---

## 2. Decisions made (do not re-litigate)

1. **Model the schema on the raw mailer spreadsheet, not on the BigQuery table.**
   BigQuery is a *transform* of the spreadsheet — Carl's pipeline adds and removes
   columns. The future super-admin upload receives the original sheet. BigQuery and the
   upload are both just importers into the collection.
2. **A mailer belongs to one agency; `agencyId` is required.** Going forward the
   uploader picks the agency in the super-admin UI. For the BigQuery backfill only,
   agency is derived from the three-letter ticker prefixing `FileName` (`SFA`, `LFI`).
   Unmapped tickers are skipped and reported, never guessed.
3. **The import script is re-runnable** — appends new records and updates existing ones
   (upsert on the control-number key). Not a one-shot migration.
4. **Do not extend `TenantRecord`.** Its `branchId` is `required: true`; mailers have no
   branch dimension. Follow `Carrier` / `Agency` instead.
5. **Every role gets `mailers:read` for now.** Proper access rules are a later pass.
6. **Lead source is always `WCO7l` (Mailer).** The legacy `startsWith('JYA')` branch is
   unreachable against this data and is not ported.
7. **This resolves architecture decision O2** in `docs/SYSTEM_ARCHITECTURE.md` (L751) as
   *import*. The arch doc still lists it as open — update it, don't re-decide it.

### Decisions that were reversed along the way

Worth knowing so an older note doesn't mislead:

- Mailers were briefly scoped as a **platform-global catalog** shared by all agencies.
  Reversed once David confirmed the `FileName` ticker identifies the agency.
- The import was briefly scoped as a **one-off backfill**. Reversed — it must be
  re-runnable.

---

## 3. What was verified against real data

Profiled directly in BigQuery against all **671,339 rows** of
`allstate123.smartsuite_data.Mailer_Test_Alteryx`. These are measurements, not guesses,
and several contradict how legacy behaved.

- **`controlno` and `New_Control_Number` are not alternates.** `controlno` is `#` + a
  UUID; `New_Control_Number` is that UUID's last 12 hex characters. They differ on
  671,339/671,339 rows. This is why legacy needed `ENDS_WITH`/`CONTAINS_SUBSTR`. Store
  both normalized forms so a producer typing either resolves the same mailer.
- **Money arrives as formatted strings with unit suffixes** — `"$1962.87/year*"`,
  `"$1,000.00/person"`, `"$100,000.00/occurrence"` — but `monthlypre` is a bare
  `"163.57"`. Inconsistent within the same group. `Number()` on any of them is `NaN`.
- **`quotedate` is an Excel serial number.** `"46216"` = 2026-07-13 under the 1899-12-30
  epoch (verified: it matches that row's `mail_drop_date` exactly).
- **Two premiums.** `totalpremi` ($3,096.65) comes from the file untouched; `yearlyprem`
  ($1,962.87) is recalculated by the pipeline and equals `monthlypre × 12`.
- **`is_duplicate` is `false` on every row** — it means *all columns identical*, and
  re-ingests always differ in ingest metadata. But 30,991 duplicate control numbers do
  exist; Carl confirms they are a testing artifact.
- **`Campaign_Number` is not a campaign id** — every value is `"Week_Number-NN"`, a
  restatement of `week_number`. 37 distinct values.
- **`county` is a FIPS code** (`"083"`), not a name. Legacy showed producers "County: 083".
- **`campaign_status` is real** — `Active` / `Closed` / `null`. Legacy's `status` was a
  hard-coded `'Pending'` literal invented in the API layer.
- **`agencyphon` has 3 values** partitioning the table exactly (918-417-7400 / 405-803-7590
  / 918-984-6163). These are **dynamic local-presence dial numbers**, not tenant identity.

### Useful profiling queries

```sql
-- shape of the control-number columns + duplicate counts
SELECT COUNT(*) AS rows_total,
       COUNT(DISTINCT LOWER(TRIM(New_Control_Number))) AS distinct_ncn,
       COUNTIF(is_duplicate) AS flagged_dupes,
       COUNTIF(LOWER(TRIM(New_Control_Number)) != LOWER(TRIM(controlno))) AS ncn_differs
FROM `allstate123.smartsuite_data.Mailer_Test_Alteryx`;

-- one full row as JSON (how the field formats were discovered)
SELECT TO_JSON_STRING(t) FROM `allstate123.smartsuite_data.Mailer_Test_Alteryx` AS t LIMIT 1;

-- the ticker set, before writing the FileName parser
SELECT DISTINCT REGEXP_EXTRACT(FileName, r'^([A-Za-z]+)') AS ticker, COUNT(*) AS n
FROM `allstate123.smartsuite_data.Mailer_Test_Alteryx` GROUP BY ticker ORDER BY n DESC;
```

---

## 4. Traps that will cost time if forgotten

- **`create-lead.dto.ts` cannot be reused** for the log-lead endpoint. Its `person`
  schema requires DOB, a 10-char phone and a valid email; a mailer has none of those, so
  it would 400 every real request. The service-layer `IntakePerson` already has all
  three optional — that is what makes this work. Give the endpoint its own
  `{ controlNumber }` DTO.
- **`partialFilterExpression`, never `sparse`** on the compound unique index. A compound
  sparse index only skips a document when *every* key is missing, so with `agencyId`
  always present, control-number-less rows index as `(agencyId, null)` and the second
  one dies on E11000. Written up on `LEGACY_DEDUPE_INDEX_OPTIONS`
  (`packages/api/src/common/schemas/tenant-record.schema.ts:34`).
- **Sub-documents must be `@Prop({ type: XSchema })`**, using the output of
  `SchemaFactory.createForClass`. Passing the bare class registers `Mixed` and silently
  drops typing and validation. Follow `NewBusinessApplication`
  (`packages/api/src/policies/schemas/policy.schema.ts:19`).
- **`createdAt`/`updatedAt` get no `@Prop`** — `timestamps: true` owns them; re-declaring
  adds a conflicting definition (`tenant-record.schema.ts:17`).
- **Do not port legacy's Clerk producer-resolution block** (~170 lines:
  `clerk_user_id` → email fallback → self-heal `PATCH`). It existed only because legacy
  had no first-class user identity. Here the authenticated user *is* the producer.
- **`npm run lint -w @sfa/api` is eslint-only** and will not catch type errors — use
  `npm run build -w @sfa/api`.
- **Rebuild `@sfa/shared` before e2e/Bruno/seeds** — they read `dist`, while typechecks
  read `src`. This ticket touches `IntakeChannel`.
- Legacy typed `yearlyprem` as `number` and called `.toLocaleString()` on what is
  actually a string. It silently no-ops rather than throwing, which is why premiums
  render unformatted today. Don't reproduce it.

---

## 5. Open items

| # | Question | Owner | Blocks |
|---|---|---|---|
| 1 | Raw spreadsheet + transform logic (promised by email) | Carl | Final field naming only |
| 2 | Which premium do producers quote — `totalpremi` or `yearlyprem`? | David | The drawer's premium label |
| 3 | Do any of the 4 dropped columns belong on screen? (`personalli` is a clean 40% of Coverage A) | David | Drawer content |
| 4 | Is the ticker always the `FileName` prefix? Validated or free text? Full list? | Carl | Correct agency attribution |
| 5 | GCP credentials for the API | — | Running the import |

**Only #1 gates starting**, and only for field naming. Tenancy, indexes, types, dedupe
and import strategy are all settled — the schema, API and drawer can be built now.

**#2 is the one with a real-world cost**: a producer reading the wrong figure misquotes
a live prospect. Circumstantial evidence favours `yearlyprem` — its raw value
`"$1962.87/year*"` is pre-formatted with a unit and a footnote asterisk, which is how a
printed marketing offer looks. Suggestive, not proof. Until David rules, label both
literally and present neither as "our quote".

### Context Carl gave that shaped the ticket

- The BigQuery table is not a direct import of the spreadsheet — columns added and removed.
- We own the schema shape: *"feel free to change whatever makes sense for the
  application, especially with column removal."* Nothing downstream depends on our names.
- `coveragest`, `dwellingpr`, `personalli`, `deductible` are unused passthrough columns.
- `Mailer_Test_Alteryx` is the only real object; `_Parallel` is a view created so users
  wouldn't touch the base table. Legacy pointed at it for that reason, not because it
  was canonical.
- Upload semantics: the user chooses **append or overwrite, scoped to one campaign** —
  more specific than the 2026-08-12 scrum minute's unconditional "overwrite". Matters
  for the upload ticket, not this one.

---

## 6. Related work

- **Super-admin mailer upload UI** (agency selector + CSV/Excel) — **not yet ticketed**,
  and assigned to Asad in the 2026-08-12 scrum. Near-term: it is how new mailers reach
  the app after this backfill, and it carries the agency selection that retires ticker
  parsing. Until it exists, mailers created after the backfill are unreachable in the
  drawer.
- **PAC-22** — cancelled stub for a standalone Mailer page. Out of scope here.
- **PAC-53** — lead source & assignment strategy; keep the Mailer source rule consistent
  with whatever it lands.
- Scrum notes, 2026-08-12 (Gemini):
  <https://docs.google.com/document/d/1OJsDM2wEq_JQ81YmLjPk59Hjj8LON9FTDPaZPs3WFHk/edit>
- Unrelated but flagged in the same scrum: a role is named **CRM** and should be **CSR**.
  Abu Bakar is fixing dev data; `packages/shared/src/permissions/default-role-templates.ts`
  still says `CRM`, so the code needs it too.
