# PAC-176 Payouts — payment structures, monthly pay statements, chargeback report

## Context

The agency pays producers and CSRs a percentage of the premium they sell, minus
carrier chargebacks, plus three bonuses (hat trick, individual monthly tier, an
agency-wide team pool). Today that is computed outside the app (ApexReports /
spreadsheets; the legacy SmartSuite "Commission Ledger" was never documented) and
the backlog epic **PAC-123 (payroll)** was deferred — the chargeback ledger's
docblock in `packages/shared/src/domain/chargeback.ts` says "do not widen this into
a general commission model before PAC-123". This feature *is* that model.

Outcome: an owner defines **payment structures** and assigns employees; on the 1st
of each month a job drafts a **pay statement** per employee for the previous month;
the owner uploads the carrier **chargeback report**, reviews, and **sends**; the
employee **accepts** (PDF e-signed and stored) or **rejects with notes**, which goes
back to the branch manager to adjust and re-send. Anyone with scope sees each
person's policies sold and charged back for the month; the employee sees their own.

## Decisions taken with the user (4 Nov 2026)

| Question | Decision |
|---|---|
| Branch base | **Stack on PAC-173 #162** (`origin/awaris/pac-173-dash-reconciliation-chargeback-outcome`, which already contains #153 and #157–#161). PR base = that branch; retarget to `dev` once the chain merges. Reason: `User.allstateBindId` (the "SOK number"), the xlsx upload-run pattern, `policies/chargeback-ledger.ts` and cancel-with-chargeback live there, not on `dev`. |
| Team bonus pool | A **fixed dollar amount**, changeable; the CSR/producer split percentages (20/80) changeable too. |
| CSR premium share | CSRs are licensed and sell. A person's premium = sold deals where `Deal.producerId` is that person, whatever their role. The CSR-vs-producer pool split is by role slug. |
| Release flow | **Draft on the 1st, send after review.** No auto-send. |

The PDF layout was provided (Desktop `screenshot1.png` / `screenshot2.png`, read 4 Nov):
a **Commission Statement** — see §7. It introduces a few concepts beyond the brief
(Salesperson of the Month, compliance status/adjustment, SPIFFs, bundle rate), handled
in A12–A14. Still pending: **a sample chargeback report** (the parser's header aliases
are designed to be adjusted).

## Linear (created 4 Nov 2026)

| Ticket | Scope | PR |
|---|---|---|
| **PAC-176** | [Epic] Payouts — related to PAC-123 (HR & pay) and PAC-173 | — |
| PAC-177 | Payment structures (incl. §12 lead-source rates), Settings → Payouts, module + permissions | PR 1 |
| PAC-178 | Engine, 1st-of-month drafts, Payouts page, My Pay (blocked by 177) | PR 2 |
| PAC-179 | Sold / charged-back activity per person (blocked by 178) | PR 2 |
| PAC-180 | Carrier chargeback report import (blocked by 178 + PAC-173) | PR 3 |
| PAC-181 | Commission Statement PDF + send (blocked by 178) | PR 4a |
| PAC-182 | Accept / dispute / adjust / re-send (blocked by 181) | PR 4b |

The epic carries the two layout screenshots and the "to confirm" list.

## Assumptions (state them in the PR; each is cheap to flip)

- **A1 Hat trick** = one bonus (default $50) per agency-local day (by `Deal.soldDate`
  in `Agency.timezone`) with **≥3 sold deals** (deals, not policies; one per day).
- **A2 Rates** per structure: `{ carrier: <display name> | '*' (any other), ratePercent }[]`.
  Premium bucketed per carrier from the deal's policy lines; chargebacks deducted
  inside the same bucket; a bucket may go negative (no clamp; no floor at zero).
  **Amended 4 Nov (§12):** a structure may also hold **lead-source rate overrides**
  (e.g. "JYA leads 5%") which replace the carrier rate for sales from that source.
