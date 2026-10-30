# Dash Reconciliation — implementation plan and as-built notes

Ticket: https://linear.app/paciscigroup/issue/PAC-173 (sub-issue of PAC-152).

Paths are relative to the AIOS-SFA repo root; `api/` = `packages/api/src/`,
`web/` = `packages/web/src/`, `shared/` = `packages/shared/src/`.

> **Changed since this was written (v2, PRs 1–5 — 27–29 Oct 2026).** The notes
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
>     panel on the Producer Dashboard. The assignee records outcomes from
>     there (PR 4, below).
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
> - **The assignee records what became of a row (PR 4).**
>   - `outcome` is its own field on the row, beside `assignment`: kind
>     (`sold` / `cancel_rewrite` / `other`), status (`in_progress` / `done`),
>     step (`record_sale`, then `write_replacement` for a cancel rewrite), note,
>     and the ids it links (lead, deal, policy, household, replacement policy,
>     chargeback). Finishing one resolves the row with `sold_recorded`,
>     `cancel_rewrite_recorded` or `other_recorded`. Those three are kept out of
>     `RECONCILIATION_RESOLUTIONS`, so the owner's review refuses them.
>   - A Missing-from-app row can be Sold, a Cancel rewrite or Other. Every
>     other tab takes Other only, until 1-800 service intake (PR 5).
>   - **Only the assignee records** (owner, 28 Oct 2026):
>     `PATCH carrier-reconciliation/assigned/:rowId/outcome`. The owner's
>     drawer shows the outcome read-only and keeps assign, reassign and deciding
>     by hand. Credit goes to whoever books the sale, which is the assignee.
>   - **A Missing-from-app row goes only to someone who can book a sale**
>     (owner, 28 Oct 2026). Assigning one to a person without `leads:write` +
>     `deal_audits:write` is a 400 `RECONCILIATION_ASSIGNEE_CANNOT_SELL`. That is
>     judged on effective permissions, not the role, so a standard CSR (no Deal
>     Audits) is refused. `GET options` marks `canRecordSale`, and the picker
>     disables the rest. The outcome endpoint checks the caller's permission
>     again on every call.
>   - Other needs a note and is done at once.
>   - Sold starts at `record_sale`. The web goes `/leads/new?reconciliationRowId=`
>     → `/sold/new?leadId=&reconciliationRowId=`, both prefilled from the Dash
>     line (`GET assigned/:rowId` → `prefill`). The name is split from Dash's
>     `FIRST LAST` (`dash-customer-name.ts`). The product maps to a policy type
>     (`dash-product-map.ts`; an unknown product is `null`, so the form asks).
>     The carrier is the run's catalog name, and the sold and lead dates are the
>     date written. The quote gate is waived while the outcome is under way. The
>     NBA PDF stays required.
>   - `POST /leads` with `reconciliationRowId` skips the address dedupe, so the
>     assignee always gets a lead of their own. It stamps `outcome.leadId`,
>     which lets a half-done Sold resume on the same lead.
>   - `POST /sold-deals` with `reconciliationRowId` completes the outcome after
>     the commit, best-effort and on the replay path too, beside the audit and
>     CRM hand-off. It checks the agency, the module, the assignee, the run and
>     the row; it is idempotent on the deal; it never fails the sale.
>   - A cancel rewrite then moves to `write_replacement`. "Write the
>     replacement" runs the normal PAC-126 chain (`useStartReplacement` with the
>     row id threaded through). That sale stamps `replacementPolicyId` and the
>     `cancel_rewrite` chargeback, and the outcome is done.
>   - **Continue self-heals.** Resuming an outcome re-checks what it links, so a
>     sale whose hook failed after the commit is picked up rather than
>     stranded.
>   - The owner reopening a row clears its outcome; the deal it booked stays.
>     Deciding by hand, reassigning or unassigning while an outcome is under way
>     also clears it. Work transfer keeps an outcome under way, and its lead
>     moves with it, so the successor resumes. Release clears it. A re-upload
>     carries the outcome when the row still says the same thing. Booking the
>     Dash policy re-matches the row, so an unfinished cancel rewrite does not
>     carry across a re-upload of that period (a known edge).
>   - The owner's page has an Outcome column and filter (`outcome=` on the rows
>     endpoint), and run detail has `inProgress`. The export adds `outcome` and
>     `outcome_note`. The assigned page and the Dash follow-ups panel show
>     where each row stands.
> - **A 1-800 policy is set up for service, never sold (PR 5).**
>   - A Dash-only 1-800 row (1-800 review, `dash_only`) offers **Set up for
>     service** besides Other (`reconciliationOutcomeKinds` now takes the row's
>     match). A 1-800 policy the app already has — on a deal or not — keeps
>     Other only (owner, 29 Oct 2026).
>   - It needs `leads:write` (owner, 29 Oct 2026), which every default Producer
>     and CSR holds, by effective permission: `canSetUpReconciliationService`.
>     Assigning such a row to someone without it is a 400
>     `RECONCILIATION_ASSIGNEE_CANNOT_SERVICE`; `GET options` marks
>     `canSetUpService`. Only the assignee runs it; the owner reads it.
>   - Its page, `/reconciliation/assigned/:rowId/service-intake`, captures the
>     client as the New Lead form captures a household — the same cards and
>     the same contact and household resolution (`HouseholdIntakeModule`), DOB,
>     phone and email required on the primary — but makes **no lead**. "Existing
>     client?" adds the policy to a household instead. Then the policy, filled
>     in from Dash, with its signed application (required, PDF, presigned under
>     the row: `reconciliation-rows/<rowId>/nba`), and the hand-off: a CSR from
>     the ticket picker's pool and an opening note written from the Dash line.
>   - `POST carrier-reconciliation/assigned/:rowId/service-intake`
>     (`ServicedPolicyIntakeService`) writes the household, members and a
>     policy with **`origin: 'carrier_direct'` and no deal**, and makes the CSR
>     the household's Assigned CRM when it has none — in one transaction with
>     the row's outcome, at step `start_onboarding`. The welcome call
>     (`ServiceTicketsService.startOnboarding`, "sold by" `Allstate 1-800
>     (<Bind ID>)`) opens right after and finishes the outcome with its
>     onboarding and ticket ids; the row is resolved
>     `service_intake_recorded`, which the owner's review cannot pick
>     (`service_set_up` stays their hand pick). If the welcome call cannot open,
>     the row waits at `start_onboarding` and Continue opens it. A number
>     already on a sale in the app is a 409; CRM service off is a 409.
>   - Nothing is credited: performance and the leaderboard read deals. The
>     household page and the policy page label the policy "Allstate direct
>     (1-800)"; the row drawer links the household, the policy and the welcome
>     call.
>   - The engine expects a `carrier_direct` policy in Dash by its effective
>     date (a UTC calendar day — there is no sold date), names it by its
>     household's primary contact, and leaves it out of the per-producer table.
>     Any later report that lists it matches it clean (tab Matched, context
>     issue `direct_1800`); one that leaves it out lists it under Not in Dash.
>     A re-upload of the **same period** carries the finished outcome, its
>     decision and its assignee to the new row — only while that row asks
>     nothing (a premium difference reopens it) — and first opens any welcome
>     call still pending on the run it replaces. A `carrier_direct` policy
>     later put on a deal is a 1-800 policy recorded as a sale again
>     (`direct_recorded_as_sale`). Re-check does not re-match (it only
>     re-derives stored rows), so only a new upload moves a row out of 1-800
>     review.
>   - The policy number must be the Dash line's. An owner deciding,
>     reassigning or taking back a row whose welcome call is still pending
>     opens the call first; work release keeps such an outcome (with nobody on
>     the row) for that, or for a same-period re-upload, to finish. One that
>     still cannot open at a re-upload travels to the new row, which then
>     waits on a decision. A late call re-checks its CSR (unassigned if they
>     are no longer an active CSR or CRM), and a timed claim on the row
>     (`outcome.handOffAt`, 2 minutes) lets only one caller open it. While
>     someone holds that claim, the owner's decide, reassign or take-back is a
>     409 rather than a clear. A household the caller cannot see is refused
>     with `RECONCILIATION_HOUSEHOLD_NOT_VISIBLE`, whether it was pinned,
>     offered by the "which household?" chooser (which lists only in-scope
>     ones), or found as the person's only household.
>   - A carried pending intake whose call then opens decides its row only if
>     the row asks nothing else. On a row whose premium now differs, the
>     intake finishes but the Premium question stays open for the owner, and
>     the row leaves the assignee's list (`openAssignmentsFilter` skips a
>     finished outcome). Once the intake is no longer pending, `needsReview`
>     goes back to what the row's own tabs say (`asksForDecision`).
>   - Setting a reopened row up again makes a second `carrier_direct` copy
>     (the plan accepts that twin). The next upload matches the newer one, so
>     the outcome that links it carries, and the twin shows as
>     `duplicate_in_app`.
>   - The demo seed adds one `carrier_direct` policy (`900800001`) with its
>     onboarding and open welcome call for Casey Kim (`ONBD-117`).
> - Still to come (v2 plan): Chargeback (PR 6, after PAC-170 / #153).

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
