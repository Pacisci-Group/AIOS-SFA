# Dash Reconciliation — implementation plan and as-built notes

Ticket: https://linear.app/paciscigroup/issue/PAC-173 (sub-issue of PAC-152).

Paths are relative to the AIOS-SFA repo root; `api/` = `packages/api/src/`,
`web/` = `packages/web/src/`, `shared/` = `packages/shared/src/`.

> **Changed since this was written (v2, PRs 1–3 — 27–28 Oct 2026).** The notes
> below describe v1. Where they disagree with this box, this box wins; the full
> as-built rewrite follows the last v2 PR.
>
> - **There is no `producerCodes` registry.** The collection, its routes, the
>   "Producer codes" tab, register-from-review and the seed migration are gone.
>   A person's codes are two fields on the **user** — `allstateBindId` and
>   `allstateSubProducerCode` — entered at invite / accept-invite / agency
>   onboarding, edited on the profile page or by the owner
>   (`PATCH /users/:userId/details`), unique per agency (migration
>   `20261027120000-user_allstate_code_indexes`), normalised by
>   `shared/domain/allstate-codes.ts`. The engine reads them with
>   `loadStaffCodes` (deactivated users included).
> - **Bind ID statuses are `staff` / `former_staff` / `not_staff` / `blank`.**
>   A Bind ID on no user that Dash prints a **Bind ID Name** for is a former
>   employee's — never 1-800 — and gets its own `bind:<Bind ID>` line in the
>   per-producer summary. Only an **unnamed** Bind ID on no user can be 1-800
>   (David, 27 Oct). A blank Bind ID is agency business.
> - Migration `20261027140000-sfa_user_allstate_bind_ids` writes Smith Family
>   Agency's 10 producers' Bind IDs onto their users, cross-referenced from the
>   Jul–Sep export by name (Mike Iles = JAMES ILES).
> - **Matched rows are checked against the app (PR 2).** The app is the source
>   of truth. A matched policy whose app premium is not Dash's written premium
>   **to the cent** lands in a new **Premium differs** tab
>   (`premium_mismatch`). Any difference flags (David, 27 Oct), and `1234.5`
>   equals `1234.50`. The comparison is shared `reconciliationPremiumDelta`
>   (app − Dash, in whole cents), used by the engine, the export and the
>   page. A different producer stays `producer_mismatch`. A different item
>   count is context only (`item_count_mismatch`, no tab).
> - **Tabs**, in order: Missing from app, Not in Dash, 1-800 review, Premium
>   differs, Producer mismatch, Matched, Not new business. Premium differs
>   asks for a decision and is in the exception export. `totals` gain
>   `premiumMismatch` and `premiumMismatchDelta` (`Σ |Dash − app|`). The
>   export gains `premium_delta`. The page's Premium tab shows an
>   "App − Dash" column and the total gap.
> - **A 1-800 policy recorded as a sale.** A matched policy on a deal whose
>   Bind ID is unnamed and on no user carries `direct_recorded_as_sale` in
>   the 1-800 tab (it was there already; this says why). A named Bind ID
>   (`former_staff`) never raises it. Un-selling has no flow yet, so these
>   are resolved by hand.
> - **Resolutions.** Premium differs offers "Premium corrected in the app",
>   "Dash's figure is wrong — the app is right" and Other. 1-800 review
>   offers "Set up for service", "Not this agency's business" and Other.
>   `confirmed_1800` is **retired**: the review DTO refuses it, a row decided
>   with it still reads and exports with its label, and a re-upload reopens
>   that row instead of carrying the decision forward.
> - A run reconciled before PR 2 reads `0` for both premium totals and has no
>   Premium rows until it is **Re-checked**.
> - On the Jul–Sep 2026 export against the local Smith Family Agency data,
>   232 of 252 matched policies differ (20 exact, 228 with the app higher,
>   median app/Dash 1.014), $9,340.69 apart in all. The 1-800 tab is still
>   the same 7 rows, and the September subset still reproduces
>   108 / 96 / 12 / 6 and $19,231.51.
> - **Rows are assigned to Producers and CSRs (PR 3).**
>   - The owner hands a row still waiting on a decision to an active user
>     holding the `producer` or `csr` role, with an optional note:
>     `PATCH runs/:id/rows/:rowId/assignment`. `GET options` now returns that
>     pool, through `permissions/role-holders.ts`, which the ticket picker
>     shares.
>   - The assignment is its own field on the row (`assignment`, string ids),
>     so saving a decision never drops it. A decided row keeps its assignee
>     but leaves their list.
>   - A re-upload carries the assignment to a row that still says the same
>     thing (`carriedAssignment`), without notifying again.
>   - The assignee gets an in-app and push notification,
>     `reconciliation.row_assigned` ("Dash policy assigned to you",
>     `<policy> · <customer> · <tab>`). It opens
>     `/reconciliation/assigned?row=<id>`. No email.
>   - The assignee's side is a separate controller,
>     `carrier-reconciliation/assigned`, gated on `leads:read` or
>     `carrier_reconciliation:read`, because no Producer or CSR holds the
>     report's permission. A Producer or CSR reads only rows assigned to them;
>     someone holding `carrier_reconciliation:read` may read anyone's. An old
>     notification link opens the row's current copy, if a re-upload has
>     replaced its run.
>   - The web has a page, `/reconciliation/assigned`, and a "Dash follow-ups"
>     panel on the Producer Dashboard. Both are read-only until outcomes land.
>   - On the owner's page, rows can be filtered by assignee, the table has an
>     Assigned column, and the drawer has the assign form. The export gains
>     `assigned_to`, and run detail gains `assigned`.
>   - Work transfer moves, and removal releases, a person's open rows on
>     current runs. The shared definition is
>     `common/carrier-reconciliation/assignment-scope.ts`.
> - **The sub-producer code is not read (owner, 28 Oct 2026).** A Dash line
>   belongs to the user whose Bind ID bound it, under the name the app knows
>   them by. Credit through the sub-producer code listed people twice
>   ("JESSICA YATES (034)" for the code, "Jessica Yates" for the app's own
>   policies) whenever the code was not on their user — and Smith Family
>   Agency's users carry Bind IDs only. Producer mismatch now means "bound in
>   Dash by someone other than the deal's producer"; `unmapped_producer` is no
>   longer raised. On the Jul–Sep export the sub-producer named the binder on
>   374 of 382 sales, and 40 matched policies are bound by someone other than
>   the app's producer (39 bound by Sabrina Webb, recorded under David
>   Howard). `allstateSubProducerCode` stays on users, unused here. A run
>   classified earlier regroups on **Re-check**.
> - Still to come (v2 plan): the Sold / Cancel-rewrite / Other outcomes the
>   assignee records (PR 4), 1-800 service intake (PR 5), and Chargeback
>   (PR 6).

