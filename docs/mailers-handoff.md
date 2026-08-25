# Mailers — session handoff (PAC-61)

> Continuation notes for **PAC-61 — Log a lead from a mailer by Quote Control Number**.
> <https://linear.app/paciscigroup/issue/PAC-61>
>
> **The Linear ticket is the spec.** Read it first — it holds the full requirements,
> schema, and acceptance criteria. This file holds what the ticket does not: how we
> got here, what was verified against real data, what is still unanswered, and the
> traps that cost time to find.
>
> Last updated 2026-08-25.
>
> **Status. Both halves are built.** PAC-73 shipped the `mailers` collection,
> the shared import engine, the Super Admin RTP upload and the BigQuery backfill
> script; PAC-61 shipped the drawer, the QCN lookup and log-lead. The ticket
> splits and the measurements taken against the real RTP file live in
> **PAC-73**; this file is the BigQuery-side profiling and the decision history
> behind both. What PAC-61 settled on the way is in §7.
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

## 3b. Measured against the real RTP files (2026-08-24)

David supplied three final files — `SFA-RTP-2026-29.csv`, `-30` and `-32`. All
three are Smith Family Agency, `type: Home`, `product: FQ`, with **byte-identical
132-column headers**. Every earlier assumption held; a summary table and the
per-column detail live in `packages/api/test/fixtures/mailers/README.md`.

Week 29 imported end to end: **20,405 read, 20,405 mapped, 0 rejected, 20,405
documents**, each carrying both control-number forms, `quoteDate` 2026-07-13,
full campaign context, `county` as a zero-padded string, and no `NaN` in any
numeric field. It took ~200 seconds — which settles the sync-vs-async question
retrospectively: it would have blown any HTTP timeout.

Three findings that were not visible from week 29 alone:

1. **The filename's week and the campaign's week are different things.** The
   file named `-30` carries `Week_Number-29` and week 29's quote date. The
   filename number looks like the mail-drop week; `Campaign Number` is the quote
   week. The preview reports what the data says. Do not reconcile one to the
   other.
2. **Weeks 29 and 30 share 4,825 control numbers, and on those rows every
   business column is identical** — same premiums, coverage, campaign and quote
   date. They differ only in `FileName` (`SFA-20P` vs `SFA-QBP`) and per-piece
   mail-sorting columns. They are two **print runs of one campaign**. Upsert-
   collapse is therefore correct and loses nothing of value. It also kills any
   remaining idea that `Campaign Number` identifies a campaign: two different
   files claim the same one.
3. **`status` exists in the RTP file and is postal metadata, not a business
   status.** Populated on 100% of rows with values like `SNNNN4`, sitting among
   the `dpv_*` / `coa_*` address-standardisation columns. It stays in
   `source.raw`. **Open item 3 in PAC-61 is still open** — this column does not
   answer it, and must not be mistaken for an answer.

⚠ The files themselves are **not** in the repo and must not be: 20–25 MB each,
and full of real prospects' names and addresses. The committed fixture is a
197-row redacted slice.

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

---

## 7. What PAC-61 settled

Decisions taken while building the drawer, recorded here because none of them
are visible in the ticket and two contradict what it literally said.

### The premium: `yearlyprem` leads, `totalpremi` follows

Open item #2 in §5 was never answered by David, but legacy answers it in
practice: `SFA/lib/bigquery/mailers.ts` never even **selects** `totalpremi` —
its SELECT is fifteen columns and `yearlyprem` is the only premium — and
`MailerDetailClient.tsx` renders it alone as "Yearly Premium". Whatever the
theory, `yearlyprem` is the number producers have been quoting.

So the drawer leads with it (plus the monthly figure) and shows `totalpremi`
below, under an "Also on the mail file" label. Neither is called "our quote".
Answering the open question properly is a label change, not a redesign.

Legacy showed **no** coverage limits at all — dwelling, other structures, loss
of use and the liability limits are net-new on this screen.

### The campaign line: facts only

Open item #3, resolved as "show campaign + week only". Week number, product and
policy type, quote date. `campaign.campaignStatus` renders as a badge **only
when the document carries one**, which means never for an RTP-uploaded mailer,
because the column exists only in BigQuery. Nothing is substituted. Legacy's
`status` was a hard-coded `'Pending'` literal invented in the API layer.

### County: Oklahoma only, resolved server-side

`common/mailers/county-names.ts` maps state + FIPS to a county name for
Oklahoma's 77 counties and nothing else — every reference file and 100% of the
committed fixture is OK. Adding a state is one object literal. An unmapped pair
resolves to `null` and the drawer **omits the row** rather than rendering a
dash: a dash asserts we looked and found nothing.

The demo seed needed its own Oklahoma city list (`MAILER_CITIES`) for this to be
exercisable — the tenant's `CITIES` are eight Illinois towns, which no
Oklahoma-keyed table could ever resolve, and the seed was already stamping
`market: 'Tulsa'` and a 918 phone number onto them.

### Two things the ticket got wrong

1. **The idempotency key cannot be built from what the producer typed.** The
   ticket specified `` submissionToken = `MAIL|${QCN.toUpperCase()}` ``. The two
   printed forms are different strings, so the long form and the short form
   produce different tokens, the unique `{agencyId, submissionToken}` index sees
   no conflict, and **one mailer becomes two leads** — the exact failure the
   endpoint exists to prevent. The key is the mailer document's own
   `controlNumberKeys[0]` instead, which is identical whichever form was typed.
   `buildSubmissionToken` gained a `mailer` branch so every channel's namespace
   stays in the one function that owns the rule. Pinned by an e2e case and a
   Bruno request.

2. **`linkedLeadId` has to be scope-clamped.** `GET /leads/:id` 404s another
   producer's lead under `own` scope, so returning the id of a lead the caller
   cannot open would render a "View lead" button that goes to a not-found page.
   The lookup returns two fields: `alreadyLogged` (agency-wide — stopping a
   producer working a mailer a colleague already took is the whole point) and
   `linkedLeadId`, present only when the lead is inside the caller's scope.

### Canonical control number: the long form

`Lead.quoteControlNumber` stores `mailer.controlNumber`, taken from the document
and never from the request. The Leads list searches that field with a
contains-regex and the short form is the last 12 characters *inside* the long
one, so the long form is findable by either and the reverse is not true. And
dedupe signal 2 is an exact-equality **merge**: a collision on 48 bits of
truncated UUID would quietly join two different prospects' leads.

⚠ **Known gap, deliberately not fixed.** A lead whose control number a producer
typed by hand into the New Lead form is stored trimmed but not normalized, so it
will not match the lookup's `$in`. Closing it properly needs a stored
`Lead.quoteControlNumberKey` plus an index and a backfill.

### Permissions

`mailers:read` added to Branch Manager, CRM and Data Team; Producer and CSR
already held read+write and Agency Owner gets it from `grantsAllEnabledModules`.
**Existing agencies need `npm run api:sync:roles`** — editing a template does
not touch already-seeded roles, and signed-in users keep their cached set until
their next token refresh.

Who should *actually* hold the drawer is still the later access-model pass §2
decision 5 defers it to. The templates say so in a comment so it does not read
as considered intent.

### The dead `/mailers` nav link is gone

`nav-items.ts` pointed at `/mailers`, a route that has never existed in
`App.tsx`. It was invisible to most roles only because most roles lacked
`mailers:read` — which this ticket gave to everyone, promoting a hidden dead
link into a universally visible one. PAC-22 was cancelled and PAC-61 puts a
standalone page out of scope, so nothing was coming to fill it.