- **A3 Individual tiers** `{ thresholdPremium, bonusAmount }[]`: highest reached pays.
  Thresholds (team + individual) use **gross** sold premium (the dashboards' figure);
  the rate applies to **net** (gross − chargebacks).
  **Amended 10 Nov (owner):** literally so — commission is the rate on net premium,
  once per line, and there is no separate "chargeback commission impact" (see "Owner
  changes" under the PAC-181 as-built).
  **Amended 5 Nov (§13):** `tiersStackable` on the structure — ticked, every tier
  reached pays and the bonuses add up.
- **A4** Team-bonus settings (threshold, pool, split %) are agency-wide on
  `Agency.payouts`; hat trick, tiers, rates and `teamBonusEligible` live on the structure.
  **Amended 5 Nov (§13):** the team bonus is a list of **levels** (threshold → pool)
  plus `stackable`; the split stays one pair of percentages.
- **A5** One active structure per person (enrolling elsewhere moves them, like the HR
  policies in PR #163). People on no structure get no statement.
- **A6** Sold matching = `NEW_BUSINESS_MATCH` + `isTestRecord: {$ne: true}` + `soldDate`
  in the month window. Cancelled policies' lines still count as gross (the
  cancellation is a chargeback row). `Deal.chargebackAdjustment` is **not** applied —
  the ledger row already carries it; applying both double-counts.
- **A7 "Digitally sign"** = e-signature audit trail, not a certificate: on accept the
  PDF is re-rendered with a signature block (name, accepted-at in agency tz, IP, user
  agent, SHA-256 of the issued PDF) and stored as a second object.
- **A8 Renderer = pdfkit 0.20.2** (`doc.table()` confirmed via Context7; pure JS, no
  Chromium, no JSX in the API webpack build). Renders synchronously in the API on
  Send and Accept; only the monthly draft job runs in the Inngest worker.
- **A9** Import rows → `chargebacks` rows `source: 'carrier_statement'` (reserved by
  the docblock), `reason: 'carrier_statement'`. Amounts are **premium dollars**
  (the user: "deduct that chargeback amount from the premium"), taken as `Math.abs`.
  App rows (`cancel_rewrite`, `cancellation`) count in the month of `occurredAt`.
- **A10** Manager revisions are statement **adjustments**; each re-send bumps
  `version` and keeps prior PDFs in `history[]`. An **accepted** statement is final —
  a late correction becomes a manual adjustment on the next month's statement.
- **A11** Admin (structures, settings, import, generate) is the **owner's** by
  default; the branch manager gets `payouts:read/write` (review, adjust, send within
  their branch). The owner can grant the admin key to the Branch Manager role from
  Roles & Permissions.
- **A12 Salesperson of the Month (SOM)** — the PDF shows "SOM Status" and a "Salesperson
  of the Month Bonus". Modelled as an agency setting `{ enabled, bonusAmount }`; the
  winner is the statement recipient with the highest gross premium in the month (ties:
  every tied person wins). Off by default.
- **A13 Compliance** — "Compliance Status" is derived from the month's deal audits
  (`DealAudit.auditStatus` by `dealId`): `compliant` when none failed, else "N failed".
  "Compliance Adjustment" is a manager-entered adjustment (kind `compliance`, ≤ 0).
- **A14 Carrier rows** — the "Carrier Production" table lists every carrier the agency
  is appointed with (`Agency.carrierAppointments[]`, names via the carriers catalog),
  zero rows included, then any other carrier with production or chargebacks. "Producer
  ID" = the user's Allstate Bind ID (fallback: none). "Allstate Tier" = the individual
  bonus tier reached (open question 7).
- Not in scope: per-branch team pools, carrying a negative statement forward,
  cryptographic PDF signing, email attachments (links only).

## 0. Branch setup

```
git fetch origin
git checkout -b awaris/pac-177-payment-structures-per-carrier-commission-rates-hat-trick origin/awaris/pac-173-dash-reconciliation-chargeback-outcome
```
One branch per PR, each stacked on the previous one (branch names are Linear's
`gitBranchName` for each sub-story). Note: `git fetch` over SSH failed earlier in this
session ("access rights"); `gh` over HTTPS works.

## 1. Module & permissions

| Item | Value |
|---|---|
| Module key | `ModuleKey.Payouts = 'payouts'` appended in `packages/shared/src/enums/module-key.enum.ts` |
| Page pair | `payouts:read` — see own statements, accept/reject own, own activity. `payouts:write` — review drafts in scope, send/re-send, reopen, adjustments, recalc one, others' activity in scope. |
| Admin key | `AgencyPermission.PayoutsAdmin = 'agency:payouts:admin'` in `packages/shared/src/permissions/permission.constants.ts` (+ catalog row in `permission-catalog.definitions.ts`) — structures CRUD, payout settings, chargeback import, generate/recalculate a run. |
| Role templates (`default-role-templates.ts`) | owner: unchanged (all `AgencyPermission` + all enabled modules). `branch_manager`: `payouts:read`, `payouts:write`. `producer`, `csr`, `crm`, `data_team`: `payouts:read`. |
| Also | `PAGES[]` in `permission-catalog.ts`; levels map in `permission-model.spec.ts`; `ONBOARDING_DEFAULT_MODULES` in `shared/src/domain/agency-onboarding.ts`; `'payouts'` in `FEATURE_DIRS` of `packages/api/eslint.config.mjs`; `PayoutsModule` in `app.module.ts`. |
| Migration | `packages/api/migrations/20261104120000-payouts_module.js`, modelled on the HR one in PR #163 (`20261022120000-hr_module.js`) + `20261007085957-analytics_module.js`: (a) upsert `permissions` rows `payouts:read` (sortOrder 170) / `payouts:write` (171) / `agency:payouts:admin` (`kind:'agency'`, `resource:'agency:payouts'`, `group:'Agency administration'`, `assignableToUser:false`); (b) `agencies.modules.payouts = {enabled:true, enabledAt}` where missing; (c) upsert `rolePermissions` per slug (BM: read+write; producer/csr/crm/data_team: read; owner: admin). Idempotent; constants copied, not imported. Check the sortOrder against whatever the branch's carrier_reconciliation migration used and go one pair higher. |
| Web nav (`components/layout/nav-items.ts`) | Sales → `My Pay` (`/my-pay`, `module: Payouts`); Management → `Payouts` (`/payouts`, `anyOf: ['payouts:write','agency:payouts:admin']`). |
| Settings hub (`features/settings/settings-sections.ts`) | `{ to:'/settings/payouts', label:'Payouts', permission: AgencyPermission.PayoutsAdmin }` (this also gates the sidebar/route automatically). Onboard catalogue entry in `features/platform/onboard/module-catalog.ts`. |

## 2. Data model

**`packages/shared/src/domain/payouts.ts`** (export from `index.ts`): statuses
`PAY_STATEMENT_STATUSES = ['draft','sent','accepted','rejected']`,
`PAYOUT_RUN_STATUSES = ['generating','ready','failed']`,
`CHARGEBACK_IMPORT_STATUSES = ['preview','committed','discarded']`,
`IMPORT_ROW_RESOLUTIONS = ['matched','assigned','unmatched','skipped','duplicate']`,
`STATEMENT_ADJUSTMENT_KINDS = ['exclude_chargeback','add_chargeback','spiff','compliance','manual']`,
`PAYOUT_MONTH_PATTERN`, `ANY_CARRIER = '*'`, limits (`MAX_PAYOUT_IMPORT_FILE_BYTES` 10 MiB,
`MAX_PAYOUT_IMPORT_ROWS` 5 000, `MAX_STATEMENT_NOTE_LENGTH` 2000), defaults
(`DEFAULT_HAT_TRICK {enabled:true, dealsPerDay:3, bonusAmount:50}`,
`DEFAULT_TEAM_BONUS {enabled:false, thresholdPremium:300000, poolAmount:0, csrSharePercent:20, producerSharePercent:80}`),
error codes (`PAYOUT_IMPORT_DUPLICATE_FILE`, `PAYOUT_STATEMENT_NOT_EDITABLE`),
view/input types, and pure validators `rateRulesError`, `bonusTiersError`, `teamSplitError`.

**`packages/shared/src/domain/payout-math.ts`** — the pure engine (§3).

| Collection / file | Fields (indexes) |
|---|---|
| `paymentStructures` — `packages/api/src/payouts/schemas/payment-structure.schema.ts` (agency-level, not `TenantRecord`) | `agencyId`, `name`, `status: active\|archived`, `rules: RateRule[]`, `hatTrick`, `individualTiers`, `teamBonusEligible`, `memberIds: ObjectId[]`, `archivedAt/By`, authorship, timestamps. `{agencyId, status, name}`, `{agencyId, memberIds}` |
| `Agency.payouts` sub-doc — `platform/schemas/agency.schema.ts` | `teamBonus: { enabled, thresholdPremium, poolAmount, csrSharePercent, producerSharePercent }`, `salespersonOfMonth: { enabled, bonusAmount }` (mirrors `availabilitySweep`; null-guard on `.lean()`). Served by `/payouts/settings`, not `/agency/profile`. |
| `payoutRuns` — `payout-run.schema.ts` | `agencyId`, `month 'YYYY-MM'`, `status`, `trigger: cron\|manual`, `timeZone`, `window {from,to}`, `settingsSnapshot`, `agencyTotals { grossPremium, teamBonus { met, csrPool, producerPool, csrPremium, producerPremium } }`, `counts`, `warnings[]`, `startedAt/finishedAt/lastRecalcAt`, `generatedBy`, `error`. **unique `{agencyId, month}`** = the claim marker |
| `payStatements` — `pay-statement.schema.ts` | `agencyId`, `branchId` (user's branch at generation; the scope key), `runId`, `month`, `userId`, `userName`, `roleSlugs[]`, `pool: csr\|producer`, `structureId`, `structureSnapshot`, `status`, `version`, `premiumLines[] {carrier, appointed, grossPremium, chargebacks, netPremium, ratePercent, rateSource, grossCommission, chargebackImpact, netCommission}`, `deals[] {dealId, soldDate, soldDay, clientName, policyTypes, carriers, premium, isBundle}`, `chargebacks[] {chargebackId, policyId, policyNumber, policyType, carrier, customerName, amount, commissionDeduction, occurredAt, reason, source, excluded, excludedNote}`, `bonuses { hatTrick {enabled, dealsPerDay, bonusAmount, days[], amount}, individual {tier, amount}, team {eligible, met, poolAmount, poolPremium, amount}, salespersonOfMonth {status, amount} }`, `indicators { tier, bundleRate, hatTricks, somStatus, complianceStatus, failedAudits }`, `adjustments[] {_id, kind, chargebackId?, amount?, note, createdBy, createdAt}`, `totals { grossPremium, chargebackTotal, netPremium, grossCommission, chargebackImpact, tierBonus, teamBonus, somBonus, hatTrickBonus, spiffs, complianceAdjustment, otherAdjustments, netCommission }`, `warnings[]`, `pdf {key, sha256, size, renderedAt}\|null`, `signedPdf {…, signedAt}\|null`, `sentAt/By`, `acceptance {acceptedAt, acceptedName, ip, userAgent}\|null`, `rejection {rejectedAt, notes}\|null`, `history[] {version, outcome: rejected\|reopened\|superseded, pdf, signedPdf, rejection, totals, at}`, `computedAt`. unique `{agencyId, runId, userId}`; `{agencyId, userId, month:-1}`; `{agencyId, month, status}`; `{agencyId, branchId, month}` |
| `chargebackImports` — `chargeback-import.schema.ts` | `agencyId`, `carrier`, `month`, `file {storageKey, filename, size}`, `fileSha256` (unique partial `{agencyId, fileSha256}`), `status`, `rows[] {rowNumber, bindId, policyNumber, amount, occurredAt, customerName, product, match {userId, userName, policyId, dealId, householdId, carrier}, resolution, existingChargebackId, chargebackId, assignedBy}`, `totals`, `warnings[]`, `committedAt/By`. `{agencyId, month, createdAt:-1}` |
| `chargebacks` changes — `chargebacks/schemas/chargeback.schema.ts`, `shared/domain/chargeback.ts` | `CHARGEBACK_REASONS += 'carrier_statement', 'manual'`; `CHARGEBACK_SOURCES += 'carrier_statement'`; `policyId` becomes optional (`default: null`, keep index); new `carrier?`, `statementMonth?` (`YYYY-MM`), `importId?`, `statementId?`. New index `{agencyId, statementMonth, producerId}`. The `cancel_rewrite` partial unique index is untouched. Update the docblock (PAC-123 has landed). |

Writers: `packages/api/src/common/payouts/chargeback-writers.ts` —
`writeImportedChargeback` / `writeManualChargeback` (siblings of
`policies/chargeback-ledger.ts` `writeChargeback`; no deal `$inc`, `soldAdjustment: 0`,
`withinClawbackWindow: false`, `producerName` via `chargedProducerName`).

## 3. Calculation engine

Pure math in shared; loaders/orchestration in `packages/api/src/common/payouts/`
(worker-importable; `common/dates/business-dates.ts` already imports
`performance/performance.range`, so the precedent for date helpers exists).

> ⚠ **Amended by §12 "Engine".** Premium is bucketed by `(carrier, lead source)`, not
> by carrier alone, and each bucket's rate comes from `rateFor(...)` in
> `@sfa/shared` (built in PAC-177), not the carrier-only lookup described in the
> per-carrier bullet below.

- `common/payouts/month-window.ts`: `monthWindow(month, tz) = { $gte: businessDateInstant(`${month}-01`, tz), $lt: businessDateInstant(<next month>-01, tz) }`; `previousMonthIn(tz, now)` from `localClock(now, tz).date` (`common/dates/time-zones.ts`).
- `common/payouts/load-run-inputs.ts` `loadRunInputs(models, { agencyId, month, tz, memberIds })`. Base match: `{ agencyId, producerId: {$in: memberIds}, ...NEW_BUSINESS_MATCH, isTestRecord: {$ne: true}, soldDate: monthWindow }`.
  1. Gross per person per carrier: `[...linesPrefix(match, SOLD_LINES, {}, false, { carrier: true }), {$unwind:'$lines'}, {$group: {_id: {producerId, carrier:'$lines.carrier'}, gross: {$sum:'$lines.premium'}}}]` (`common/sales-metrics/sales-pipelines.ts`); carrier normalised in Node with `normalizeCarrier` (`B4tEH` → Allstate); `null` → `'(no carrier)'`.
  2. Agency gross (team threshold): same prefix without the `producerId` clause — every producer in the agency, on a structure or not.
  3. Deals list (statement + hat trick): `dealModel.find(match).select(...)`; `soldDay = businessDay(soldDate, tz)`.
  4. Chargebacks: `{ agencyId, producerId: {$in}, $or: [{statementMonth: month}, {statementMonth: null, occurredAt: monthWindow}] }`; carrier = `row.carrier ?? policy.carrier ?? '(no carrier)'`.
  5. Roles: `common/payouts/member-roles.ts` reads `roles` + `userRoles` directly (not `activeRoleHolders`, which drops inactive users — a departed employee's last statement must still generate). `pool = slugs.includes('csr') ? 'csr' : 'producer'`.
  6. Deal audits for the month's deals: `dealAuditModel.find({ agencyId, dealId: {$in} }).select('dealId auditStatus')` (compliance indicator).
  7. Appointed carriers: `Agency.carrierAppointments[].carrierId` → names from the `carriers` catalog (A14). Users: `firstName lastName branchId allstateBindId`.
- `shared/domain/payout-math.ts` with `c2 = n => Math.round(n*100)/100`:
  - per carrier: `rate_c` = exact carrier rule → `'*'` rule → 0 (+ warning, `rateSource: 'none'`); `grossCommission_c = c2(gross_c × rate_c/100)`; each chargeback line stores `commissionDeduction = c2(amount × rate_c/100)` and `chargebackImpact_c = Σ` of the non-excluded ones; `netCommission_c = grossCommission_c − chargebackImpact_c` (the PDF's Net Commission column; linear, so it equals applying the rate to net premium, which is what the user described).
  - hat trick: days with `count ≥ dealsPerDay` × `bonusAmount` (if enabled).
  - individual: `tierBonusFor(tiers, tiersStackable, gross)` (§13) — the highest tier with `threshold ≤ gross`, or the sum of every such tier when stacking.
  - team: `computeTeamContext(settings, agencyGross, eligibleMembers)` → pool = `teamPoolFor(settings, agencyGross)` (§13: every level reached added up when stackable, else the highest; 0 when off); `met = enabled && the first level is reached`; split pools `c2(pool × pct/100)`; `allocatePool(pool, members)` = **largest-remainder allocation in cents** so shares sum exactly to the pool; a member with gross 0 gets 0.
  - Salesperson of the Month (A12): when enabled, the recipient(s) with the highest gross premium get `bonusAmount`; `indicators.somStatus = 'winner' | 'none'`.
  - Indicators: `tier` = the highest individual tier reached (or none), stacking or not; `bundleRate = c2(bundles / deals × 100)` where **a bundle is a sale with 2+ policies** (§13 — `PAYOUT_BUNDLE_MIN_POLICIES`, *not* `Deal.isBundle`); `hatTricks` = qualifying days; `complianceStatus` per A13; per-carrier bundle flags per §13.
  - `netCommission = c2(grossCommission − chargebackImpact + tierBonus + teamBonus + somBonus + hatTrickBonus + spiffs + complianceAdjustment + otherAdjustments)` — adjustment kinds `spiff` (≥ 0), `compliance` (≤ 0), `manual` (±) each summed into their own total so the summary grid reads line by line.
- `common/payouts/generate-run.ts` `generateRun(models, { agencyId, month, trigger, actorId })`: load agency + active structures → members → inputs → team context → `computeStatement` per member → upsert on `{agencyId, runId, userId}`, overwriting **only `draft`/`rejected`** statements (adjustments on a rejected one are inputs and survive); `sent`/`accepted` untouched (push a run warning if their stored team share now differs); delete drafts for people no longer on a structure; refresh `counts`/`agencyTotals`; `status:'ready'`. `recomputeStatement(models, statementId)` re-runs one statement against the run's stored team context.

## 4. Monthly job

`packages/api/src/worker/functions/generate-pay-statements.fn.ts`
(`GeneratePayStatementsFn`, pattern of `set-users-away.fn.ts`): `cron('0 * * * *')`,
`concurrency {limit:1}`, `retries: 0`; `forEachAgency` → skip when `modules.payouts`
disabled or no active structure has members; `month = previousMonthIn(tz, now)`;
**claim** = `payoutRunModel.updateOne({agencyId, month}, {$setOnInsert: {status:'generating', trigger:'cron', startedAt, timeZone, window}}, {upsert:true})`
→ own it only when `upsertedCount === 1`; a `failed` run or a `generating` one older
than 30 min is re-claimed with a conditional update; body = `generateRun(...)`; on
success emit `payouts.run_ready`. `worker.module.ts` gains `forFeature` entries for
`PaymentStructure`, `PayoutRun`, `PayStatement`, `AgencyRole`, `UserRole` and the fn.
"Generate / Recalculate" from the UI (`POST /payouts/runs`, admin) calls the same
`generateRun` inline in the API; any month ≤ the current one (current = "partial").

## 5. Chargeback import

Endpoints (admin unless noted): `POST /payouts/imports/presign {filename .xlsx, size}`
(`buildObjectKey({agencyId, purpose:'payout-chargebacks', filename})` +
`createPresignedUpload`) → `POST /payouts/imports {storageKey, uploadedFilename, size, carrier, month}`
(`assertKeyOwnership` → `statObject` → read → sha256 → 409 `PAYOUT_IMPORT_DUPLICATE_FILE`
→ parse → match → save `preview`) → `GET /payouts/imports?month` / `:id` (write) →
`PATCH /payouts/imports/:id/rows/:rowNumber {userId | skip | reset}` →
`POST /payouts/imports/:id/commit` (400 while any row is `unmatched`; writes one
ledger row per matched/assigned row; then recalculates the month's **draft/rejected**
statements and returns `{ written, recalculated, untouched: [statement ids that are sent/accepted] }`
— no month lock; the owner reopens a sent statement if it must change) →
`DELETE /payouts/imports/:id` (preview → `discarded`, frees the hash).

Parser `common/payouts/chargeback-file-reader.ts` `parseChargebackWorkbook(bytes)`:
SheetJS as in `common/carrier-reconciliation/dash-file-reader.ts` (header row found by
scanning each sheet; `normalizeHeader`, `cellToPrimitive`, `parseMoney`,
`excelSerialToDate` from `common/mailers/*`). Columns (header aliases, normalised):

| Field | Required | Aliases |
|---|---|---|
| bindId | yes | `sok`, `sok number`, `sok #`, `sok id`, `bind id`, `bind`, `agent id`, `producer code` |
| policyNumber | yes | `policy number`, `policy #`, `policy no`, `policy` |
| amount | yes | `chargeback`, `chargeback amount`, `chargeback amt`, `amount`, `charge back` |
| occurredAt | no | `date`, `transaction date`, `cancel date`, `cancellation date`, `effective date` |
| customerName | no | `customer`, `customer name`, `insured`, `name` |
| product | no | `product`, `line`, `line of business`, `lob`, `policy type` |

Adjust the alias table once the sample file arrives. Rows: skip empty / zero
amounts; `amount = Math.abs(parseMoney)`; `bindId = normalizeBindId`; `ChargebackFileError`
(→ 400) for a missing required column, no data rows, or > 5 000 rows.

Matching `common/payouts/match-import-rows.ts`: users by `allstateBindId` (active and
inactive); policy by `policyNumberKey` within the agency, preferring the import's
carrier; `match.carrier = normalizeCarrier(policy.carrier) ?? import.carrier`; Bind ID
unknown but policy matched → the policy's deal producer (resolution `matched`, with a
warning); neither → `unmatched`; an existing ledger row for the same policy in the
same month → `duplicate` (skipped unless the admin un-skips).

## 6. Statement lifecycle & endpoints

Controller `@Controller('payouts') @RequireModule(ModuleKey.Payouts)`; scope via
`buildScopeFilter(access, branchId, { producerField: 'userId' })` on `payStatements`
(own → self; branch → `branchId`; agency → all). Admin routes `@RequirePermissions(AgencyPermission.PayoutsAdmin)`;
write routes `@RequireWrite(ModuleKey.Payouts)`; the rest `payouts:read`.

| Route | Guard | Notes |
|---|---|---|
| `GET/PATCH /payouts/settings` | admin | team bonus; `teamSplitError` |
| `GET/POST /payouts/structures`, `GET/PATCH /:id`, `POST /:id/archive` | admin | create/update in a session: write, then `$pull` the members from other active structures (A5); archive clears members |
| `GET /payouts/options/users` | admin | agency users + their current structure (for the People step's "will be moved from X") |
| `GET /payouts/runs?month` | write | run + counts, `null` when none |
| `POST /payouts/runs {month}` | admin | generate or recalculate |
| `GET /payouts/statements?month&status&branchId&q&page` | read | scope-filtered summaries (own scope = only self → reused by My Pay; **own scope never sees `draft`** — an employee sees a statement once it is sent) |
| `GET /payouts/statements/:id` | read | scope-filtered detail |
| `POST …/:id/recalculate` | write | editable only (`draft`/`rejected`) |
| `POST …/:id/send` | write | from `draft`/`rejected`; render PDF → `putObject` → `pdf`; re-send pushes a `history` entry and bumps `version`; `status:'sent'`; emit `payouts.statement_sent` |
| `POST /payouts/runs/:id/send-all` | write | every `draft` in scope → `{sent, skipped}` |
| `POST …/:id/reopen` | write | `sent` → `draft` (history `reopened`) |
| `POST …/:id/adjustments`, `DELETE …/:id/adjustments/:adjId` | write | editable only. `exclude_chargeback {chargebackId, note}` / `add_chargeback {policyId?, policyNumber, amount, carrier?, note}` (writes a ledger row `reason:'manual'`, `statementId`; deleting the adjustment deletes that row — the only ledger deletion, and only on an unissued statement) / `spiff {amount ≥ 0, note}` (Other Bonuses / SPIFFs) / `compliance {amount ≤ 0, note}` (Compliance Adjustment) / `manual {amount, note}` (Other Adjustments) → `recomputeStatement` |
| `POST …/:id/accept {typedName, acknowledged: true}` | read, `statement.userId === access.userId` | from `sent`; the PDF's acknowledgment block (typed name = signature, date signed, SHA-256 of the issued file) is filled and the PDF re-rendered → `signedPdf`; `acceptance {acceptedAt, typedName, ip: req.ip, userAgent}`; emit `payouts.statement_accepted` |
| `POST …/:id/reject {notes}` | read, owner of the statement | from `sent`; "Comments / Dispute notes" required (≤ 2000); emit `payouts.statement_rejected` |
| `GET …/:id/pdf?variant=issued\|signed` | read (scope) | `{url}` presigned inline, minted per read, never stored |
| `GET …/:id/pdf-preview` | write | streams a fresh render of a draft (not stored) |
| `GET /payouts/activity?userId&month` | read (scope; own scope forces self) | `{deals[], chargebacks[], totals}` for one person — the "all policies sold / charged back for a producer or CSR" view |

State machine: `draft → sent` · `sent → accepted` (terminal) · `sent → rejected` ·
`rejected → sent` (version+1) · `sent → draft` (reopen). Only `draft`/`rejected` are
editable; anything else → 409 `PAYOUT_STATEMENT_NOT_EDITABLE`; accept/reject by anyone
but the statement's user → 403.

Notifications (`packages/shared/src/notifications/catalog.ts` + `render.ts`; new
category `'payouts'`; one `notificationRequested` event per statement because `data`
is shared across recipients):

| Type | Recipients | href | dedupeKey | channels |
|---|---|---|---|---|
| `payouts.statement_sent` | the employee | `/payouts/statements/<id>` | `pay-statement:<id>:sent:v<version>` | email + push |
| `payouts.statement_rejected` | branch managers of the employee's branch (`activeRoleHolders(models, agencyId, ['branch_manager'], { branchId })`), else agency owners; minus actor | `/payouts/statements/<id>` | `…:rejected:v<version>` | email + push |
| `payouts.statement_accepted` | `sentBy` + the same manager set, minus actor | same | `…:accepted:v<version>` | push |
| `payouts.run_ready` | owners + branch managers | `/payouts?month=<month>` | `payout-run:<runId>:ready` | email + push |

## 7. PDF

**Layout (from the screenshots) — "COMMISSION STATEMENT"**, LETTER portrait, navy
header band, light-grey field boxes, zebra tables with navy header rows:

1. **Header band**: agency logo (`Agency.branding.logoKey` → bytes via
   `storage.getObjectStream`; pdfkit takes PNG/JPEG — SVG or no logo → agency name
   only), title "COMMISSION STATEMENT", subtitle "Producer compensation detail and
   acknowledgment", right: agency name + "CONFIDENTIAL".
2. **Statement details** (5 boxes): Producer Name · Commission Period ("October 2026")
   · Producer ID (Allstate Bind ID) · Statement ID (short id + `v<n>`) · Generated Date.
3. **Performance indicators** (5 boxes): Allstate Tier · Bundle Rate · Hat Tricks ·
   SOM Status · Compliance Status (from `indicators`). Bundle Rate = sales with 2+
   policies ÷ sales (§13). A carrier below its minimum bundle rate is flagged on its
   Carrier production row and in a warnings line (§13).
4. **Carrier production** table: Carrier · Sold Premium · Chargebacks · Net Commission;
   one row per appointed carrier (A14) + any other carrier with activity; TOTAL row.
5. **Commission summary** two-column grid: left Gross Carrier Commission · Tier Bonus ·
   Team Bonus · Salesperson of the Month Bonus · Hat Trick Bonus; right Other Bonuses /
   SPIFFs · Compliance Adjustment · Chargeback Commission Impact · Other Adjustments;
   bottom-right **NET COMMISSION** (navy box).
6. **Chargeback detail** table: Customer · Policy Number · Carrier · Policy Type ·
   Commission Deduction; excluded rows struck through with the note; "Additional items
   continue on a generated detail page" — `doc.table()` paginates automatically;
   TOTAL CHARGEBACK IMPACT box.
7. **Producer acknowledgment**: checkbox "I acknowledge receipt and review of this
   commission statement." · Typed Name / Signature · Date Signed · Comments / Dispute
   Notes. Issued copy: empty boxes. **Signed copy**: ticked box, typed name, date
   signed (agency tz), and a small audit line (IP · user agent · SHA-256 of the issued
   file). A rejected-then-reissued version prints the previous dispute notes in the
   Comments box.
8. **Footer**: "<Agency> | Commission Statement" left, "Page x of y" right
   (`bufferPages: true` + `bufferedPageRange()`).

Code: `packages/api/src/common/payouts/pdf/` — `statement-pdf-model.ts` (the only file
that knows the Mongoose shape → plain, pre-formatted strings), `theme.ts` (navy
`#1f2a5a`-style palette, greys, Helvetica/Helvetica-Bold — AFM metrics ship inside
pdfkit, no font files on `node:22-alpine`; margins; column widths), one file per
section under `sections/`, `render-statement-pdf.ts` `renderStatementPdf(model, { acknowledgment? }): Promise<Buffer>`,
`hash.ts`. Deals are **not** printed (the PDF has no deal table); they stay in the
in-app Activity view.

Dependencies: `pdfkit@^0.20.2` (runtime), `@types/pdfkit` (dev). Keys via
`buildObjectKey({ agencyId, purpose: 'pay-statements', filename: 'commission-statement-<month>-v<n>.pdf', parts: [statementId], unique: false })`
and `…-v<n>-signed.pdf`; `application/pdf`; `putObject(key, buffer, type)`.

## 8. Web

Routes in `packages/web/src/app/App.tsx` (lazy + `<RequirePermission>`), feature folder `features/payouts/`:

| Route | Gate | Page / components |
|---|---|---|
| `/settings/payouts` | `agency:payouts:admin` | `settings/PayoutSettingsPage.tsx` (`SettingsPage` shell): `TeamBonusCard` + `SalespersonOfMonthCard` forms, structures table, archive |
| `/settings/payouts/structures/new`, `/:id` | admin | `settings/StructureWizardPage.tsx` — steps **Rules** (name; `RateRulesEditor` array rows: carrier `ComboboxField` from the carriers API + "Any other carrier", `PercentField`; hat-trick toggle/count/amount; team-eligible) → **Tiers** (`TierEditor` array) → **People** (`UserMultiSelect`, rows say "on *X* — will be moved"). Built from `components/common/StepProgress.tsx` + `WizardFooter.tsx`; array rows follow `features/settings/components/CarrierAppointmentsEditor.tsx` (`mode="array"`, `withFieldGroup`) |
| `/payouts` | `anyOf payouts:write, admin` | `PayoutsPage.tsx`: `MonthPicker` (URL state via `hooks/useUrlState.ts`), `RunHeader` (status, agency gross vs threshold, pools, warnings), **Generate / Recalculate**, **Upload chargebacks** (`ImportChargebacksDialog`: carrier, month, `FileDropzone` → presign → `uploadToPresignedUrl` → create), **Send all drafts**; `StatementsTable` (`DataPanel` + `TablePagination`; columns name, role, gross, chargebacks, net, commission, bonuses, payout, status, version) with instant status/branch/search filters |
| `/payouts/imports/:id` | write | `ImportPreviewPage.tsx` — tiles, rows table with resolution badges, assign picker for unmatched rows, Commit (`AlertDialog`) / Discard |
| `/payouts/statements/:id` | `payouts:read` (scope enforced by the API) | `StatementDetailPage.tsx`, **one page for both audiences**: PDF `<iframe>` over the presigned inline URL (sent/accepted) or "Preview PDF" (draft, blob via `apiFetchBlob`); summary card; premium-by-carrier, deals, chargebacks (exclude/restore with note), bonuses; `AdjustmentsPanel` (`AddChargebackDialog`, `ManualLineDialog`); rejection notes; version history with PDF links. Manager actions (Send / Re-send / Reopen / Recalculate) when `canWrite`; employee actions **Accept** (`AcknowledgeDialog`: the PDF's checkbox wording + typed name as signature) / **Dispute** (`Textarea` "Comments / dispute notes", required) when the statement is mine and `sent`. The in-app breakdown mirrors the PDF sections (indicators, carrier production, summary grid, chargeback detail). *Activity* tab = `GET /payouts/activity` |
| `/my-pay` | `payouts:read` | `MyPayPage.tsx` — own statements by month → links to the detail page |

Shared: `lib/payouts-api.ts` (key roots `payoutsKey`, `payoutSettingsKey`,
`payoutStructuresKey`, `payoutRunKey(month)`, `payStatementsKey(filters)`,
`payStatementKey(id)`, `payoutImportKey(id)`, `payoutActivityKey(userId, month)`; one
function per endpoint; `uploadChargebackReport(file, {carrier, month})`); new form
fields `components/form/fields/MoneyField.tsx` and `PercentField.tsx` (wrappers over
`NumberField`, registered in `hooks/form.ts`); `components/common/UserMultiSelect.tsx`
(over `MultiSelect`); `components/common/MonthPicker.tsx` (agency tz from
`getStoredUser().timeZone`); `lib/money.ts` (`formatMoney`, `formatPercent`) — used by
payouts only, no refactor of the per-feature copies; `features/payouts/payout-format.ts`
(status badges, month label). Light + dark via tokens; `NOT_AVAILABLE` for missing values.

## 9. Tests & verification

| Layer | File | Covers |
|---|---|---|
| shared | `domain/payout-math.spec.ts`, `domain/payouts.spec.ts` | carrier bucketing + `'*'` fallback + no-rate warning; negative net; per-line rounding; hat-trick day grouping (a 23:30 Chicago sale lands on the local day); tier none/exact/highest; team 20/80 with largest-remainder cents summing to the pool; zero pool premium; ineligible; threshold not met; adjustments; totals; validators |
| API unit | `common/payouts/chargeback-file-reader.unit-spec.ts` (exceljs-built fixture) | aliases, SOK normalisation, `($123.45)`/`-123.45` → 123.45, serial dates, missing column → error, header not on row 1, row cap |
| API unit | `common/payouts/pdf/render-statement-pdf.unit-spec.ts`; `payouts/dto/*.unit-spec.ts` | `%PDF-` header, non-empty, signed variant differs; zod DTOs |
| e2e | `test/payouts-structures.e2e-spec.ts` | settings + split validation; CRUD; one-structure move; archive; producer → 403 |
| e2e | `test/payouts-run.e2e-spec.ts` | seeded deals/policies/chargebacks for a producer + CSR (`person(...)` helper pattern from `management-dashboard.e2e-spec.ts`); generate → expected gross/net/commission/hat trick/tier/team; recalc keeps sent; future month → 400 |
| e2e | `test/payouts-import.e2e-spec.ts` | presign (FakeStorage) → create → preview resolutions; assign/skip; commit writes `source:'carrier_statement'` rows; duplicate file 409; recalculated draft reflects the chargeback; sent statement untouched and reported |
| e2e | `test/payouts-lifecycle.e2e-spec.ts` | send → `pdf.key` in FakeStorage + `payouts.statement_sent` captured; accept → `signedPdf` + `acceptance.ip`; reject → BM notified; adjustments → re-send v2 → accept; scope (producer sees only own; BM only branch); accept by another user → 403 |
| worker | `test/worker/generate-pay-statements.e2e-spec.ts` | `fn.handle(inlineStep(), now)`: run for the previous month per agency tz; second tick no-op; disabled/no-structure agencies skipped; stale claim re-taken; `payouts.run_ready` sent |
| Bruno | `bruno/Payouts/*.bru` (+ README row) | Login as Owner → Settings → Structure → Generate → Presign/Upload/Create/Assign/Commit import → Statements → Send → Login as Producer → My Statements → Reject → Owner adjustment → Re-send → Producer Accept → PDF URL |
| Commands | `npm test -w @sfa/shared` · `npm run test:unit -w @sfa/api` · `npm run test:e2e -w @sfa/api -- payouts` · `npm run lint -w @sfa/api` · `npm run lint -w @sfa/web` · `cd bruno && npx @usebruno/cli run Payouts --env Local` (API on :4001/:4002 per the local gotchas: the user's own `nest start --watch` holds :4000/5173) |
| Manual (owner + producer, dark + light) | 1 `/settings/payouts`: structure (Allstate 10 %, any 5 %, tiers), enrol producer + CSR, team bonus. 2 book 3 sales in one day as the producer. 3 `/payouts`: Generate current month; numbers match the Owner dashboard gross. 4 upload a chargeback xlsx with a known SOK → preview → commit → net drops. 5 Send → producer notification → detail iframe shows the PDF → Reject with notes → BM notified → exclude the chargeback → Re-send v2 → Accept → signed PDF carries the signature block; `?variant=signed`. 6 producer cannot open another person's statement |

## 10. PR split (stacked on #162, each shippable)

| PR | Contents |
|---|---|
| 1 `feat(payouts): module, payment structures and payout settings` | module key, permissions, templates, spec map, onboarding default, migration, ESLint `FEATURE_DIRS`; `shared/domain/payouts.ts` + `payout-math.ts` (+ specs); all schemas incl. `chargebacks` additions; `PayoutsModule` with settings + structures; e2e structures; web settings page + wizard + `MoneyField`/`PercentField`/`UserMultiSelect` + `lib/money.ts` + nav/settings entries; Bruno |
| 2 `feat(payouts): monthly statement engine and run page` | `common/payouts/` (month-window, load-run-inputs, member-roles, generate-run); worker cron + wiring + worker test; runs/statements/activity endpoints (list, detail, recalc); e2e run; web `/payouts`, `MonthPicker`, statements table, statement detail (HTML breakdown, no PDF yet), activity tab, `/my-pay`; Bruno |
| 3 `feat(payouts): carrier chargeback import` | parser + fixture + unit spec; chargeback writers; import endpoints; recalc on commit; e2e import; web upload dialog + preview page; Bruno |
| 4 `feat(payouts): send, accept and reject statements with signed PDFs` | pdfkit + renderer + unit spec; send/send-all/reopen/adjustments/accept/reject/pdf routes; notification types + renderers; e2e lifecycle; web statement actions, adjustment dialogs, PDF iframe; Bruno. Split into 4a (PDF + send + view) / 4b (accept/reject/adjust/reopen) if too large |

After PR 4: as-built notes in `docs/plans/payouts-implementation-plan.md`,
`AGENTS.md` pointer, `docs/SESSION-HANDOFF.md` section, Linear ticket.

## 11. Open questions for the user (non-blocking; defaults above apply until answered)

1. A **sample chargeback report** (column headers), to pin the parser's aliases.
2. Hat trick: one per qualifying day (A1) — or one per every 3 sales that day?
3. Team threshold counts every producer's gross in the agency, including people on
   no structure (A6/§3.2) — correct?
4. Branch managers: review/adjust/send only (A11), or also upload the chargeback
   report and manage structures?
5. Salesperson of the Month (A12): highest gross premium among statement recipients,
   fixed bonus amount — correct? Any other criterion (policies, items)?
6. Compliance Status (A13): derived from deal audits, or set by the manager?
7. "Allstate Tier" on the PDF: the individual bonus tier reached (A14), or Allstate's
   own agency tier programme (which the app does not hold)?

## 12. Lead-source rate overrides (added 4 Nov 2026)

**Why.** Jessica Yates is paid one rate on JYA leads and another on everything else.
Rates were per carrier only, so a structure could not express that. JYA is an agency
lead source (`leadSources` rows `jya` and `mail-jya`, `agencyId` = Smith Family) and
roughly a third of her premium in Jun–Aug 2026 (local data: $32.6k / $51.1k / $44.8k
of $128k / $182k / $110k).

**Decisions (owner, 4 Nov).** (1) A lead-source rate **replaces** the carrier rate for
sales from that source. (2) All premium still counts toward tiers, Salesperson of the
Month and the team threshold — only the commission rate differs.

**Where.** On the PAC-177 branch **before PR 1 is raised** — the structure schema was
uncommitted, so no migration. The engine half lands in PAC-178.

### Model (`packages/shared/src/domain/payouts.ts`)

- `LeadSourceRateRule { leadSourceId, carrier /* name or ANY_CARRIER */, ratePercent }`.
  A structure gains `leadSourceRules: LeadSourceRateRule[]` (default `[]`); the carrier
  `rules` are unchanged. **One lead source per rule** — Mail-JYA needs its own rule;
  whether a source differs by carrier is the owner's choice per rule.
- `leadSourceRulesError(rules)` — at most `MAX_RATE_RULES`; each rule needs a source and
  a carrier and a `percentError`-valid rate; unique `(leadSourceId, rateRuleKey(carrier))`.
  Messages name rules **by position** ("Lead-source rates 1 and 2 both set a rate for
  Allstate from the same lead source.") because shared code does not know source names;
  the position is the editor's row title and the request body's order.
- `rateFor(rules, leadSourceRules, { carrier, leadSourceId })` → `ResolvedRate | null`,
  precedence **lead source + carrier > lead source + any carrier > carrier > any
  carrier**. `RateSource = 'lead_source_carrier' | 'lead_source' | 'carrier' | 'any'`
  (`RATE_SOURCES`); statement lines add `'none'` in PAC-178. `rateForCarrier` stays as
  the no-override case (`rateFor` with `[]` equals it — specced).
- `normalizeLeadSourceRules` (ids trimmed + lower-cased, carriers canonical, grouped by
  source id, carriers by name with `*` last), `compareRuleCarriers` (shared with
  `normalizeRateRules`), `leadSourceRuleCarrierLabel` (`*` reads "Any carrier").
- Views: `PaymentStructureSummary.leadSourceRules: LeadSourceRateRuleView[]` adds
  `leadSourceName`, resolved through `LeadSourcesService.labelsFor(agencyId)` (archived
  sources included), sorted by source name then carrier. Input:
  `{ leadSourceId, carrier, ratePercent }[]`, **required** (`[]` for none).

### API (`packages/api/src/payouts/`)

- `payment-structure.schema.ts`: `leadSourceRules: [{ leadSourceId: ObjectId ref
  LeadSource, carrier, ratePercent }]` (`_id: false`, `PERCENT_PROP`), default `[]`.
- `dto/payouts.dto.ts`: `leadSourceRules: z.array({ leadSourceId: objectId, carrier,
  ratePercent }).max(MAX_RATE_RULES)` — required, so a client that omits it cannot clear
  the overrides — and `leadSourceRulesError` on path `['leadSourceRules']`.
- `payment-structures.service.ts`: create/update check every source through the new
  `LeadSourcesService.visibleRows(agencyId, ids)` (rows with `agencyId` = the agency or
  `null`, archived included): an id with no visible row → 400 "Some lead sources chosen
  are not available to this agency."; an **archived** source may stay on a structure
  that already names it but cannot be added (400 "… has been archived and cannot be
  added.") — the members rule, and `assertSelectable`'s "archived cannot be picked".
  Every response names the sources with one `labelsFor` read; nothing is stored but the
  id. Reads null-guard a document saved before the field existed. `PayoutsModule`
  imports `LeadSourcesModule`.

### Web (`packages/web/src/features/payouts/settings/`)

- `structure-form.ts`: `leadSourceRules: { leadSourceId, carrier, ratePercent }[]`
  (strings), the shared validator in `superRefine` once every row parses, mappers both
  ways; the Rates step owns the path.
- `structure-steps.tsx` → `RatesStep` = carrier rates + a "Lead source rates"
  `FormSection`: lead source / carrier / rate per row (a new row defaults to "Any
  carrier"), "Add a lead-source rate", empty text "None — everyone on this structure is
  paid the carrier rates above."
- `StructureEditorPage.tsx`: `useLeadSources()` behind the pending gate (reference data,
  like carriers). A failed list does not block the editor: stored rules still render and
  only adding one is disabled. A stored rule on an archived source keeps an option of its
  own ("JYA (archived)").
- `PayoutSettingsPage.tsx` row: "Lead sources: JYA on Allstate 6% · JYA 5%".
- Jessica gets her own structure (rates: Allstate X%, any other Y%; overrides: JYA Z%,
  Mail-JYA Z%).

### Engine (PAC-178, amends §3)

- Gross per person: `linesPrefix(match, SOLD_LINES, {}, /* withSource */ true, { carrier: true })`
  (the `sourceStages` already resolve the lead's source with `Deal.leadSourceId` as
  fallback) → `$unwind lines` → `$group` by `{ producerId, carrier, sourceId }`. Per
  bucket: `rateFor(...)`. `premiumLines[]` become keyed by `(carrier, leadSourceId | null)`
  with `leadSourceId`, `leadSourceName`, `rateSource`; totals unchanged. The Carrier
  production table (PDF §7.4 and the page) shows an override bucket as its own row, e.g.
  "Allstate · JYA leads".
- Chargebacks land in the bucket of the sale they reverse: load the chargeback rows'
  deals with the same `sourceStages` (deal → lead → source, deal fallback); a row with no
  deal/policy goes to the carrier bucket at the base rate. `commissionDeduction` uses the
  bucket's rate.
- *Recommendation (not yet decided):* grouping by `sourceId` splits every carrier into
  one bucket per source, even where no override applies. Fold a bucket back into its
  carrier row unless its `rateSource` is `lead_source_carrier` / `lead_source`; the
  totals are the same either way, and a structure with no overrides then prints exactly
  the carrier table §7 describes.
- Tiers, SOM, team threshold and pool shares: unchanged (whole gross premium).
- PAC-179 activity view: show the lead source on each deal row (already resolved).

## 13. Stackable bonuses and minimum bundle rates (added 5 Nov 2026)

**Why.** The owner asked for three more rules: the team (agency premium) bonus and the
monthly tiers can **stack**, and each carrier rate can require a **minimum bundle rate**
("the producer has to maintain an 83% bundle rate on Allstate"). Built on the PAC-177
branch before PR 1 is raised, so no migration.

**Decisions (user, 5 Nov).**

| Question | Answer |
|---|---|
| What "stackable" means | Every level reached pays and the amounts add up. Unticked: only the highest level reached pays. |
| Team bonus setup | A **list of levels** like the tiers — `$300,000 → $3,000`, `$350,000 → $3,000` — each with its own pool, plus one Stackable checkbox. The CSR/producer split stays agency-wide. |
| Below the minimum bundle rate | **Flag only**: the statement shows a warning, the manager adjusts by hand. Pay is not changed. |
| What a bundle is | **A sale with more than one policy** (two household policies, auto + home, …) — not `Deal.isBundle` (auto + property). |
| Bundle rate on a carrier | Of the month's sales including a policy with that carrier, the % with 2+ policies, whatever carriers the other policies are with (Allstate auto + Progressive home is a bundle for both). |
| Lead-source rates | **Same consequence**: sales paid a lead-source rate on Allstate count toward, and carry, Allstate's flag. |

### Model (`packages/shared/src/domain/payouts.ts`)

- `RateRule.minBundleRatePercent?: number | null` — null/absent = not enforced; more than
  0, at most 100, two decimals (`rateRulesError`). Views always send it.
- `TeamBonusSettings = { enabled, stackable, levels: TeamBonusLevel[], csrSharePercent,
  producerSharePercent }`; `TeamBonusLevel = { thresholdPremium, poolAmount }`. Default:
  off, not stackable, one level `$300,000 → $0`, 20/80.
- `PaymentStructureSummary.tiersStackable` / `UpsertPaymentStructureInput.tiersStackable`
  (required).
- One private `levelsError` backs `bonusTiersError(tiers, { stackable })` and
  `teamLevelsError(levels, { stackable, enabled })`: ≤ 20, thresholds > $0 and distinct,
  amounts valid; **only when not stacking** may a higher level not pay less than the one
  below (stacked, a higher level's amount is extra). A team bonus that is on needs a level.
- Helpers for PAC-178: `levelsReached`, `tierBonusFor`, `teamPoolFor`,
  `bundleMinimumFor(rules, carrier)` (the carrier's own row's minimum, else the
  catch-all's; a carrier with its own row and no minimum is not checked),
  `PAYOUT_BUNDLE_MIN_POLICIES = 2`.

### API / Web

- `Agency.payouts.teamBonus`: `levels[]` + `stackable` replace `thresholdPremium` /
  `poolAmount` (old local documents read as the defaults). Levels stored lowest first.
- `paymentStructures`: `rules[].minBundleRatePercent` (`NULLABLE_PERCENT_PROP`, default
  `null` — the plain `PERCENT_PROP` decimals validator rejects `null`), `tiersStackable`
  (default `false`); reads null-guard both.
- DTO: `minBundleRatePercent` optional per rule (defaults to `null`); `tiersStackable`
  required; `teamBonus` = the new shape, sent whole.
- Web: the team bonus card edits levels (+ "Stackable: pay every level reached"); each
  carrier rate row has "Enforce a minimum bundle rate" → "Minimum bundle rate" (checked
  only while ticked); the Bonuses step has "Stackable: pay every tier reached"; the list
  shows "Allstate 10% (min. bundle 83%)" and "2 monthly tiers, stacking".

### Engine (PAC-178)

- Team pool `teamPoolFor`, tier bonus `tierBonusFor`; the "Allstate Tier" indicator stays
  the highest tier reached.
- Per person and month: a sale is a bundle when it has ≥ 2 sold policy lines. For each
  carrier with sales, bundle rate = bundled sales including that carrier ÷ sales including
  it. Minimum = `bundleMinimumFor(structure.rules, carrier)`; the catch-all's minimum is
  checked per carrier separately. Below it: a statement warning ("Allstate bundle rate 71%
  is below the 83% minimum") and `bundleRate` / `minBundleRatePercent` /
  `bundleShortfall: true` on that carrier's premium lines, **lead-source buckets
  included**. Pay unchanged; the manager uses an adjustment if needed.


---

## As built — PAC-177, PR 1 (4 Nov 2026)

Branch `awaris/pac-177-payment-structures-per-carrier-commission-rates-hat-trick`,
cut from `origin/awaris/pac-173-dash-reconciliation-chargeback-outcome` (#162, d26ad86).

**What landed**

- **Module + permissions.** `ModuleKey.Payouts` (catalog 160/161),
  `AgencyPermission.PayoutsAdmin` = `agency:payouts:admin` (catalog **1019**, not
  1018 as first guessed — read off `PERMISSION_CATALOG`). Templates: Branch Manager
  `payouts:read`+`write`; Producer, CSR, CRM, Data Team `payouts:read`; owner the
  admin key (via `Object.values(AgencyPermission)`). `ONBOARDING_DEFAULT_MODULES`
  includes it. Migration `20261104120000-payouts_module.js` writes the three catalog
  rows, the entitlement and the grants (applied locally on `sfa`: 6 agencies, 41
  grants).
- **`payouts:read` is own statements only, whatever the role's data scope.** Found
  while building: CRM is branch-scoped and Data Team agency-scoped, so scoping
  `payouts:read` by data scope would let them read colleagues' pay. Seeing other
  people's statements needs `payouts:write`, and *that* is scoped. PAC-178 must
  implement the statements read path this way (§6 said "own scope = self", which
  is not enough on its own).
- **Shared:** `domain/payouts.ts` — vocabulary, defaults, view/input types and the
  validators `rateRulesError`, `bonusTiersError`, `hatTrickError`,
  `teamSplitError`, `teamBonusError`, `amountError`, `percentError`, plus
  `normalizeRateRules`, `sortBonusTiers`, `rateForCarrier`, `rateRuleKey`
  (carrier keys go through `normalizeCarrier` + `carrierSlug`, so `B4tEH`,
  `Allstate` and ` allstate ` are one carrier). A higher tier may not pay less
  than the one below (added rule).
- **API:** `paymentStructures` (agency-level, not a `TenantRecord`; partial unique
  `{agencyId, nameKey}` on active), `Agency.payouts` (`teamBonus`,
  `salespersonOfMonth`, read through `common/payouts/payout-settings.ts`
  `payoutSettingsFrom` so the worker can reuse it), `PayoutsAdminController`
  (`/payouts/settings`, `/payouts/structures[/people|/:id|/:id/archive]`, all
  `agency:payouts:admin`, `@SkipBranch`). A save moves members off other active
  structures in the same `TransactionRunner` transaction. A member removed from the
  agency stays on the structure (status `deactivated`, not counted) but cannot be
  added.
- **Web:** Settings → Payouts (`/settings/payouts`), the three-step structure
  editor (`/settings/payouts/structures/new|:id`), new field components
  `MoneyField`, `PercentField`, `ChecklistField`, `lib/money.ts`,
  `lib/payouts-api.ts`. `SettingsSection` gained an optional `module` so the hub
  hides the card while the module is off; the routes are double-gated (admin key +
  `payouts:read`).
- **Bruno:** `bruno/Payouts/` (14 requests). Runs against a tenant host
  (`http://app.sfa.local:4002/api/v1`) — `localhost` is refused by host binding.

**Moved to PR 2 (PAC-178)** — `payout-math.ts`, and the `payoutRuns`,
`payStatements`, `chargebackImports` schemas plus the `chargebacks` additions:
nothing in PR 1 reads them, and they land with the code that does.

**Verified (4 Nov):** shared 379 (payouts + permission specs 83), API unit 1591,
e2e `payouts-structures` 19, api/agency-profile/platform-users/onboarding suites
green except the known `api.e2e-spec.ts:1373` invite-preview failure (since PAC-173
PR 1, belongs on #157), API tsc = 24-error baseline (none in new files), API eslint
clean, web `npm run lint` clean, Bruno Payouts 14/14 (27 tests). Browser-checked
(headless Chrome over CDP) as owner in dark + light: hub card, settings forms, split
error, empty-step block, create → listed → edit → archive; a producer is redirected.
The only console warnings are the existing `MobileNav` / `AlertDialogOverlay` ref
warnings from the shadcn primitives.

**Review fixes (4 Nov 2026)** — ten code-review findings, all on the uncommitted PR 1:

1. *Editor seeded from a stale cached copy.* Web: the editor waits for a structure and
   people fetch made on this visit (`refetchOnMount: 'always'` + `isFetchedAfterMount`,
   no focus refetch; the page is keyed by id). API: `PATCH /payouts/structures/:id` now
   **requires `expectedUpdatedAt`** (the `updatedAt` it was edited from); the write filters
   on it, and a mismatch on an active structure is **409 `PAYMENT_STRUCTURE_STALE`** (new
   shared constant; `UpdatePaymentStructureInput` type). `moveMembersHere` bumps the other
   structures' `updatedAt`, so "B took X off A, A's editor saves X back" is now a 409. The
   editor shows the message with a **Reload** action on the same step.
2. *One-structure-per-person race.* Every create/update transaction first `$inc`s
   `Agency.payoutStructuresRevision` (new optional prop, `timestamps: false`), so
   concurrent saves write-conflict and `withTransaction` retries after the first commits.
   Archive stays a single atomic write. The no-replica-set fallback cannot give this
   guarantee (comment on `lockStructures`). E2E races two creates five times per run; it
   fails without the lock.
3. *Saving one settings card wiped the other.* One remount seed per card.
4. *Archived structures opened as editable; every 409 jumped to step 1.* An archived
   structure renders a read-only notice with a link back; only
   `PAYMENT_STRUCTURE_NAME_TAKEN` jumps to step 1.
5. *Hidden hat-trick fields blocked Bonuses.* `dealsPerDay` / `hatTrickBonus` are checked
   in `superRefine` only while the hat trick is on (same messages); when off, a blank or
   invalid value is sent as `DEFAULT_HAT_TRICK`'s.
6. *Defaults written into new agencies.* `Agency.payouts` and its sections lost
   `default: () => ({})` (now optional); asserted in the payouts and onboarding e2e.
7. *Split error on one field.* "Must add up to 100%" is attached to both shares.
8. *Loose stored schema.* `common/payouts/stored-amounts.ts`: money 0–`MAX_PAYOUT_AMOUNT`,
   percent 0–100, both two-decimal; `dealsPerDay` whole, 2–20. Applied to
   `paymentStructures` and `Agency.payouts`; update paths pass `runValidators: true`.
9. *module-catalog splice.* The Payouts entry is on its own line. (The file still fails
   `prettier --check` on three older description lines that fail identically at HEAD —
   left alone.)
10. *Save re-read what it had.* `create` returns the created doc and `update` the
    `findOneAndUpdate({ new: true })` doc; the view is built from them plus the people map
    `checkedMembers` now returns. `detail` calls `agencyOf` once.

**Verified after the fixes:** shared payouts + permission specs 83, shared tsc clean; API
tsc = 24-error baseline (none in payouts files), eslint clean, unit 1591, e2e
`payouts-structures` 25 (was 19; 5 consecutive runs green), `agency-onboarding` 24,
`agency-profile` 24; web `npm run lint` clean, prettier clean on `features/payouts`; Bruno
Payouts 15/15 (31 tests, new *Update Payment Structure (Stale)*). Headless Chrome: split
error on both fields; cleared hat-trick bonus blocks Continue while on and not once
unticked (saved as 3 sales / $50); archived structure read-only (dark + light); A reopened
after B took its member shows 0 selected; a save over a change made elsewhere shows the
stale message + Reload on step 3, and the save after Reload keeps the other change.

**Lead-source rate overrides — §12 (4 Nov 2026).** Built on the same uncommitted PR 1,
structure/settings half only (the engine half is PAC-178). Contract changes:
`PaymentStructureSummary` / `View` gain `leadSourceRules: LeadSourceRateRuleView[]`
(`leadSourceId`, `leadSourceName`, `carrier`, `ratePercent`); `POST` and `PATCH
/payouts/structures[/:id]` **require** `leadSourceRules` (`[]` for none — an omitted field
is a 400, so an old client cannot silently clear overrides); new 400s for a duplicate
`(source, carrier)`, a source that is not the agency's, and adding an archived source.
`PATCH` still requires `expectedUpdatedAt`. New shared exports: `LeadSourceRateRule`,
`LeadSourceRateRuleView`, `RATE_SOURCES` / `RateSource`, `ResolvedRate`,
`leadSourceRulesError`, `normalizeLeadSourceRules`, `compareRuleCarriers`, `rateFor`,
`leadSourceRuleCarrierLabel`; `rateForCarrier` now returns `ResolvedRate` narrowed to
`'carrier' | 'any'`. New `LeadSourcesService.visibleRows`. Bruno: *List Lead Sources*
(captures a source, `jya` first) and *Create Payment Structure (Duplicate Lead-Source
Rate)*; Create/Update bodies carry a rule, Stale/Duplicate Name send `[]`.

**Verified (§12):** shared payouts + permission specs 99 (was 83), shared tsc clean; API
tsc = 24-error baseline (none in payouts or lead-sources), eslint clean on
`src/payouts src/common/payouts src/lead-sources` + the e2e; e2e `payouts-structures` 33
(was 25); web `npm run lint` clean, prettier clean; Bruno Payouts 17/17 (38 tests).
Headless Chrome as the demo owner (with a temporary demo-agency `jya` row, removed
afterwards): empty-state text; a new row defaults to "Any carrier"; two JYA/any-carrier
rows are refused on the Rates step with the shared message (dark + light) and the error
clears once one is changed to Allstate; create → list row "Lead sources: JYA on Allstate
6% · JYA 5%" (dark + light); reopen shows JYA / Allstate / 6 and JYA / Any carrier / 5
(dark + light); an unchanged re-save keeps both. Console: only the existing `MobileNav`
ref warnings.

**Stackable bonuses and minimum bundle rates — §13 (5 Nov 2026).** Same uncommitted PR 1,
settings half only (PAC-178 applies them). Contract changes: `teamBonus` is now `{ enabled,
stackable, levels[{ thresholdPremium, poolAmount }], csrSharePercent, producerSharePercent }`
(the old `thresholdPremium` / `poolAmount` are a 400); structures **require**
`tiersStackable`; each rate rule takes an optional `minBundleRatePercent` and views always
return it (`null` = off). `bonusTiersError` now takes `{ stackable }`; the "higher pays
less" rule (and its message, now "…, unless the tiers stack.") applies only when not
stacking. New shared exports: `TeamBonusLevel`, `PAYOUT_BUNDLE_MIN_POLICIES`,
`teamLevelsError`, `levelsReached`, `tierBonusFor`, `teamPoolFor`, `bundleMinimumFor`; new
API prop `NULLABLE_PERCENT_PROP`. Also fixed from PR 1: both settings cards rendered a
checkbox with `id="enabled"`, so the Salesperson of the Month label ticked the team bonus
box — that form's field is now `somEnabled`.

**Verified (§13):** shared payouts + permission specs 112 (was 99), shared tsc clean; API
tsc = 24-error baseline (none in payouts), eslint clean; e2e `payouts-structures` 38 (was
33) + `agency-onboarding` 24; web `npm run lint` clean, prettier clean; Bruno Payouts 17/17
(39 tests). Headless Chrome as the demo owner, dark + light: team levels $300,000 → $3,000
and $350,000 → $3,000, stackable, saved and reloaded; the minimum bundle rate field appears
only when ticked, 0 is refused, an unticked blank does not block Continue; non-stacking
tiers with a smaller higher bonus are refused and accepted once Stackable is ticked; list
row "Allstate 10% (min. bundle 83%) · … · 2 monthly tiers, stacking"; reopen shows both.
Test structure archived and the demo team bonus reset to defaults afterwards.

---

## As built — PAC-178 + PAC-179, PR 2 (5 Nov 2026)

Branch `awaris/pac-178-monthly-commission-statements-calculation-drafts-on-the-1st`, cut
from the PAC-177 branch (#169, `2264113`); PR base = that branch.

**What landed**

- **Shared.** `domain/payouts.ts` gains the statement vocabulary: `PAYOUT_MONTH_PATTERN`,
  `PAY_STATEMENT_STATUSES` (+ `EDITABLE_PAY_STATEMENT_STATUSES`, `isEditableStatementStatus`),
  `PAYOUT_RUN_STATUSES`, `PAYOUT_RUN_TRIGGERS`, `STALE_PAYOUT_RUN_MINUTES` (30),
  `PAYOUT_POOLS` + `payoutPoolFor(roleSlugs)` (`csr` slug → CSR pool), `STATEMENT_ADJUSTMENT_KINDS`,
  `STATEMENT_RATE_SOURCES` (`RATE_SOURCES` + `none`), `PAYOUT_NO_CARRIER`, page sizes, the
  409 codes `PAYOUT_RUN_GENERATING` / `PAYOUT_STATEMENT_NOT_EDITABLE`, and the view types
  (`PayoutRunView`/`PayoutRunResponse`, `PayStatementSummary`/`View`, `PremiumLineView`,
  `StatementDealView`, `StatementChargebackView`, bonuses, indicators, totals,
  `PayoutActivityView`, `PayoutActivityPeopleResponse`). New `domain/payout-math.ts`: the
  pure engine — `computeStatement`, `computeTeamContext` + `teamBonusFor`, `allocatePool`
  (largest remainder in cents), `salespersonOfMonthWinners`, `hatTrickDays`, `toDealView`,
  `percentOf` (cents × basis points, rounded once, half away from zero), `roundToCents`,
  `payoutCarrierName`, `salesGrossPremium`. Notification `payouts.run_ready` (new category
  `payouts`; email + push).
- **API, `common/payouts/` (the worker may import it).** `month-window.ts` (the month on the
  agency's clock via `customRange` + `instantWindow`; `previousMonthIn`, `monthLabel`);
  `load-run-inputs.ts` — **one `linesPrefix(…, SOLD_LINES, {}, true, { carrier: true })`
  aggregate** gives each person's sales with their lines and lead source, so a statement's
  buckets and its deal list add up by construction; `agencyGrossPremium` is the Owner
  dashboard's `linePremium` sum over the same match; chargebacks by `occurredAt` with the
  policy's carrier and the original deal's source; failed audits per sale;
  `appointedCarrierNames`. `run-claim.ts` (`claimRun`), `generate-run.ts` (`generateRun`,
  `recomputeStatement`, `structureSnapshot`), `run-ready.ts`, `lead-source-labels.ts`.
  `payout-people.ts` **moved here from `payouts/`** and gained `roleSlugs` and
  `allstateBindId` (the statement's Producer ID).
- **Collections.** `payoutRuns` (unique `{agencyId, month}` = the claim; `timeZone`,
  `window`, `settingsSnapshot`, `agencyGrossPremium`, `teamBonus`, `teamShares[]` — every
  member's share as the last full calculation split it — `salespersonOfMonth`, `warnings`,
  `startedAt`/`finishedAt`/`error`, `trigger` of the latest generation). `payStatements` (a
  snapshot: person, `branchId`/`branchName` as strings, roles, pool, `structureSnapshot`,
  lines, deals, chargebacks, bonuses, indicators, `adjustments[]`, totals, warnings,
  `status`, `version`). Indexes as §2; no migration (new collections).
- **Endpoints** (`PayoutsStatementsController`, `payouts:read` at class level, branch header
  honoured):

  | Route | Guard | |
  |---|---|---|
  | `GET /payouts/runs?month` | `payouts:write` | `{ month, currentMonth, run \| null }`; counts and totals over the statements the caller may see |
  | `POST /payouts/runs {month}` | `agency:payouts:admin` | generate / recalculate inline; 400 future month; 409 `PAYOUT_RUN_GENERATING` |
  | `GET /payouts/statements?month&status&branchId&q&mine&page&pageSize` | `payouts:read` | `mine=true` = My Pay |
  | `GET /payouts/statements/:id` | `payouts:read` | 404 when not visible |
  | `POST /payouts/statements/:id/recalculate` | `payouts:write` | 409 `PAYOUT_STATEMENT_NOT_EDITABLE` once sent |
  | `GET /payouts/activity/people` | `payouts:write` | whose activity the caller may open |
  | `GET /payouts/activity?month&userId` | `payouts:read` | own always; another person: 403 without write, 404 outside scope |

- **Job.** `GeneratePayStatementsFn` — hourly UTC cron, `concurrency 1`, `retries 0`,
  `forEachAgency`; skips agencies with Payouts off or no structure with members; drafts
  `previousMonthIn(tz, now)`; notifies owners + branch managers once per run
  (`deterministicEventId('payouts.run_ready', runId)`, dedupe `payout-run:<runId>:ready`).
  `worker.module.ts` registers `PaymentStructure`, `PayoutRun`, `PayStatement`,
  `AgencyRole`, `UserRole` and the fn.
- **Web.** `/payouts` (Management → Payouts, `payouts:write`): month picker (default = the
  previous agency month), run summary (agency premium vs the first team level, pools,
  statements by status, net commission, Salesperson of the Month, warnings), Generate /
  Recalculate (owner; confirm dialog for a recalculation), statements table with instant
  status / branch / name filters. `/payouts/statements/:id` (both audiences): Statement tab
  = details, indicators, carrier production (lead-source lines, bundle shortfall badge),
  commission summary + net commission, chargeback detail, how each bonus was reached;
  Activity tab. `/my-pay` (Sales → My Pay): own statements (never a draft) + own activity
  with a month picker. `/payouts/activity`: person picker + month. New
  `components/common/MonthPicker.tsx`, `lib/months.ts`, `features/payouts/payout-format.ts`.
- **Bruno.** 13 requests (30 in the folder), README rows.

**Decisions taken while building** (state them in the PR)

1. **Lead-source buckets fold** (user, 5 Nov): a bucket keeps a line of its own only when a
   lead-source rate applied (`lead_source_carrier` / `lead_source`); every other sale on a
   carrier is on the carrier's line. Appointed carriers are listed with zero rows.
2. **Chargebacks are matched by `occurredAt` only.** The ledger has no `statementMonth`,
   `carrier` or `customerName` yet; PAC-180 adds the `statementMonth` clause and the
   chargeback-schema additions (still not in this PR, as planned).
3. **Who gets a statement:** everyone active on a structure; someone invited or removed
   only for a month with sales or chargebacks. A draft for someone no longer on a structure
   is deleted on recalculation; any other status is kept.
4. **The claim** (`run-claim.ts`): a live `generating` run (< 30 min) is busy; a `failed` or
   stale one is taken over; the job leaves a `ready` month alone **only if it was generated
   after the month ended** — a month the owner generated on the 31st is re-drafted on the 1st.
   A manual Generate always recalculates.
5. **Recalculating one statement** applies the person's current structure (or the snapshot
   if they left every structure) against the run's stored team shares and Salesperson of
   the Month, and warns when their premium has moved since — re-splitting the pool for one
   person would change other people's statements.
6. **Visibility:** a statement the caller may not see is a 404; someone else's activity
   without `payouts:write` is a 403 (the ticket's wording). `mine=true` gives the employee
   view to anyone, so My Pay never shows a branch manager their own draft.
7. **Run counts and totals are read in the caller's scope**, never stored — a branch
   manager is not shown the agency's payroll. The agency premium and pools are shown to both
   (the team bonus is agency-wide).
8. Only the job notifies; a manual Generate does not.
9. Computed money is stored as plain numbers (may be negative); `MONEY_PROP` stays for
   input.
10. PDF, send, acceptance, rejection and history fields arrive with PAC-181/182 (nullable
    additions). The math already applies `adjustments[]`.
11. The Bruno structure enrols the demo producer **only when they are on no structure**
    (`payoutsMemberIdsJson`), keeping PR 1's "a run never moves anyone" guarantee.

**Verified (5 Nov):** shared 440 tests (payout-math + render specs new), tsc clean; API tsc =
24-error baseline (none in payouts, common/payouts or the worker), eslint clean on the
touched paths, unit 1597 (month-window 6 new); e2e `payouts-run` 18, `payouts-structures`
38, `worker/generate-pay-statements` 5, `agency-onboarding` 24; web `npm run lint` clean,
prettier clean on the new files; Bruno Payouts 30/30 (62 tests). Headless Chrome on the demo
agency (owner, producer, branch manager; dark + light): `/payouts` defaults to October and
offers Generate; November recalculated through the dialog with the "still running" note;
October generated from the page — **agency premium $91,929 = the Owner dashboard's for the
same month, and each of the 7 statements' sold premium = the dashboard filtered to that
person**; statement sections and Activity tab; activity totals = the statement's; the
producer's My Pay hides their draft and shows it once marked sent (no Recalculate for
them); the producer is redirected from `/payouts`; the branch manager sees their branch's
5 of 7 and no Generate. Console: only the existing forwardRef warning. The check structure
was archived, the demo payout settings restored and the runs it created deleted.

---

## As built — PAC-180, PR 3 (5 Nov 2026)

Branch `awaris/pac-180-carrier-chargeback-report-upload-xlsx-match-by-sok-number`, cut from the
PAC-178 branch (#171, `c94c7a9`); PR base = that branch.

**The sample report (arrived 5 Nov).** `Chargebacks - June Chargebacks .csv` — the agency's own
"Chargebacks" sheet exported as **CSV**, not a carrier .xlsx, with **no SOK column**: `Keep or
Remove, Customer, Policy Type, Carrier, Producer, Sold Date, Premium, Zip Code, City, Report
Month, Charge back (Y/N), Policy Number, Prorated Amount, Termination Reason, Send to
Smartsuite`. 15 lines; `Producer` is a person's name. The owner (5 Nov): the amount is
**Prorated Amount**; the real report holds only approved chargebacks, so Keep or Remove and
Charge back (Y/N) are not read; match people by **the Producer name and the policy number
together**. The sample is reference only — the fixtures reuse its header with invented values.

**What landed**

- **Shared.** `domain/chargeback.ts`: `CHARGEBACK_REASONS` + `carrier_statement`, `manual`;
  `CHARGEBACK_SOURCES` + `carrier_statement`; `ChargebackView.policyId` nullable plus `carrier`,
  `customerName`, `statementMonth`, `importId`, `statementId`; the docblock now says Payouts is
  the model PAC-123 deferred. `domain/payouts.ts`: `CHARGEBACK_IMPORT_STATUSES`,
  `IMPORT_ROW_RESOLUTIONS` (+ `CHARGED_IMPORT_ROW_RESOLUTIONS`, `isChargedResolution`),
  `IMPORT_ROW_NOTES` + labels, `IMPORT_MATCH_SIGNALS`, `PAYOUT_IMPORT_FILE_EXTENSIONS` (.xlsx,
  .csv), `MAX_PAYOUT_IMPORT_FILE_BYTES` (10 MiB), `MAX_PAYOUT_IMPORT_ROWS` (5,000), codes
  `PAYOUT_IMPORT_DUPLICATE_FILE` / `_UNREADABLE_FILE` / `_UNRESOLVED_ROWS` / `_NOT_EDITABLE`,
  `CHARGEBACK_FILE_ERROR_REASONS`, `IMPORT_RECALCULATION_OUTCOMES`, the view types and
  `importRowCounts` (cents).
- **API, `common/payouts/`.** `chargeback-file-reader.ts` `parseChargebackFile(bytes, { format,
  maxRows })` — one **ordered alias table** at the top (the sample's names first; the first
  alias a header has wins, so `Premium` is never the amount); header = first row on any sheet
  (first 40) with a policy-number and an amount column, else the first header-like row (2+ known
  columns) so the refusal names the missing column; CSV read as text through `csv-parse`.
  `match-import-rows.ts` (`matchImportRows`, pure `resolvePerson`, `personNameKey`).
  `chargeback-writers.ts` (`importedChargebackDoc`, `writeImportedChargebacks`).
  `load-run-inputs.ts`: `loadRunInputs` takes `month`; `chargebacksInMonth(month, window)` =
  `$or [{statementMonth: month}, {statementMonth: null, occurredAt in window}]` (also the
  import's duplicate check); carrier = the row's, else the policy's; customer = the sale's, else
  the household's, else the row's. `payout-people.ts` gains `{ includeRemoved }`;
  `generate-run.ts` exports `peopleModels`.
- **Collections.** `chargebacks`: `policyId` optional (`default: null`), new `carrier`,
  `customerName`, `statementMonth`, `importId`, `statementId` (all `default: null`), index
  `{agencyId, statementMonth, producerId}`; the `cancel_rewrite` partial unique index untouched.
  New `chargebackImports` (agency-level; lines embedded; partial unique `{agencyId, fileSha256}`;
  `{agencyId, month, createdAt:-1}`). **No migration**: enum widening and the optional
  `policyId` are validator-only, the new fields are optional, and `autoIndex` (not overridden)
  builds the new index and collection.
- **Endpoints** — `PayoutsImportsController` (`/payouts/imports`, **every route
  `agency:payouts:admin`**, `@SkipBranch`): `POST presign`, `POST /` (create a preview), `GET
  /?month`, `GET /people`, `GET /:id`, `PATCH /:id/rows/:rowNumber` (`assign` / `skip` /
  `reset`; `include` was removed in the review fixes below), `POST /:id/commit`, `DELETE /:id`
  (discard).
- **Elsewhere.** `policies/policy-rewrites.service.ts` (the policy history card) reads only
  `cancel_rewrite` / `cancellation` rows — a report line would otherwise double the total and
  hide "Cancelled policy · $X charged back".
- **Web.** Payouts page: **Upload chargebacks** (admin) → `ImportChargebacksDialog` (`useAppForm`:
  pay month `SelectField`, carrier `ComboboxField`; `FileDropzone` .xlsx/.csv) and a "Chargeback
  reports" panel for the month. `/payouts/imports/:id` (admin + `payouts:read`):
  `ImportPreviewPage` — notices, five tiles, `?show=` filter, lines table with a row menu,
  `AssignRowDialog` (suggested people first, people who left included), Commit / Discard
  confirmations, the commit result with the sent/accepted statements left alone.
  `payout-format.ts` lost its casts. New files under `features/payouts/imports/`.
- **Bruno.** 16 requests in `Payouts/` (seq 22–37 and 47; the archive and producer requests moved
  to 38–46), fixture `bruno/fixtures/payout-chargebacks-demo.xlsx` (18,804 bytes), README rows.

**Decisions taken while building** (state them in the PR)

1. **Who is charged** — `resolvePerson`: a SOK number on a user decides (people who left
   included). Otherwise the Producer name (exactly one user, "Last, First" too) and the
   policy's seller (the deal's producer): agree, or only one found → `matched` with a note
   saying which; disagree → `unmatched`, both offered as suggestions; neither → `unmatched`.
2. ~~Duplicates against the month's ledger only, includable~~ — **superseded by the review
   fixes below**: a policy is charged back once, any month, and a repeat within the file is a
   duplicate too; duplicates cannot be included.
3. **Commit** writes the ledger rows and marks the import committed in one `TransactionRunner`
   transaction, then recalculates **the whole month** with `claimRun` + `generateRun` (user, 5
   Nov) — `recomputeStatement` is not used, because `generateRun` is the one path that also
   drafts a statement for a removed structure member whose only activity is the chargeback.
   `no_run` / `busy` / `failed` are reported, never thrown: the chargebacks stand.
   `untouched` = sent / accepted statements of the people charged.
4. **422** `PAYOUT_IMPORT_UNREADABLE_FILE` + `reason` for an unreadable report (the plan said
   400), like Dash's `RECONCILIATION_UNREADABLE_FILE`. A file named .xlsx that is not a zip is
   refused rather than guessed at.
5. **`customerName` on the ledger** (user, 5 Nov) — only report rows set it; the app's name wins
   when the policy matched.
6. `occurredAt` = the report's cancel date when it has one, else the first instant of the
   statement month; display only for these rows (they count by `statementMonth`).
7. A line with no policy number is left out (warned when it carries an amount — a total line);
   so is a line with no or zero amount.
8. ~~Policies without a stored `policyNumberKey` keyed in Node~~ — **superseded**: migration
   `20261106120000-policy_number_keys` backfills the key and the demo seed now writes it.
9. Every import route is the admin's, reads included (a report spans branches).
10. `writeManualChargeback` arrives with its only caller (PAC-182 adjustments); this PR adds the
    `manual` reason and `statementId` field.

**Verified (5 Nov):** shared 444 tests, tsc clean; API tsc = 24-error baseline (none in touched
files), eslint clean on `src/payouts src/common/payouts src/chargebacks
src/policies/policy-rewrites.service.ts` + the e2e, unit 1632 (parser 21, matcher 14 new); e2e
`payouts-import` 23 (new), `payouts-run` 18, `payouts-structures` 38,
`worker/generate-pay-statements` 5, `reconciliation-outcomes` 54, `api.e2e` history / rewrite /
cancel slice 45; the real June sample parses to 15 lines (amount from Prorated Amount, no
warnings); web `npm run lint` clean, prettier clean on `features/payouts` + `lib/payouts-api.ts`;
Bruno Payouts 47/47 (93 tests), twice (the rerun takes the 409 path). Headless Chrome on the demo
agency (owner), dark + light: October generated from the page; Upload chargebacks (October +
Allstate by default) with SOKDEMOP on 900200002, an unknown SOK / name / policy, and 900299990
→ 1 matched, 1 needs a person, 1 duplicate; Commit disabled until the line was assigned (through
the row menu and the picker) to Pat Producer; commit "Charge 2 lines totalling $630 to October
2026?" → Pat's draft net **$6,250.80 → $6,187.80** (chargebacks $8,842 → $9,472), Chargeback
detail and the Activity tab show "Carrier report"; the same file again opens the committed
import; a CSV discarded leaves the panel and can be uploaded again. Console: only the existing
forwardRef warning. Afterwards the test structures were archived, the demo payout settings are
the defaults, and the runs, statements, imports, their ledger rows and the uploaded files were
deleted.

**Review fixes — PAC-180 (6 Nov 2026).** `/code-review` raised 15 findings on the uncommitted
PR; all fixed.

*Owner decision (6 Nov): "if the policy is already charged back, you can't charge back twice —
keep the original and flag it to inform".*

1. **A policy is charged back once.** A line is a `duplicate` when its policy already has any
   chargeback — **any month, any source** (`existingChargebacks`: rows on the policy, plus
   report rows with no policy, by number; both use the `policyId` index) — or when an earlier
   line of the file charges it (`repeatOfRow`). The original is named on the line
   (`existingChargeback`: reason, source, amount, date or pay month, producer) and the preview
   shows "Kept: …" plus a notice. A duplicate is never charged and takes no action (400
   `PAYOUT_IMPORT_ALREADY_CHARGED`); **`include` is gone** from the API, DTO, shared types, web
   and Bruno. Duplicate beats needs-a-person, so it never blocks a commit.
2. **Commit re-checks the ledger** inside its transaction. A policy charged back since the
   preview refuses the commit with 409 `PAYOUT_IMPORT_CHARGED_SINCE` + `rowNumbers`, and those
   lines are marked duplicates; a second commit charges the rest. Commits in one agency are
   serialised by a first-write `$inc` of `Agency.chargebackImportsRevision`, so two reports
   committed at once cannot both charge a policy (the e2e races two commits: one 200, one 409,
   one ledger row). On the no-replica-set fallback the inserted rows are registered for
   compensation.
3. **Reversals.** Amounts still read positive (`($123.45)`, `-123.45`, `$123.45` → 123.45),
   but when a report mixes signs the lines with the less common sign (negatives on a tie) are
   `oppositeSign` → `skipped` with note `opposite_sign` and a warning; the owner may still
   charge one by assigning it.
4. **SOK aliases** no longer include `Producer Code` or `Agent ID` (a sub-producer code or an
   agent number is not the Bind ID, and a SOK match decides alone).
5. Carrier preference compares carrier slugs (`ALLSTATE` = `Allstate` = `B4tEH`).
6. **Unkeyed policies:** migration `20261106120000-policy_number_keys.js` backfills
   `policyNumberKey` (the writers' rule: ≥ 4 characters) and the demo seed writes it; the
   matcher's scan of keyless policies is gone. Locally it was applied by the watched API on
   :4000; no policy with a 4+ character number is left without a key.
7. `Chargeback.policyId` is required again for every reason except `carrier_statement` and
   `manual`.
8. `create()` no longer deletes the file once the preview is saved.
9. `recalculate` never throws (the run lookup and the sent-statement list are guarded), and the
   commit's `result` write is guarded too.
10. Row actions read and return one line (`$elemMatch`), update with `findOneAndUpdate`
    projecting only resolutions and amounts, and check structure membership with `exists`.
11. `chargebackSourceLabel` uses the shared `CHARGEBACK_REASON_LABELS` (a cancellation now reads
    "Cancelled policy" on statements, as elsewhere in the app).
12. `common/payouts/regenerate-month.ts` (`regenerateMonth`, `agencyTimeZone`) is the one
    claim-and-generate path, used by Recalculate and by the import.
13. The upload dialog's month picker includes the page's month when it is older than 12 months.

**Verified (6 Nov):** shared 444, tsc clean; API tsc = 24 baseline, eslint clean, unit 1636
(parser 25); e2e `payouts-import` 25 (5 consecutive runs, race included), `payouts-run` 18,
`payouts-structures` 38, worker 5, `reconciliation-outcomes` 54, `api.e2e` history / rewrite /
cancel 45; web lint + prettier; Bruno Payouts 47/47 (93 tests) twice — fixture rebuilt (19,393
bytes) with a bracketed reversal line; headless Chrome dark + light: the duplicate names the
kept charge ("Kept: Cancelled policy · $2,210.50 · Oct 20, 2026 · Pat Producer"), the reversal
is skipped, Pat's October net $6,250.80 → $6,187.80 as before. Demo data, uploads and servers
cleaned up afterwards.

---

## As built — 2026 comp plans (6 Nov 2026)

Branch `awaris/pac-176-comp-plans-2026-pay-rules`, cut from the PAC-180 branch
(#172, 336bc5c); PR base = that branch. David's pay-plan documents (Inside
Sales Commission Update 2026, 2026 Sales Compensation Plan, Client Relations
Manager, Life Specialist 2026, Office Manager 2025) were compared with the
build; the gaps and the owner's answers are on the PAC-176 epic, "Comp plans".

**Owner's decisions (6 Nov).** The 2026 plans take effect; the bundle stays
"a sale with 2+ policies" (not the document's auto + home); the 80/20 pool
split stays; **base pay is on the statement**; everything else as the
documents say (e.g. the Office Manager's 1% on all office premium).

### Model (`@sfa/shared` `domain/payouts.ts`, "2026 comp plans")

Every part is optional on a structure; a structure without them pays exactly
as before (the 29 pre-existing engine tests are unchanged).

| Part | Shape | Plan |
|---|---|---|
| Stepped rate | `RateRule.stepBasis: premium \| retention`, `steps[] { threshold, ratePercent, bonusAmount, minCompliancePercent, minBundleRatePercent }` | Inside 8% → 10% from $50,001; Outside 10/12/15% (15% gated: 95% compliance, 83% bundles); CRM 5/6/7.5% + $500 by retention |
| Tier gate | `BonusTier.minCompliancePercent` | Inside $1,500 at $100,000 needs good standing |
| Base pay | `basePay` | Inside $2,500; CRM, Life, OM $4,000 |
| Stipend | `stipendAmounts[]` + `memberStarts[] { userId, startMonth }` | Outside "Launch Pad" 2,500 / 2,000 / 1,500 |
| Compliance floor | `complianceFloor { minimumPercent, reductionPercent }` | below 85%: no SOM, hat trick, team or tier bonuses, base rates, −10% |
| Overrides | `overrides[] { basis: agency \| lead_source, leadSourceId, carrier, ratePercent }` | OM 1% of all office premium; Outside 1% of overflow sold by others |
| Agency-premium tiers | `agencyTiers[]` + `agencyTiersCarrier` | OM production bonus on Allstate premium |
| Team requirements | `teamRequirements { soldLogWithinDays, meetingAttendance }` | CRM: Sold Log within 1 day + attendance |
| Referral rule | `referralRule { minimum, shortfallDeduction, bonusThreshold, bonusAmount }` | CRM 15 / −$500, 40 / +$500 |
| Chargeback window | `chargebackWindowMonths` | CRM: six months |
| Producer of the Year | agency setting `producerOfYear { enabled, bonusAmount, minCompliantMonths, minCompliancePercent }` | $2,500, compliant 9 of 12 months |

**Entered figures** (`StatementInputs` on each statement): compliance rate,
retention, valid life referrals, meeting attendance — the app holds none of
these. `null` = not entered. **A gate needing a figure is not met until it is
entered** (pay is never unlocked on a guess); **a penalty applies only to an
entered figure** (no floor reduction on a blank).

### Engine (`payout-math.ts`)

- `appliedRate(rule, month)`: the highest step reached whose gates are met,
  else the base; below the floor always the base. Gated-out steps and a
  missing retention figure become warnings ("Any other carrier: the 15% step
  at $80,000 is not paid — it needs a 83% bundle rate (this month: 50%)").
  The bundle gate uses the person's **overall** bundle rate.
- Lines carry `rateStep`; a lead-source rate still replaces the rule's rate.
- Chargebacks older than `chargebackWindowMonths` (cancellation month vs pay
  month) are excluded with a note.
- Variable pay = net carrier commission + overrides + step bonuses + tiers +
  agency bonus + team + SOM + hat trick + POY. The floor's reduction is a
  share of it (only when positive). Referral ± and the manager's adjustments
  come after; base pay and stipend are never reduced.
  `netPay = basePay + stipend + netCommission`.
- `teamBlockReasons` (floor, late Sold Log entries — `Deal.createdAt`'s
  agency day vs `soldDay` — and attendance) zero the person's team share;
  `complianceBelowFloor` takes them out of Salesperson of the Month.
- Base pay is left off (with a warning) for someone no longer active.

### API

- `paymentStructures` gains sub-schemas for every part (defaults = none;
  reads still null-guard via `common/payouts/structure-plan.ts`, the one
  mapper the settings page and the worker share). DTO fields are optional
  (left out = none). Overrides' lead sources go through the same
  `assertLeadSources` check as lead-source rates. Start months are kept only
  for members.
- `Agency.payouts.producerOfYear`; `PATCH /payouts/settings` takes it.
- `payStatements.inputs` (Object, null = none entered). New
  `PATCH /payouts/statements/:id/inputs` (`payouts:write`, scoped; 403
  `PAYOUT_STATEMENT_OWN_INPUTS` on one's own without the admin permission;
  409 once sent) saves the four figures whole and **recomputes the one
  statement** against the month's stored split (decision 6 of #171); when the
  person's team or SOM eligibility changed, the statement says to
  recalculate the month. A month recalculation reads every statement's
  figures before splitting the pool and choosing SOM / POY.
- `generateRun` loads the agency's sales by seller × source × carrier
  (`loadAgencySales`) for overrides and agency tiers; December runs pick
  Producer of the Year from `grossByProducer` over the calendar year and the
  year's statements' entered compliance (`run.producerOfYear`; `null` other
  months).
- Run totals gain `netPay` (`$ifNull` to net commission for old statements).
- No migration: every stored field is new and optional.

### Not built (needs sales-pipeline data the app does not record)

- **Life Specialist**: term vs permanent (one "Life" policy type),
  issued-and-paid date and annualized premium, a life-only bonus table, the
  yearly $15,000 milestone, chargebacks clawing back bonuses.
- **Contest premium** excluded from totals (needs a flag on the sale).
- The CRM's yearly profit bonus is a manual adjustment (PAC-182).

### Verification

shared 465 tests (engine 46: 17 new plan scenarios; validators 4 new);
API unit 1,636; API tsc at the 24-error baseline; eslint clean on payouts;
e2e `payouts-comp-plans` 17 (new) + structures / run / import / worker /
onboarding — 127 in all; Bruno Payouts 50/50 (98 tests, 3 new requests).
Web: tsc and `npm run lint` clean (web files keep prettier's defaults —
double quotes; only `packages/api/.prettierrc` is single-quoted). Headless
Chrome on the demo agency, light and dark: Settings → Payouts (Producer of
the Year card, structure summaries), the editor's three steps with every new
part, the Payouts table, and a statement — entering a compliance rate from
the "Entered figures" card saved and recalculated it; saving the structure
from the editor changed nothing but `updatedAt` (lossless round trip). The
check structure was archived and the settings restored afterwards.

### Web (`packages/web/src/features/payouts/`)

- Editor step 1 "Commission rates": per rate "Step up the rate" (basis,
  steps with optional bonus and gates), "Overrides", "Chargebacks" window.
- Step 2 "Pay and bonuses": base pay + stipend months, tier compliance gate,
  agency premium bonus, team requirements (when the structure shares the
  pool), life referrals, compliance floor.
- Step 3 "People": a start month per member while the stipend has months.
- Settings: Producer of the Year card; structure rows summarise the parts.
- Statement: `StatementInputsCard` ("Entered figures", only the needed
  ones; editable with `payouts:write` on a draft or disputed statement, not
  one's own without the admin permission); the breakdown's new lines, notes
  and the **Net pay** banner; "10% · step 1" on carrier lines. Tables, My
  Pay and the run summary show net pay; the run summary names Producer of
  the Year in December.

---

## As built — PAC-181, PR 5 (6–10 Nov 2026)

Branch `awaris/pac-181-commission-statement-pdf-and-sending-render-each-statement`, cut
from the comp-plans branch (#174, `c87e0a6`); PR base = that branch. The stack is #162 ←
#169 ← #171 ← #172 ← #174. Sign-off, disputes and adjustments stay in PAC-182.

**What landed**

- **Dependency.** `pdfkit` **0.20.2** (exact) in `@sfa/api`, `@types/pdfkit` (dev). Webpack
  keeps it external, so its bundled Helvetica AFM metrics load at runtime; no font files.
- **Shared.** `domain/payouts.ts`: `PAYOUT_STATEMENT_NOT_SENT` (409),
  `STATEMENT_HISTORY_OUTCOMES = ['reopened', 'superseded']`, `statementPdfFilename`,
  `PayStatementPdfView` (sha256, size, renderedAt — never the key),
  `StatementHistoryEntryView`, `PayStatementPdfLinkResponse`, `SendAllDraftsResponse`;
  `PayStatementSummary.sentAt`; `PayStatementView.pdf / sentBy / history`. New
  `domain/payout-labels.ts` — `statementReference`, `premiumLineLabel`,
  `complianceLabel`, `somStatusLabel` — moved from the web so the page and the PDF print
  the same words (the web's `payout-format.ts` re-exports them). Notification
  `payouts.statement_sent` (email + push; renderer and fixtures).
- **PDF, `common/payouts/pdf/` (worker-importable).** `statement-pdf-model.ts` is the only
  file that reads the stored statement; it turns it into pre-formatted strings
  (`StatementPdfModel`). `sections/` draws them: header band (logo or name, CONFIDENTIAL),
  statement details, performance indicators, carrier production (Rate column with the
  step, TOTAL row, a note per carrier below its minimum bundle rate), commission summary
  (two columns, NET PAY box), chargeback detail (excluded rows struck through with
  "Left out: …", TOTAL CHARGEBACK IMPACT), producer acknowledgment (empty) and the "Page x
  of y" footer. `table.ts` cuts a table into page-sized chunks and draws each with its
  header. `format.ts` (money, percent, agency-day dates, `winAnsi`), `hash.ts`,
  `read-all.ts`. `render-statement-pdf.ts` returns `{ buffer, pageCount,
  chargebackHeaderPages }`. `common/payouts/statement-sent.ts` builds the notification.
- **Collections.** `payStatements` gains `pdf { key, sha256, size, renderedAt }`,
  `sentAt`, `sentBy`, `sentByName` and `history[] { version, outcome, pdf, sentAt,
  sentBy, sentByName, at }`, all nullable or defaulted. No migration, no new index.
- **Endpoints** (`PayoutsStatementsController`; `StatementIssueService`):

  | Route | Guard | |
  |---|---|---|
  | `POST /payouts/statements/:id/send` | `payouts:write` | draft or disputed → render, store, `sent`, notify; 409 `PAYOUT_STATEMENT_NOT_EDITABLE` / `PAYOUT_RUN_GENERATING` |
  | `POST /payouts/runs/:id/send-all?branchId` | `payouts:write` | every draft the caller may see → `{ sent, skipped, failed[] }` |
  | `POST /payouts/statements/:id/reopen` | `payouts:write` | `sent` → `draft`; 409 `PAYOUT_STATEMENT_NOT_SENT` otherwise |
  | `GET /payouts/statements/:id/pdf?version` | `payouts:read` (visibility rule) | `{ url, filename, expiresIn }`, presigned inline, minted per read |
  | `GET /payouts/statements/:id/pdf-preview` | `payouts:write` | a draft's PDF, streamed (`no-store`), never stored |

  `loadVisibleStatement` moved into `statement-visibility.ts` and is shared by both
  statement services.
- **Recalculation.** `generateRun`'s "drafts of people no longer on a structure"
  delete skips a draft with history: a reopened statement is a record of what was sent.
- **Web.** Statement page: tabs **Statement · PDF · Activity**; the PDF tab shows the
  issued file in a frame (link fetched once per visit, `staleTime: Infinity`, `gcTime:
  0`, so the frame never reloads or mounts an expired link) or, for a reviewer, a draft
  preview from a blob URL; "Open in a new tab"; an **Earlier versions** list.
  "Sent <date> by <name>" under the title. Reviewer actions **Send** (or **Send again**
  for a disputed one) and **Reopen**, each behind a confirmation. Payouts page: **Send
  all drafts**, passing the table's branch filter. The notification stream refreshes the
  statement lists on `payouts.statement_sent`. The breakdown shows Base pay whenever the
  statement carries it, as the PDF does. Statement actions now refresh only the
  statement lists (`payStatementListsKey`), not the open statement's PDF link or preview
  — refreshing those raced the unmount and asked for a link or preview that no longer
  existed.
- **Bruno.** 14 requests (seq 51–64; 64 in the folder) and README rows; the three
  missing rows for **Update Pay Statement Inputs** (#174) were added too. **Send All
  Drafts** sends and notifies every draft of the month, so it runs only when **Generate
  Payout Run** found the month holding the folder's statement alone (it captures
  `payoutsRunStatements`); the cleanup reopen is skipped with it. Found the hard way: on
  a local database with another active structure, an unguarded run sent eleven other
  people's November drafts.

**Decisions taken while building** (state them in the PR)

1. **`version === history.length + 1`, stored.** Reopen pushes `{ outcome: 'reopened' }`
   and `$inc`s `version` in one update, so the reopened draft is "Draft · v2". Sending a
   disputed statement pushes `{ outcome: 'superseded' }` and bumps the version in the
   send. A first send writes no row. PAC-182's reject must not touch `version` or
   `history`.
2. **Each upload gets a unique key** (`buildObjectKey` with its default UUID prefix, the
   statement id in `parts`, `commission-statement-<month>-v<n>.pdf` as the name). The
   plan said `unique: false`; with a shared key, a send that lost a race would delete the
   winner's file when it cleaned up its own upload.
3. **The send is one conditional write** on `{ status, version, computedAt }` of what
   was rendered; a miss removes the upload and is a 409. Sending twice neither stores
   nor notifies twice; a reissued version notifies again (`…:sent:v<n>`, event id
   `deterministicEventId('payouts.statement_sent', '<id>:v<n>')`).
4. **No amounts in the notification** (title names the month; "…has been reissued"
   from v2). The email links to the statement through `TenantUrlService` as every
   notification does.
5. **Reopen** is for a sent statement only; the employee is not told, and the statement
   is a 404 to them again until it is resent.
6. **Preview** is for draft and disputed statements; its Generated Date box reads
   "Draft · not issued".
7. **Logo.** PNG or JPEG up to 2 MB is embedded; SVG, WebP, a missing or unreadable
   file, or one pdfkit refuses falls back to the agency's name, which the band always
   prints. The name is the branded display name, else the agency's name (as the email
   masthead).
8. **Commission summary.** Base pay prints whenever the statement carries it, even
   $0.00; the other 2026 lines print when present and non-zero; NET PAY =
   `statementNetPay`. A statement computed before the 2026 fields prints the original
   grid. Compliance adjustment and other adjustments are tinted as deductions, as in the
   layout.
9. **Carrier production** gains a Rate column ("12% · step 1"); statement warnings
   are not printed (they are the reviewer's), only the bundle-rate notes.
10. **Text** goes through `winAnsi`: Helvetica's metrics cover WinAnsi only, so an
    accent outside it is dropped and anything else prints as `?`.
11. **No Download button** on an issued PDF: the presigned link is cross-origin, so a
    `download` attribute is ignored; "Open in a new tab" opens the browser's viewer,
    which downloads.
12. Send all runs in the request, one statement at a time, and reads the agency and its
    logo once.

**Verified (6–10 Nov):**
- **Tests.** Shared 474 (labels, filename and the notification renderer new); API unit
  1,656 (PDF model 13 and renderer 7 new); e2e `payouts-lifecycle` 24 (new), with
  structures, run, import, comp-plans and the monthly job: 6 suites, 127 tests.
- **Static checks.** API `tsc` at the 24-error baseline, none in touched files; ESLint
  clean on `src/payouts`, `src/common/payouts` and the new e2e; Prettier clean on the
  touched api and shared files with `--config packages/api/.prettierrc`, and on the web
  files with its defaults. `shared/src/notifications/render.ts` and `render.spec.ts`,
  and the web's `use-notification-stream.ts`, already failed `prettier --check` at HEAD
  and were left in their own style. Web `npm run lint` clean. `npm run build -w @sfa/api`
  keeps pdfkit a runtime `require`.
- **Bruno.** Payouts 64/64 (119 tests), twice, against `app.sfa.local:4000` on 6 Nov.
  With the guard on 10 Nov, against a scratch API on `:4100` because the watch servers
  were down: 62 passed, 2 skipped (the guard), 116 tests, twice.
- **PDF.** The renders were rasterised and compared with the two layout screenshots: a
  typical month on one page; 40 chargebacks on two, with the table header repeated and
  "Page 2 of 2"; an excluded row struck through with its note.
- **Headless Chrome.** Demo agency, scratch Vite on `:5180` from 10 Nov, light and dark.
  As owner: the Payouts page; a draft's PDF tab preview ("Draft · not issued"); Send →
  "Sent Nov 6, 2026 by Olivia Smith" and the issued file in the frame; Reopen → "Draft ·
  v2" with Earlier versions; resend as v2; Send all drafts (11 sent) and the button
  disabled at 0 drafts. As producer: My Pay, the PDF tab, no reviewer buttons. At 375px
  there is no horizontal scroll. A reopen and resend made no failing request once
  statement actions refreshed only the lists. The remaining console messages are the
  known `forwardRef` warnings and a missing `favicon.ico`. A 403 from MinIO and 401s in
  one pass came from the machine sleeping mid-run and did not recur.
- **Email.** The dev transport refuses real sends without `MAIL_DEV_ALLOWED_RECIPIENTS`;
  the `payouts.statement_sent` emails were logged only, to `@demoagency.local`.

**Left in the local demo agency** (removing them was refused by the session's
permission check). The "PAC-181 check" structure is archived. Still there: the October
2026 run with its 12 sent statements; 11 sent November statements, one per check member
except Pat Producer; their `payouts.statement_sent` notifications; and their PDFs in
MinIO under `agencies/<demo>/pay-statements/2026/<statementId>/`.

**Review fixes — PAC-181 (10 Nov 2026).** `/code-review` raised 15 findings on the
uncommitted PR; each was reproduced in a test (or, for the web, in headless Chrome) and
all 15 were fixed. None was wrong. Decisions 3 and 12 above are superseded by fixes 4 and
6.

1. **A bad logo no longer crashes the API.** pdfkit decodes a PNG with an alpha channel, a
   transparent palette or interlacing in png-js's `zlib.inflate` **callback**; bad IDAT data
   threw there (uncaught, the process down) and the render promise never settled. New
   `common/payouts/pdf/probe-logo.ts` (`usableLogo`) walks the chunks, inflates the joined
   IDAT synchronously (`maxOutputLength`, at most 32 MB decoded) and checks every filter
   byte — both things png-js throws on; an interlaced or doubtful PNG is refused and the
   name stands in. `drawHeaderBand` calls it, so every caller is covered, and the service
   logs a logo it refuses. `renderStatementPdf` also rejects after 15 s
   (`RENDER_TIMEOUT_MS`) and settles once. The unit test (an RGBA PNG with a valid header
   and broken IDAT) failed on the old code with an uncaught "incorrect header check" and a
   timeout.
2. **The dark-surface logo on the navy band**: `TenantBrandingService.logoKeyFor(agencyId,
   'dark')` (`logoDarkKey ?? logoKey`). `PayoutsModule` imports `TenantBrandingModule` (no
   cycle: it imports only its model and the global `StorageModule`).
3. **One's own statement.** Send, reopen **and recalculate** (the rule widened beyond
   PAC-181) refuse the caller's own statement without `agency:payouts:admin`: 403
   `PAYOUT_STATEMENT_OWN_STATEMENT` (shared), through `assertNotOwnStatement` /
   `issuesOwnStatement` in `statement-visibility.ts` — the predicate `updateInputs` now
   shares, keeping its `PAYOUT_STATEMENT_OWN_INPUTS`. Send all leaves the caller's own
   draft out (`$and: [{ userId: { $ne } }]`). The web hides Recalculate, Send and Reopen
   and says "Someone else recalculates, sends and reopens your own statement."
   (`features/payouts/own-statement.ts`, also used by the inputs card).
4. **A send cannot race new figures.** Send and reopen are conditional on `updatedAt` too.
   Every `payStatements` write is an `updateOne` or `findOneAndUpdate` on a `timestamps:
   true` schema (six sites; no `bulkWrite`, `save` or native write), so `updatedAt` moves
   on each — `updateInputs`' first write included. Its resolution is a millisecond: two
   writes in the same millisecond around the send's read are not told apart (a revision
   counter would close that; not done).
5. **Reopened drafts are kept fresh.** After writing the run, `generateRun` recalculates
   every editable statement of someone who is no longer a recipient — a kept reopened
   draft, or a disputed one — with `recomputeStatement`: the rules it was drafted with,
   the split just stored on the run, and its existing "no longer on a payment structure"
   warning. Chosen over leaving such drafts out of Send all: the statement then always
   holds the month's current figures, and Send all needs no exception.
6. **Send all** reads ids only, then loads, renders, stores and writes each draft four at
   a time (`SEND_ALL_CONCURRENCY`, the existing `mapWithConcurrency`), re-reading each and
   skipping one that is no longer a draft; the log line gives its duration. Measured over
   60 drafts on the e2e database: 385 ms → 210 ms with no storage latency, 5.7 s → 1.4 s
   with an 80 ms upload round trip. A move to an Inngest worker job is **not** done — the
   owner's call.
7. **"It changed", not "already sent".** A missed conditional write re-reads the
   statement: still editable → 409 `PAYOUT_STATEMENT_CHANGED` (shared); a reopen that
   finds it still sent → the same code. The web maps it and `PAYOUT_STATEMENT_NOT_EDITABLE`
   in `payout-errors.ts`, and disables Recalculate while a send or reopen is pending.
8. **Time zone.** The Generated Date is a day in the statement's own `timeZone`, read by
   `statement-pdf-model.ts` (still the only file reading the stored statement), with
   `DEFAULT_AGENCY_TIME_ZONE` as the last fallback; `StatementPdfContext.timeZone` is gone.
   The agency's name comes from `TenantBrandingService.forAgency` (branded display name,
   else the agency's name).
9. The draft preview's "Open in a new tab" has no `download` attribute (it saved a file);
   with no file name left to set, the subheading names the version it will issue ("How
   version 3 will look…", `version + 1` for a disputed one).
10. `apiFetchBlob` throws an `ApiError` with the parsed JSON body, so the preview's 409 shows
    its code's words. `apiFetch`, `apiFetchBlob` and `publicFetch` share `apiErrorFrom`; the
    avatar and the Dash export ignore error details and are unaffected.
11. The `payouts.statement_sent` stream hook invalidates `payStatementListsKey` and
    `payoutRunsKey`, never an open PDF's link.
12. The issued PDF's link query and "Open in a new tab" pass the version on screen.
13. `loadVisibleStatement` takes an inclusion projection (`pdfLink`: month, version, pdf,
    and `history` only when a version is asked for; `reopen`: what its write needs). The
    statements list leaves out `history`. The logo's bytes are cached per agency for 60 s,
    keyed by its storage key — the branding is still read per render, so a new logo shows
    at once and only the download is saved.
14. **Left-out notes show whole.** pdfkit cuts a cell's text with an ellipsis, and the row
    was a fixed 25 pt. `fittedRowHeight` (`table.ts`) sizes a row to its wrapped text with
    `heightOfString` at the column width less padding, at least 25 pt and at most what fits
    under a header on a fresh page (`MAX_ROW_HEIGHT`).
15. Send all's `failed[].message` is always "It could not be sent. Try sending it on its
    own." (`SEND_ALL_FAILED_MESSAGE`); the cause and stack are logged.

**Verified (10 Nov):** shared 474; API unit 1,669 (`probe-logo` 8, renderer 4 and model 1
new); e2e `payouts-lifecycle` 31 (7 new: the send/new-figures race, the dark logo, a
broken PNG, the recalculated reopened draft, and a branch manager's own statement in
their branch — send, recalculate, inputs, Send all, reopen, and all of it with
`agency:payouts:admin`), 5 further runs green; with structures, run, import, comp-plans
and the monthly job: 6 suites, 134 tests. Each new e2e failed with its fix taken out
(race 2, own statement 4, reopened draft 3, dark logo 1). API `tsc` at the 24-error
baseline, none in touched files; ESLint clean on `src/payouts`, `src/common/payouts` and
the e2e; Prettier clean on the touched api and shared files (`--config
packages/api/.prettierrc`) and web files, except `api-client.ts` and
`use-notification-stream.ts`, which already failed at HEAD and keep their style. Web
`npm run lint` clean. Bruno Payouts against the watch API on `:4000`, three times: 62
passed, 2 skipped (the Send-all guard), 116 tests. PDFs rasterised: long notes wrap whole
across three pages with the header repeated. Headless Chrome on the watch Vite (`:5173`),
demo agency, light and dark, 13/13: the preview link opens a tab and names version 17; a
stubbed preview 409 shows its words; the issued PDF asks for `?version=1`; Taylor Nguyen
(branch manager) sees Send and Recalculate on Pat's draft, and neither — with the note —
when the response names them as its owner; no horizontal scroll at 375px. No demo data
was changed by the checks; each Bruno run added two versions to Pat Producer's November
draft, as before (now v17).

**Owner changes — 10 Nov 2026** (uncommitted, on the PAC-181 branch).

1. **Commission is the rate on net premium; no "chargeback commission impact".** The
   statement read as charging a chargeback twice: the carrier table showed premium net of
   chargebacks, then the summary deducted the chargebacks' commission. The math was a
   single deduction (commission on sold premium, less `chargebackImpact`), but the owner
   asked that the chargeback come off the sold premium and the rate apply to what
   remains, with no second line. `computeStatement` now does exactly that, once per line;
   `grossCommission` = `netCommission` on each line and `totals.grossCommission` is the
   lines' commission. `chargebackImpact` and a chargeback row's `commissionDeduction` are
   no longer written (optional in the types). Net pay is unchanged (the rate is linear):
   one rounding per line instead of one per chargeback row, so at most a cent. Every
   existing e2e net pay held (`payouts-run` 1,636.11; the import's 40.55 drop). Tiers,
   rate steps, the team bonus and Salesperson of the Month still use sold premium.
   Readers (web breakdown, statements table, PDF) show "Carrier commission", no impact
   line, and a chargeback detail of premium charged back with "Total charged back". A
   statement calculated before still carries `chargebackImpact` and is shown as it was
   calculated ("Gross carrier commission", the impact line, "Commission deduction",
   "TOTAL CHARGEBACK IMPACT"), so its stored figures still add up; drafts take the new
   shape on their next recalculation. No migration.
2. **Activity rows open the household.** `loadRunInputs` already resolved each sale's
   and chargeback's household and dropped it; it is now carried as `householdId` on
   `PayoutSale` / `PayoutChargeback`, `StatementDealView` and
   `PayoutActivityChargebackView` (also in new statement snapshots). `ActivityPanel` (the
   statement's Activity tab, My Pay, the activity page) makes a row with one clickable
   and Enter-able, to `/clients/:id`, for a viewer with `clients` or `crm_service` read;
   the household page keeps its own branch scope.
3. **Entered adjustments.** `PATCH /payouts/statements/:id/adjustments` with `{ spiffs,
   complianceAdjustment, otherAdjustments }`, each positive or `null`
   (`statementEnteredAdjustmentsError`): SPIFFs added, the two adjustments deducted. Each
   replaces the statement's adjustments of its kind (`spiff`, `compliance`, `manual`) with
   one row, the deductions stored negative — the engine already summed these kinds into
   `totals.spiffs` / `complianceAdjustment` / `otherAdjustments`, and a recalculation
   already kept `adjustments[]`. `exclude_chargeback` rows are never touched.
   `payouts:write` (owner's choice: any reviewer), not one's own without
   `agency:payouts:admin` (403 `PAYOUT_STATEMENT_OWN_STATEMENT`), editable only (409),
   conditional on `updatedAt` (409 `PAYOUT_STATEMENT_CHANGED`), then
   `recomputeStatement`. Web: `StatementAdjustmentsCard` ("Bonuses and adjustments") under
   the entered figures; read-only once sent. PAC-182's per-line adjustments with notes are
   not built; they would use the same rows.

**Verified (10 Nov):** shared 477 (1 engine and 2 adjustment tests new); API unit 1,670
(PDF model 2 new); e2e 6 suites, 139 tests (`payouts-run` household ids; `payouts-comp-plans`
adjustments: signs and net pay, kept through a month recalculation, replaced whole without
touching an exclusion, 400 / 403 / 409; `payouts-lifecycle` own-statement 403). API `tsc` at
the 24-error baseline; ESLint and Prettier clean on touched files; web `npm run lint` clean.
Bruno Payouts twice against the watch API on `:4000`: 68 requests (66 passed, 2 skipped by
the Send-all guard), 124 tests — four new adjustments requests at seq 51–54, the rest moved
up four; the set-then-clear leaves Pat Producer's draft as it was. PDF rasterised: "Carrier
commission" $4,900 equals the carrier table's total, no impact line, chargebacks listed by
premium. Headless Chrome, light and dark, 11/11: no impact line and the card on Pat's
recalculated draft; Alex Rivera's statement sent earlier keeps its impact line and shows the
card read-only; an Activity row opens `/clients/:id` on Enter; no horizontal scroll at 375px.
Nothing was saved from the browser.