## What it is

Every month the agency owner downloads Allstate's **Dash** report "Sold — New
Business Details (All)" — every policy the carrier says the agency wrote — and
uploads it on `/reconciliation`. A **run** reconciles the file against the
policies on the agency's sales and puts every line in one or more tabs:

| Tab | Means |
|---|---|
| Missing from app | A new policy in Dash, bound by the agency, with no app policy of that number |
| Not in Dash | An app policy sold in the period that Dash does not list |
| 1-800 review | Bound by an Allstate login that is not one of the agency's producers: business Allstate sold and assigned to the agency |
| Producer mismatch | In both, but Dash credits someone else |
| Matched | In both |
| Not new business | Add-item endorsements, Motor Club, repeated lines |

It replaces the data team's Excel "Policy Scrubber" (its `Process` tab is the
behaviour spec). Run against the Jul–Sep 2026 export and the workbook's own
September app export, the engine reproduces the workbook's Summary exactly:
108 policies, 96 matched, 12 missing, 6 not in Dash, $19,231.51 missing premium.

Decisions settled with the user (26 Oct 2026): a 1-800 row is **confirmed,
registered to a producer, or dismissed** — nothing is created in the app; the
known producer codes are **seeded by migration** for `smith-family-agency` and
editable on the page; **no emails** and no producer-facing pieces.

## The Dash file

- Metadata rows above the header (`Download Date`, `Downloaded By`,
  `Agent` = `0B9049 - SMITH, BRIAN`, `Start Date`, `End Date`, two pivot rows).
  The header is the first row naming `Policy No` and `Bind ID`; the sheet is
  found by that header, never by position (people add scratch sheets).
- 25 columns, two named `Channel` (first wins); stray spaces in `Month ` /
  `Product Description ` (matched through `normalizeHeader`).
- One date column holds Excel serials and `MM/DD/YYYY` strings; `parseDashDate`
  reads UTC components — never `new Date('09/15/2026')`.
- `Sub Producer` may arrive as the number `34` → `034`; **`000` is Allstate's
  "no sub-producer"** (it appears beside several people's Bind IDs) and reads as
  blank.
- New-policy lines: transaction `New Issued Transaction - First Term` or
  `Sales Issued`, disposition `New Policy Issued`, not Motor Club.

## Rules (as built)

- **Matching** is by policy number on both sides through
  `reconciliationPolicyKey`: `policyNumberKey` after dropping a 1–2 digit term
  suffix (`2037692470-00` → `2037692470`). App policies are matched agency-wide
  (keys computed in memory over the agency's numbered policies), so a
  back-dated or late-entered sale is still found. Any Dash line — even an
  endorsement — proves the carrier has the policy.
- **Not in Dash** candidates: policies on deals sold inside the report period
  (agency calendar, `businessDay`), carrier Allstate / National General or
  blank. **Company transfers count** — they issue a new policy number that
  Dash lists; the data team's workbook counts them too.
- **1-800**: the **Bind ID decides**. A login not registered as staff
  (`unregistered`, or registered `external`) makes a new policy 1-800; on any
  other line it does only when the channel is also `1-800` / `allstate.com`.
  A producer's own login is never 1-800, whatever the channel. Registering a
  login as `external` keeps its lines in the tab without asking for review.
- **Credit**: the sub-producer code, else (no sub-producer) the Bind ID. An
  unregistered sub-producer code does not fall back to the binder — it shows by
  the name Dash prints (`ASHLEE YOCUM (007)`).
- Repeated new-policy lines for one number: the earliest issued is kept, the
  rest become "Not new business" (`duplicate_line`).
- Suggestions for an unmatched row: a number one or two edits away, or the same
  surname plus a close premium or date.

## Shape

- **Module** `carrier_reconciliation` (16th key, catalog sort 150/151), label
  "Dash Reconciliation". No default role template carries it: the owner holds
  it through enabled modules and grants it from the role matrix. On by default
  for newly onboarded agencies. Visibility is **agency-wide; data scope is not
  applied** (a carrier report has no branch).
- **Engine** `api/common/carrier-reconciliation/` (pure, unit-tested, worker
  importable): `dash-file-reader.ts`, `classify-row.ts`,
  `producer-code-index.ts`, `reconcile.ts` (`matchRows` → `deriveRow` →
  `summarize`), `carry-forward.ts`, `load-inputs.ts` (Mongo loaders behind a
  models bag). Matching and classification are separate stages so registering
  a code re-classifies stored rows without re-reading the file.
- **Collections** (agency-wide, string `agencyId`, the `DataExport` pattern):
  `producerCodes` (unique among active codes), `reconciliationRuns`
  (`fileSha256` unique — the same bytes reconcile once), `reconciliationRows`
  (`tabs[]`, `producerKey`, `needsReview`, `review{}`; Dash/app snapshots with
  calendar-string dates).
- **API** `api/carrier-reconciliation/` — `POST runs/presign`, `POST runs`
  (synchronous; refused uploads are deleted from storage), `GET runs`,
  `GET runs/:id`, `GET runs/:id/rows`, `PATCH runs/:id/rows/:rowId/review`,
  `POST runs/:id/reclassify`, `GET runs/:id/export` (streamed CSV/XLSX),
  `GET|POST|PATCH producer-codes` (`POST` takes an optional `runId` to
  re-classify in the same request), `GET producer-codes/suggestions`,
  `GET options`. Bruno: `bruno/Dash Reconciliation/` with a synthetic fixture
  (`bruno/fixtures/dash-new-business-demo.xlsx`, demo-seed policy numbers, no
  agent number on purpose).
- **Uploading the same period again supersedes** the earlier run and carries a
  decision to a row only if its key, match and issues are unchanged.
- **Web** `web/features/reconciliation/` at `/reconciliation` (nav: Data):
  run picker, KPI row, per-producer table (click filters the rows), six tabs,
  search, download menu, row drawer (Dash vs app, suggestions, register the
  login or sub-producer code, decision form), Producer codes tab with
  "seen in the latest upload, not registered".
- **Migrations**: `20261026120000-carrier_reconciliation_module` (catalog rows +
  entitlement) and `20261026120100-seed_sfa_producer_codes` (10 producers'
  Bind IDs and sub-producer codes, matched by name; no-op elsewhere). The demo
  seed registers codes for its five producers.

## Open

- Staff in the export without an app account (Brian Carter, Ashlie Anderson /
  Ashlee Yocum, Jacob Landrum, Ashley Lewis, Marco Perez; sub-producer only:
  Kennedy Welborn, Dylan Selvidge) — the user will decide. A code can be
  registered as agency staff with no user from the Producer codes tab.
- `SOK35W0D` (the report's "Downloaded By") is presumed to be the owner's
  login and is not seeded.
- Uploaded files are kept; there is no retention job yet.
