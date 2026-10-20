# PAC-106 — Office Manager audit review (Deal Audits queue + Deal Audit page + send-back + B10)

Ticket: https://linear.app/paciscigroup/issue/PAC-106 · Repo: `AIOS-SFA` (`api/` = `packages/api/src`, `web/` = `packages/web/src`, `shared/` = `packages/shared/src`). This document is the approved plan (19 Oct 2026); what changed while building it is in **§9. As built** at the end.

## Context

PAC-72 built the **producer side** of deal audits: one card per deal on the Producer Dashboard
(`web/features/producer/components/DealsAuditBoard.tsx`), a drawer to upload evidence and resolve
items (`ResolvePanel.tsx`), and the workflow API — assignee/reviewer, `submit`, `review`
(`approve | request_changes | send_back`), notes (`api/deal-audits/`). PAC-139 shipped the Manager
view with an **Aging Audits** card whose rows still link to `/clients/:householdId` "until PAC-106".

What is missing is the **manager side** David specified across the 20/21/24/25 Aug and 22 Sep scrums:
"The producer doesn't have the final say … the manager is reviewing the documentation and if it's not
correct they send it back. The manager is the gatekeeper." Concretely:

1. A **Deal Audits** nav link (management roles only) → a queue: one row per deal, Producer · Client ·
   Days sitting (aging = open > 5 business days from sold date) · Status · **Perform audit**.
2. A **Deal Audit page** (a page, not a drawer — David rejected the drawer twice): quote information
   (+ "View quote recap" drawer), "View lead" drawer, sold policies with "View new business
   application" drawer (NBA PDF with sold date and effective date beside it), the full checklist with
   per-item **Pass / Fail + note + evidence**, running passed/failed/remaining counts, **Approve** /
   **Send back**.
3. **Producer-visible vs manager-only items**: the producer's drawer shows only the items that need
   their input; the manager sees everything. Driven by per-template flags, not hard-coded in the UI.
4. **Send-back loop**: failed items reopen on the producer's board with a notification and a visible
   "sent back by <manager> — <note>" marker; the producer fixes, resubmits → Pending.
5. **B10** (PAC-72 split it out, never ticketed): a sent-back deal shows **red** on the producer board
   with a **Fix it** action opening the existing Edit Sold Deal page (`/sold/:id/edit`).

Gaps confirmed in code: no per-item reviewer verdict or note (`DealAuditItem` has only the producer's
`isResolved` / `notes`); no `producerVisible` / `requiresUpload` flag anywhere; no reviewer-scoped
queue (`GET /deal-audits` is assignee-scoped and lists only `openFailedCount > 0`); `review()` touches
no items, checks no manager permission, emits no notification; no NBA download endpoint
(`Policy.newBusinessApplication` is write-only); Branch Manager holds **no** `quote_recaps:*`, so the
existing recap-document route is unusable from the manager page; no lead / quote-recap / document
drawers exist on the web. The legacy `./SFA` checkout is **not on disk** — the page is built from the
ticket's layout description.

## Decisions (D1–D7 settled 19 Oct with Abu Bakar; D8–D17 are this plan's design calls — raise at review if wrong)

| # | Topic | Decision |
|---|---|---|
| D1 | **Approve gate** | Approve only when **every** item has reviewer verdict `pass`. API 409 with the unmet item list; UI disables the button and lists what is left. An item that does not apply → `pass` with a note. |
| D2 | **Review timing** | Item verdicts / Approve / Send back only while `auditStatus === 'Pending'` (keep `canReviewAudit`). The queue still lists Not Submitted / Fail audits (aging must be visible) with actions disabled and a "waiting for producer" hint. An audit generated with **zero producer-visible items is auto-submitted** to `Pending` (`submittedById: null` = system). |
| D3 | **Reuse PAC-72** | Extend Asad's board, drawer, workflow panel, API client, `review`/`submit`/`assign`/notes endpoints, `syncAuditCounters`, `buildScopeFilter` — never rebuild. Where behaviour changes, the exact lines are named below. |
| D4 | **Aging clock** | Business days since **sold date** (PAC-139 D2) via `api/common/dates/business-days.ts` + `MANAGEMENT_AUDIT_SLA_BUSINESS_DAYS = 5`; the queue reuses `agingAuditsPrefix` without the cutoff. |
| D5 | **Manager gate** | "Management roles only" = holds **both** `deal_audits:*` and `management:read`. `@RequirePermissions(a, b)` is an AND-set and handler-level metadata overrides class-level (`common/guards/permissions.guard.ts:24-56`); web uses `canAll`. Never a role name (AGENTS.md §7). Branch Manager template already holds both. |
| D6 | **Out of scope** | Deleting audits created before 31 Aug 2026 (Asad's 10 Sep comment — own ticket); `audit.submitted` notification (PAC-127); pagination/sort/search on the producer board; branch entity (PAC-90); the legacy page's "top card". |
| D7 | **Notification** | Only `audit.sent_back` → the audit assignee (role assignee → every active user holding the role, via `RoleAssignmentsService.roleUserIds`). Channels `{ email: true, push: true }`; href `/dashboard/producer?audit=<dealId>`. |
| D8 | **"Send back" = `request_changes` → `Fail`** | The page's Send back posts `decision: 'request_changes'`. `Fail` is what the board paints red, `canSubmitAudit('Fail')` is already the resubmit loop, `audit_changes_requested` exists. `send_back` → `Not Submitted` stays in the API, not surfaced on the new page. |
| D9 | **Verdict `pass` ⇒ `isResolved: true`** | The manager's verification is the stronger fact, and it is the only way a manager-only item ever closes — otherwise `openFailedCount` never reaches 0 on approve and PAC-139's "Open Audit Items" stays wrong forever. `fail` leaves `isResolved` alone until send-back. |
| D10 | **Resubmit keeps `pass`, clears `fail`** | `submit` nulls verdict/note/reviewedAt/By on items with `fail` and clears `sentBack`. Passed items were verified against evidence that did not change; the manager can still flip them. |
| D11 | **Producer-actionable item** = `producerVisible !== false` **OR** `reviewVerdict === 'fail'` | A failed manager-only item (e.g. *Correct Sold Date*) carries the manager's note and the Fix-it action, so the producer must see it. One shared helper `isProducerActionable()`; its Mongo `$expr` twin is unit-tested equal. |
| D12 | **Producer board predicate** = `auditStatus ∈ {Not Submitted, Fail}` **AND** `producerItemCount > 0` | Replaces `openFailedCount > 0`. A sent-back audit stays visible after the producer resolves everything (today the card vanishes before Submit can be clicked, a real PAC-72 bug); a **Pending** audit leaves the board (it is with the manager — nothing for the producer to do); auto-submitted zero-producer-item audits never appear. Three new `DealAudit` counters: `producerItemCount`, `producerResolvedCount`, `producerOpenCount`. |
| D13 | **Edit-sale lock relaxes** | `addPoliciesBlock` blocks `Pass`, and `Pending` **with a human submitter**. `Fail` (Fix it needs it) and system-submitted `Pending` are allowed; new items arrive with no verdict so D1 forces review. Changes PAC-104's "block once submitted" — listed for David. |
| D14 | **Documents the manager views go through routes they can reach** | NBA: `GET /policies/:id/new-business-application/download` (PoliciesController gate is `deal_audits:read OR crm_service:read`). Quote recap document: `GET /deal-audits/deals/:dealId/quote-recap/document/download`, resolving the recap by `deal.quoteRecapId`, else the lead's latest recap before the sale (`common/sales-metrics/quote-conversion.ts` `resolveQuoteConversions`). |
| D15 | **Send-back needs ≥1 failed item and a note** | 409 without a failed verdict; `reviewAuditSchema` requires `notes` for `request_changes`, `reasonCodes` become optional. The note is the marker text and the notification body. |
| D16 | **Existing data** | A migration backfills template flags by name, item flags via `templateId` (fallback normalised `itemName`), recomputes the producer counters, and flips `Not Submitted` audits with `producerItemCount === 0` to `Pending` (`submittedById: null`). Rehearse on the local prod dump and report the flip count before merging. |
| D17 | **Where flags live** | On `auditTemplates` + copied onto each `dealAuditItems` row at generation (reads never join templates). `audit-titles.ts` is untouched — it computes *which* titles apply, not who sees them. |

---

## 1. Shared (`packages/shared`) — build first (`npm run build -w @sfa/shared`)

**New `src/domain/deal-audit-review.ts`** (export from `src/index.ts` beside `deal-audit`):
- `AUDIT_ITEM_VERDICTS = ['pass','fail'] as const`, `AuditItemVerdict`.
- `AuditItemReviewView { verdict: AuditItemVerdict | null; note; reviewedAt; reviewedByName }`.
- `DealAuditSentBackView { at; byName; note; failedItemCount }`.
- `DEAL_AUDIT_QUEUE_STATUSES = ['open','not_submitted','pending','fail','pass','all']` (`open` = default = not Pass) + status map.
- `DealAuditQueueRow { dealAuditId, dealId, householdId, clientName, producerId/Name, assigneeId/Name, auditStatus, soldDate, businessDaysOpen, aging, itemCount, passedCount, failedCount, remainingCount, producerOpenCount, submittedAt, sentBack, canReview }` (same identity fields as `AgingAuditRow`); `DealAuditQueueResponse { page, pageSize, total, totalPages, items }`.
- `DealAuditReviewItem { id, itemName, category, subjectName, policyId, producerVisible, requiresUpload, open, isResolved, resolvedAt, producerNote, attachments[{index, filename, contentType, size, uploadedAt}], review }`.
- `DealAuditReviewPolicy { id, policyNumber, policyType, carrier, premium, effectiveDate, newBusinessApplication: meta | null }`; `DealAuditReviewQuoteRecap { id, quoteDate, premium, itemCount, productsQuoted, policies[{policyType, premium, itemCount}], hasDocument, producerName }`; `DealAuditReviewLead { id, name, status, temperature, leadSourceName, createdDate, producerName, phone, email }`.
- `DealAuditReviewView { audit: AuditWorkflowView & { sentBack; canApprove; canSendBack; unmet[{id,itemName}]; counts{passed,failed,remaining} }; deal{ id, clientName, householdId, householdName, leadId, soldDate, dealType, policyTypes, premium, producerId, producerName, businessDaysOpen, aging }; policies; quoteRecap | null; lead | null; items }`.
- Pure helpers + `deal-audit-review.spec.ts`: `isProducerActionable(item)`, `approveBlockers(items)` (API 409 body and web disabled-button share one rule), `reviewCounts(items)`.

**`src/domain/deal-audit.ts`**: move `AuditWorkflowView` here from `api/deal-audits/deal-audits.types.ts:145-173` (web hand-mirrors it in `lib/deal-audits-api.ts:131-156`) — optional tidy-up, do it in PR1 if cheap.

**`src/notifications/catalog.ts:47-61`**: `'audit.sent_back': { category: 'audits', defaultChannels: { email: true, push: true } }`, `data: { dealId, dealAuditId, clientName, reviewerName, note, failedItemCount }`. **`render.ts:38-50`**: title "Audit sent back", body `"<reviewer> sent back <client>'s audit: <note>"` (fallbacks), href `/dashboard/producer?audit=${dealId}`. **`render.spec.ts`**: fixture (parity test fails otherwise).

---

## 2. API (`packages/api`)

### 2.1 Schemas
- `audit-templates/schemas/audit-template.schema.ts:16-35`: `producerVisible: boolean (default true)`, `requiresUpload: boolean (default false)`.
- `deal-audit-items/schemas/deal-audit-item.schema.ts`: after `applicable` (`:131`) the same two flags; after `resolvedById` (`:185`) `reviewVerdict: 'pass'|'fail'|null` (`type: String, enum, default null`), `reviewNote?`, `reviewedAt?`, `reviewedById?` (ref User). Docblock: producer's `isResolved/notes` = *claimed*, reviewer's `reviewVerdict/reviewNote` = *verified*; never collapse them.
- `deal-audits/schemas/deal-audit.schema.ts`: sub-schema `AuditSentBack { at, byId, note?, failedItemCount }` → `sentBack` (default null); counters `producerItemCount`, `producerResolvedCount`, `producerOpenCount` beside `openFailedCount` (`:155-157`); `submittedById` docblock: null while Pending = system auto-submit. Rewrite the "deliberately unindexed" note (`:78-85`). **New index** (new key pattern → `autoIndex`, no migration): `{ agencyId, 'auditAssignee.id', auditStatus, oldestOpenAt, producerItemCount }`. Note that the two `…openFailedCount` indexes (`:209-222`) are now dead and are dropped in a later cleanup migration, not edited here (house rule); the `due` filter is a secondary predicate on the already-narrow set.

### 2.2 Templates + generation
- `seed/audit-templates.seed.ts`: `CoreAuditTemplateSpec` (`:33-56`) gains both flags; `CORE_AUDIT_TEMPLATES` (`:58-254`) per David's table — **manager-only** (`false/false`): Correct Sold Date, Correct Effective Date, Quote Recap, Lead Manager, Evidence of Insurance, Drivers Verified · **visible + upload** (`true/true`): Good Student, Prior Insurance, Accord Cancellation, Defensive Driver, Home/Landlord Fire Subscription, Home/Landlord Hail Resistant Roof · **visible, yes/no** (`true/false`): Home/Landlord Inspection, Actual Cash Value, Mortgagee. `seedAuditTemplates` `$set` (`:277-283`) adds both flags (`active` still untouched).
- `audit-generation/audit-generation.service.ts`: lean projection (`:134-145`) and `buildItem` template param (`:277-283`) carry the flags; `buildItem` writes `producerVisible`, `requiresUpload`, `reviewVerdict: null` into `$setOnInsert`.
- **Auto-submit** (D2) after `syncAuditCounters` (`:223-239`): if `parent.auditStatus === 'Not Submitted' && counters.producerItemCount === 0` → `updateOne({_id, auditStatus:'Not Submitted'}, {$set:{auditStatus:'Pending', submittedAt: now, submittedById: null}})` + `audit_submitted` activity (no `userId`, summary "Submitted automatically — no producer items"); stamp `Deal.dealAuditStatus` from the re-read parent. Status-guarded so a PAC-104 re-run never re-submits.

### 2.3 Counters — `deal-audits/audit-counters.ts`
Extend `AuditCounters` (`:16-22`) with the three producer counters; `$group` (`:70-94`) adds `IS_PRODUCER_ACTIONABLE = {$or:[{$ne:['$producerVisible',false]},{$eq:['$reviewVerdict','fail']}]}` and the three sums. `audit-counters.unit-spec.ts`: table test that the `$expr` and shared `isProducerActionable()` agree on the 2×2×2 grid.

### 2.4 Service — `deal-audits/deal-audits.service.ts`
- `private assertReviewer(access, audit)`: 403 unless `access.permissions` holds `management:read` **and** `audit.submittedById?.toString() !== access.userId`. `toWorkflowView` (`:954-956`): `canReview = canReviewAudit(status) && hasManagementRead && notSubmitter` — so the producer drawer stops offering review without knowing why.
- **`setItemVerdict(access, branchId, itemId, dto)`** (new): load item (no `own` producer arm) → `loadAuditForDeal(item.dealId)` → 409 unless Pending → `assertReviewer`. Idempotent: writes `reviewVerdict, reviewNote (undefined keeps), reviewedAt, reviewedById`; `pass` ⇒ `isResolved: true` + `updateStatus/Label` as `resolveItem` does (`resolvedAt` only if unset, `resolvedById` untouched); `null` clears the four review fields. `syncAuditCounters`. Returns `{ item, counts, canApprove, unmet }`.
- **`review`** (`:716-768`): after existing checks → `assertReviewer`; load items. `approve`: `approveBlockers(items)` non-empty ⇒ `ConflictException({ message, unmet })`. `request_changes`: no `fail` verdict ⇒ 409; else `updateMany({dealAuditId, reviewVerdict:'fail'}, {$set:{isResolved:false, updateStatus:'in_progress', updateStatusLabel:'In Progress'}, $unset:{resolvedAt, resolvedById}})`, `audit.sentBack = {at, byId, note, failedItemCount}`, `syncAuditCounters`, activity summary `Sent back: <note>`, then `notifySentBack`. `send_back` unchanged.
- **`notifySentBack`** (pattern `bug-reports/bug-reports.service.ts:154-190`): recipients = user assignee → `[id]`, role assignee → `roleUserIds(id)` (`permissions/role-assignments.service.ts:287`; `DealAuditsModule` imports `PermissionsModule`), filtered active, minus the actor; skip when empty; `inngest.send(notificationRequested, { type:'audit.sent_back', recipientIds, agencyId, actorId, entity:{kind:'dealAudit', id}, data, dedupeKey:`audit.sent_back:${auditId}:${at.getTime()}` })` in try/catch.
- **`submit`** (`:686-710`): `$set sentBack: null`; `updateMany({dealAuditId, reviewVerdict:'fail'}, {$set:{reviewVerdict:null}, $unset:{reviewNote,reviewedAt,reviewedById}})` (D10); `syncAuditCounters`.
- **`resolveItem`** (`:430-533`): after the one-shot guard, `if (item.requiresUpload && !dto.attachment && !item.attachments.length) throw BadRequest('This requirement needs a document.')`.
- **`listPendingHandoff`** (`:181-195`): filter → `auditStatus: {$in:['Not Submitted','Fail']}, producerItemCount: {$gt:0}` (+ due filter). Row (`:219-242`): `itemCount: producerItemCount`, `openCount: producerOpenCount`, `completionPct` from producer counters, new `sentBack` (name via `resolveUserNames`), `readyToSubmit: producerOpenCount === 0`. **`loadChecklists`** (`:270-275`): add `$or:[{producerVisible:{$ne:false}},{reviewVerdict:'fail'}]`, project review fields; `DealAuditItemRow` (`deal-audits.types.ts:32-59`) gains `requiresUpload`, `managerOnly`, `review`. Sort: open first, then `fail` verdict first, then oldest.
- **`listReviewQueue(access, branchId, query)`** (new): move `agingAuditsPrefix` (`management-dashboard.pipelines.ts:126-176`) to `common/deal-audits/audit-queue-pipelines.ts` as `dealAuditQueuePrefix(match, { auditStatuses, project, ownerPin })`, leaving `agingAuditsPrefix` as a thin wrapper (unit spec moves too). Match = `buildScopeFilter<Deal>(access, branchId) + NEW_BUSINESS_MATCH`, no window; under `own` scope pin `_audit.auditReviewer.id ∈ [me, …roleIds]`. Lookup `$match` on requested statuses (default `$ne 'Pass'`), project `auditStatus, openFailedCount, itemCount, producerOpenCount, submittedAt, submittedById, sentBack, auditAssignee`. Sort `{ soldDate: 1, _id: 1 }` (= days sitting desc), `pagedFacet`. In Node: `businessDaysOpen = businessDaysBetween(zonedDate(soldDate, tz), zonedDate(now, tz))`, `aging` via `agingCutoff(today, 5)`; verdict counts by one `$in` read over `dealAuditItems` grouped by `dealAuditId`; names via `displayNamesFor`. Rides `{agencyId, soldDate:-1}` / `{agencyId, producerId, soldDate:-1}`.
- **`getReviewView(access, branchId, dealId)`** (new): `loadAuditForDeal` → `Promise.all`: deal fields, household name, policies `find({dealId, agencyId, isTestRecord:{$ne:true}})` with NBA **metadata only** (never the key), quote recap via D14, lead summary (name/status/temperature/`leadSourceId → LeadSourcesService.labelsFor`/createdDate/producer; phone+email through `household.primaryContactId`), all items sorted category → name, names. `canApprove/unmet/counts` from shared helpers; `canSendBack = canReview && failed > 0`.
- **`getQuoteRecapDocumentUrl(access, branchId, dealId)`** (new): D14 resolution → 404 when no document → `storage.createPresignedDownload(key, {disposition:'inline', filename, contentType})` → `{ downloadUrl, filename, contentType, expiresIn }` (same shape as `quote-recaps.service.ts:347`).

### 2.5 Controllers
`deal-audits/deal-audits.controller.ts` — keep class gates (`:42-44`); add **above** the `:itemId` routes (`:136`), with the usual ordering note:

| Route | Decorators | Body / query |
|---|---|---|
| `GET deal-audits/queue` | `@RequirePermissions(deal_audits:read, management:read)` | `listDealAuditQueueSchema { status (default 'open'), page (1), pageSize (25, max 100) }` |
| `GET deal-audits/deals/:dealId/review` | same | — |
| `GET deal-audits/deals/:dealId/quote-recap/document/download` | same | — |
| `POST deal-audits/deals/:dealId/review` (`:102`, existing) | **change to** `@RequirePermissions(deal_audits:write, management:read)` | `reviewAuditSchema`: drop the reason-code refine; `.refine(v => v.decision !== 'request_changes' \|\| notes.trim().length > 0, { path:['notes'] })` |
| `PATCH deal-audits/:itemId/verdict` | `@RequirePermissions(deal_audits:write, management:read)` | `setItemVerdictSchema { verdict: enum.nullable(), note: string.trim().max(2000).optional() }` |

`policies/policies.controller.ts`: `@Get(':id/new-business-application/download')` after `check` (`:73`), inherits the OR gate; `policies.service.ts` `getNbaDownload` → `loadOwnedPolicy` (`:628`) → 404 when absent → inline presigned URL.

### 2.6 Sold deals — `sold-deals/sold-deals.service.ts`
`loadAuditStatus` (`:823-838`) also returns `submittedById`; `addPoliciesBlock` (`:840-849`) blocks `Pass`, or `Pending && submittedById != null` (D13); reword `ADD_POLICIES_BLOCK_MESSAGES.audit_submitted` (`:105-108`), the `SoldDealAddPoliciesBlock` docblock (`shared/src/domain/sold-deal.ts:470-476`) and `EditSoldDealPage.tsx:50-57` copy. Confirm `updateSoldDeal` (sold date) is not blocked on a `Fail` audit — Fix it needs both.

### 2.7 Migrations (`npm run db:migrate:create -- …`, `api:dev` stopped; raw `db`, constants copied in, idempotent, logged counts; model: `migrations/20260923185801-management_read_for_branch_managers.js`)
1. `audit_template_review_flags`: `auditTemplates` lacking `producerVisible` get both flags from a name→flags table (normalised name); unknown names `true/false`. `down`: `$unset`.
2. `audit_item_review_flags_and_producer_counters`: (a) per agency, `templateId → flags` and `normalizedName → flags` maps; `dealAuditItems` lacking `producerVisible` get flags via `templateId`, else `itemName` (strip trailing ` — <subject>`), else defaults; `$set reviewVerdict: null` where missing. (b) aggregate items by `dealAuditId` with the §2.3 expressions and `$set` the three counters on `dealAudits` (0 when no items). (c) `dealAudits {auditStatus:'Not Submitted', producerItemCount: 0}` → `$set auditStatus:'Pending', submittedAt: now, submittedById: null` + mirror `deals.dealAuditStatus`; **log the count** (D16). `down`: unset flags/counters; the status flip is documented as irreversible.

### 2.8 Bruno (`bruno/Deal Audits/`, `bruno/Policies/`)
- `Login as Reviewer.bru` → `manager@demoagency.local` (branch manager = the persona); assert both permissions in the login body.
- New: `List Review Queue.bru` (captures `reviewDealId` from the first Pending row), `Get Deal Audit Review.bru` (captures `reviewItemId`), `Set Item Verdict.bru`, `Set Item Verdict (Fail).bru`, `Approve Blocked.bru` (409 + `unmet`), `Send Back Audit.bru` (request_changes + note → `Fail`, `sentBack.note`), `Download Quote Recap Document.bru`, `Policies/Download New Business Application.bru`, `Review Queue (Forbidden for Producer).bru`, `Set Item Verdict (Forbidden for Producer).bru`.
- Update docs: `Review Audit.bru` (gate, D1/D15, 409 body), `List Deal Audits.bru` (new predicate, `sentBack`, `readyToSubmit`, filtered items), `Resolve Deal Audit Item.bru` (400 on `requiresUpload` without file), `Submit Audit For Review.bru` (clears `sentBack`, resets failed verdicts); `bruno/README.md` rows; `collection.bru` folder blurb.

### 2.9 Tests
- **Unit**: `shared/src/domain/deal-audit-review.spec.ts`; `audit-counters.unit-spec.ts` (`$expr` ↔ helper parity); `common/deal-audits/audit-queue-pipelines.unit-spec.ts` (default `$ne Pass`, explicit statuses, reviewer pin); `deal-audits/dto/review-audit.dto.unit-spec.ts`; `render.spec.ts` fixture.
- **e2e — new `test/deal-audit-review.e2e-spec.ts`** (pattern `test/management-dashboard.e2e-spec.ts`; create a branch-manager user in-spec; `CapturedInngestService` for the event): queue 403 for producer and CSR; manager sees own branch, owner both; default excludes Pass; `status=pending`; `businessDaysOpen`/`aging` at 4 vs 6 business days (`addBusinessDays`); auto-submit when every item is manager-only (`submittedById` null, Pending, on the queue, **not** on the producer board); producer cannot set a verdict (403); `pass` resolves the item and moves counts; approve 409 lists `unmet`, then passes after all pass; send back without a failed item → 409; send back with fail + note → `Fail`, item reopened, `sentBack` stamped, one `notification/requested.v1` with `type:'audit.sent_back'`, recipient = assignee, stable dedupeKey; role assignee → role's users; resubmit clears `sentBack`, nulls the failed verdict, keeps the passed one; `requiresUpload` resolve without file → 400; NBA download 404/200 (storage stubbed as the quote-recap tests do); quote-recap document route; edit sale allowed on `Fail` and system-Pending, blocked on human-Pending and Pass.
- **Existing `test/api.e2e-spec.ts:12226+` must change fixture**: `autoPolicy` (`:11995`) yields only manager-only items, so those audits now **auto-submit**. Add `autoPolicyWithStudentDiscount()` (a producer-visible `Good Student`) and use it in 'starts Not Submitted…', 'submits, then the reviewer approves' (pass every item first; reviewer = owner), 'requires a reason code…' → 'requires a failed item and a note', 'clears reason codes…', 'surfaces the generated items on the hand-off board' (`:12583`), 'tracks completion…' (`:12656`, producer counters), and the 'workflow state' block (`canReview` false for the producer).

---

## 3. Web (`packages/web/src`) — compose `ui/` primitives, `theme.css` tokens only, light + dark, `TYPOGRAPHY.md`, `NOT_AVAILABLE` for missing values

1. **Permissions, nav, routes.** `components/layout/nav-items.ts:18-34` add `allOf?: string[]`; `SidebarBody.tsx` `isVisible` (~`:218`) checks `canAll(item.allOf)`. Management section (`:79-102`): `{ to:'/deal-audits', label:'Deal Audits', icon: ClipboardCheck, allOf:[deal_audits:read, management:read] }`. `app/App.tsx`: `<RequirePermission permission={management:read} anyOf={[deal_audits:read, deal_audits:write]} />` (both props compose) wrapping lazy `/deal-audits` → `DealAuditsQueuePage` and `/deal-audits/:dealId` → `DealAuditPage`.
2. **API client.** `lib/deal-audits-api.ts`: import shared types instead of the mirrors (`:14-60`, `:131-156`); add `dealAuditQueueKey(status, page)`, `dealAuditReviewKey(dealId)`, `listDealAuditQueue`, `getDealAuditReview`, `setAuditItemVerdict`, `getQuoteRecapDocumentUrl`; `reviewAudit` typing requires `notes` on `request_changes`. `lib/policies-api.ts`: `getNbaDocumentUrl(policyId)`. `ApiError` (`lib/api-client.ts`) must expose the 409 body for `unmet`.
3. **New `features/deal-audits/`** (page shell like `EditSoldDealPage`: `AppShell` + `MobileNav` header):
   - `DealAuditsQueuePage.tsx` + `useDealAuditsUrlState.ts` (`useUrlState`: `status`, `page`); `components/QueueStatusChips.tsx` (All open · Not Submitted · Pending · Sent back · Approved); `components/DealAuditQueueTable.tsx` in `DataPanel` — **Producer · Client · Days sitting · Status · action**; Days sitting = `businessDaysOpen`, aging rows in the red pair (`text-red-600 dark:text-red-400`, the only red in the palette — `features/household/components/policy-display.ts:97`) + "aging" `Badge`; status `Badge` via `components/review-display.ts` (lift `STATUS_STYLES` from `AuditWorkflowPanel.tsx:51-56`); action **Perform audit** (`Link` → `/deal-audits/:dealId`) when `Pending`, else "Waiting for producer" / "Sent back" text + **Open** ghost; `TablePagination`; `placeholderData: keepPreviousData`; mobile cards under `lg:hidden`.
   - `DealAuditPage.tsx`: `useQuery(dealAuditReviewKey)`; 60/40 split — left: `QuoteInfoCard` (quoted lines, premium, "Quote recap on file"/"No quote recap"; **View quote recap**, **View lead** buttons), `SoldPoliciesCard` (number · type · carrier · effective date · **View new business application** / "No NBA on file"), `ReviewChecklist`; right (sticky): `ReviewSummaryBar` (passed / failed / remaining, `Progress`, **Approve** disabled unless `canApprove` with tooltip listing `unmet`, **Send back** disabled unless `canSendBack`, "waiting for producer" hint when not Pending) + `AuditWorkflowPanel` (ownership + thread only).
   - `components/ChecklistItemRow.tsx`: name · category · subject; **Pass / Fail** segmented control (`npx shadcn@latest add toggle-group`, single-select); reviewer note `Textarea` saved on blur; evidence via `EvidenceBlock` **extracted** from `ResolvePanel.tsx:87-155` into `features/deal-audits/components/EvidenceBlock.tsx` and re-imported by `ResolvePanel`; hint "No document — mark Fail, or Pass with a note" when `requiresUpload && !attachments.length`; producer note; "Passed by X · date". `useMutation(setAuditItemVerdict)` → `setQueryData` on the review key, invalidate `['deal-audits']` + `managementDashboardKey`.
   - `components/ReviewDecisionDialog.tsx` (`AlertDialog`): Approve (optional note) / Send back (failed items list, **required** note → `request_changes`); on success `toast`, invalidate `['deal-audits']`, `managementDashboardKey`, `['audit-workflow', dealId]`, `['audit-notes', dealId]`, navigate to `/deal-audits`.
   - `drawers/LeadDrawer.tsx` (Sheet 440px; `DrawerRow/DrawerSection/DrawerSkeleton/DrawerError` from `features/clients/components/drawer-primitives.tsx`; `statusBadgeClass` from `lead-display.ts`; "Open lead" → `/leads/:id` gated `canRead(Leads)`), `drawers/QuoteRecapDrawer.tsx` (totals/lines/notes from the payload; "View quote document" → `openDocumentInNewTab(() => getQuoteRecapDocumentUrl(dealId))`), `drawers/NbaDocumentDrawer.tsx` (wider `sm:max-w-3xl`; header `DrawerRow`s **Sold date** + **Effective date**; `<iframe>` on the presigned URL fetched on open — PDF-only, inline-signed; "Open in new tab" fallback).
4. **Producer side (Asad's work — change, don't rebuild).**
   - `AuditWorkflowPanel.tsx`: delete review state (`:108-110`), `reviewMutation` (`:154-163`), the Approve/Changes/Undo row (`:348-380`), the request-changes form (`:388-459`); keep Submit, pickers, thread. Replace the `Fail` reason-code block (`:309-320`) with a **sent-back banner** ("Sent back by {name} · {date} — {note}", from the row's `sentBack` prop) + **Fix it** `Button` (`canWrite('deal_audits')`) → `/sold/${dealId}/edit`.
   - `DealsAuditBoard.tsx` `DealCard` (`:53-193`): when `auditStatus === 'Fail'` → red pair border/badge (`border-red-500/30 bg-red-500/8`), chip "Sent back", second **Fix it** outline button beside **Review** (both `stopPropagation`); "X of Y outstanding" (`:150-166`) reads producer counters (API change) and shows "Ready to submit" when `readyToSubmit`. Read `?audit=<dealId>` via `useUrlState` and open `ResolvePanel` for that row (D7 href). `handleResolved` (`:250-299`): a card no longer leaves at `openCount === 0` (D12) — drop the `continue` at `:269`.
   - `ResolvePanel.tsx`: sent-back banner under the progress line; `RequirementRow` shows `review.note` ("Manager: …", red pair) when verdict `fail`, "Manager-only — reopened" sub-label when `managerOnly`; `requiresUpload` makes the upload mandatory (disable **Mark resolved** until a file is picked; drop "(optional)"); yes/no items keep note-only resolve.
5. **Management links.** `features/management/components/AlertDrawer.tsx:240-281` `AgingAuditItem` and `ProducerDrawer.tsx:206-232` `OpenItem`: `to = canAll([deal_audits:read, management:read]) ? /deal-audits/${dealId} : (householdId && canRead(Clients) ? /clients/${householdId} : null)`; drop the "coming with PAC-106" tooltip text and the docblock notes (`AlertDrawer.tsx:43-57`, `ProducerDrawer.tsx:51`).

## 4. Demo seed (`api/seed/demo/demo-seed.service.ts`)
- `seedDealAudits` (`:1333`): reviewer = the branch manager (`manager@demoagency.local`), not a CRM (CRM can no longer review).
- `seedDealAuditItems` (`:1244-1320`): write `producerVisible`/`requiresUpload`/`reviewVerdict: null` from `CORE_AUDIT_TEMPLATES`; resolved items on Pass audits get `reviewVerdict:'pass'`.
- `settleAuditStatuses` (`:1393-1440`): Pending audits get `submittedAt/submittedById`, and at least one producer-visible item resolved with a `notes` text so the page has something to show (the seed writes nothing to object storage — attachments stay empty, documented). Append a deterministic final step (RNG draw order untouched, like PAC-139's fixtures): one **sent-back** audit (`Fail`, one item `fail` + `reviewNote`, `isResolved:false`, `sentBack`), one all-manager-only audit (`Pending`, `submittedById: null`). `reconcileDealAudits` recomputes counters (it calls `syncAuditCounters`).

## 5. Docs
- `docs/SESSION-HANDOFF.md` → **§25. PAC-106 — Deal Audits review (manager side)**: D8–D17, the migration flip count, the e2e fixture change (a plain auto policy now auto-submits), the `addPoliciesBlock` relaxation, the `agingAuditsPrefix` move.
- `AGENTS.md` §2 (Deal Audits page live) and §11: "an audit item has two truths — the producer's `isResolved` (claimed) and the reviewer's `reviewVerdict` (verified); never collapse them"; "`@RequirePermissions(a, b)` is the AND gate for management-only mutations; `management:read` is the capability, never a role name".
- `docs/plans/pac-106-deal-audit-review-implementation-plan.md` = this document.

## 6. Verification
1. `npm run build -w @sfa/shared` → `npm run lint -w @sfa/api` → `npm run lint -w @sfa/web` → `npm run build -w @sfa/web`.
2. With `api:dev` stopped: `npm run test:unit -w @sfa/api`; `npm run test:e2e -w @sfa/api` (whole suite — shared DB).
3. Migration rehearsal on the local prod dump only: `db:migrate:status` → `db:migrate` → check `auditTemplates` flags, `dealAuditItems {producerVisible:{$exists:false}}` = 0, `dealAudits` producer counters, **count flipped to Pending** → `db:migrate:down` → up again. Never against production.
4. `npm run api:seed:demo:dev`, start `api:dev` (watch the migration log lines), `cd bruno && npx @usebruno/cli run --env Local` twice (idempotent).
5. Browser, light + dark, 375px. **Manager** (`manager@demoagency.local`): nav shows **Deal Audits**; queue default hides Pass; chips filter; aging rows red; **Perform audit** only on Pending; page: quote card + lead drawer + quote PDF in new tab + NBA iframe with sold/effective dates; Pass/Fail per item, notes save, counts move; Approve disabled until all pass (tooltip lists unmet); fail one + Send back with note → lands on queue as Sent back. **Producer** (`producer@demoagency.local`): board shows the deal red with "Sent back by … — note"; drawer shows the manager note on the reopened item; **Fix it** opens `/sold/:id/edit` (Add policy allowed); re-upload → Mark resolved → card stays ("Ready to submit") → Submit → Pending → gone from board; Notifications page shows "Audit sent back" and its link opens the drawer. **Owner**: Management → Aging Audits drawer rows open `/deal-audits/:dealId`. **CSR**: 403 on `/deal-audits/queue`, no nav item.

## 7. PR split (all into `dev`)
| PR | Contents | Depends on |
|---|---|---|
| **PR1** `pac-106-audit-review-model` | §1 shared types/helpers (no catalog yet), §2.1–2.3 schemas/flags/seed/counters, §2.2 auto-submit, §2.7 migrations, `listPendingHandoff` predicate + item filter + `sentBack`, §2.6 edit-sale lock, e2e fixture changes, Bruno doc updates for existing requests | — |
| **PR2** `pac-106-review-api` | §2.4–2.5 queue/detail/verdict/review gate, NBA + quote-recap document routes, `audit.sent_back` catalog/renderer/emit, `agingAuditsPrefix` move, new e2e spec, new Bruno requests, `Login as Reviewer` → manager | PR1 |
| **PR3** `pac-106-deal-audits-web` | §3.1–3.3, §3.5 queue page, Deal Audit page, drawers, nav/route, management drawer links | PR2 |
| **PR4** `pac-106-producer-sent-back` | §3.4 producer board/drawer/workflow-panel, Fix it, `?audit=` deep link, §4 demo seed, §5 docs | PR1 (PR2 to exercise the notification link) |

## 8. Still open for David (assumptions built in, surface at the next scrum)
- **D13**: Edit sale allowed on a sent-back (`Fail`) and on an auto-submitted audit; PAC-104's "block once submitted" now means approved or human-submitted.
- **D16**: legacy `Not Submitted` audits with no producer items are flipped to `Pending` by migration — report the prod-dump count; alternative is to leave pre-31-Aug audits alone (they are slated for deletion anyway).
- **D10**: passed verdicts survive a resubmission; a full re-review each loop is one `updateMany` change in `submit`.
- **D12**: Pending audits leave the producer board (nothing for the producer to do). If producers should still see "with reviewer" cards, add `Pending` back to the `$in` and render them muted.
- Should **Submit** require `producerOpenCount === 0`? (unchanged from PAC-72: a producer can submit with items open.)
- Queue is branch/agency-scoped, not filtered to the named `auditReviewer`; a "mine" chip is a follow-up.
- "Lead manager" item — what exactly the manager verifies (ticket Q2); built as a plain Pass/Fail + note.

---

## 9. As built (19 Oct 2026)

Where the code departs from the plan above, and why. Everything not listed shipped as planned.

| Plan | As built | Why |
|---|---|---|
| §2.4 move `agingAuditsPrefix` into `common/deal-audits/audit-queue-pipelines.ts` | `common/deal-audits/latest-audit.ts` exports one `latestDealAuditLookup(auditMatch, project)`; `agingAuditsPrefix` and the queue both use it, and `loadAuditForDeal` sorts `createdAt: -1` | The thing the two had to agree on is *which audit row is a deal's* (a legacy re-audit can leave two). Sharing the lookup is that agreement; moving the whole prefix would have dragged the Aging card's window and cutoff into the queue. |
| §2.7 two migrations | One: `migrations/20261019120000-audit_review_flags_and_producer_counters.js` (template flags → item flags → producer counters → auto-submit), with `test/migration/audit-review-flags.e2e-spec.ts` | The steps depend on each other in that order; a failure between two files would leave items flagged against counters nobody recomputed. |
| §2.2 auto-submit at generation only | Also in `reconcileDealAudits` (the SmartSuite import's last pass) and the import stamps item flags itself (`audit-generation/audit-visibility.ts`); generation also **returns** a system-submitted audit to `Not Submitted` when a re-run (PAC-104 Add policy) brings producer items | Without the first two, an import after this deploy would recreate the stranded audits the migration fixes. Without the third, a Good Student added to an auto-submitted sale would sit with the manager, off the producer's board. |
| §2.9 change `api.e2e` fixtures to `autoPolicyWithStudentDiscount()` | Not needed: that suite's `TEMPLATES` fixture has no flags, so every item defaults to producer-visible. The existing tests gained `submittedById` where they fake a submission, `passAll` / `failFirst` where they review, and a note on every send-back. The manager-only split is covered by the new `test/deal-audit-review.e2e-spec.ts`, which seeds the production catalog | — |
| §3.3 `npx shadcn add toggle-group` | Pass / Fail are two `Button`s with `aria-pressed` in a labelled `group` (`ChecklistItemRow`) | Same idiom as `FilterToggles`; no new primitive or dependency for two buttons. |
| — | `GET /deal-audits?dealId=` returns one card | The `audit.sent_back` link (`/dashboard/producer?audit=<dealId>`) has to open a card that may be on any page of the board. An empty page, never a 404, when the deal is not waiting on the caller. |
| §2.8 `Send Back Audit.bru` | **Review Audit** is the send-back (`request_changes` + note); **Approve Blocked**, **Set Item Verdict (Fail)** and two *Forbidden for Producer* requests sit around it | One request per behaviour, in the order the page runs them. |
| §4 one all-manager-only `Pending` fixture | Two pinned fixtures — Pat's newest sent-back audit and one person-submitted `Pending` — and the open item on each demo deal is its first **producer** item | A demo deal always carries a producer item by construction, so a system-submitted audit never arises there; the e2e covers it. Pinning by date keeps every RNG draw where it was. |

Verified: shared specs (38), API unit (1,470), API e2e (46 suites, 1,426 tests), Bruno *Deal Audits* + *Policies* run twice on a fresh demo seed (green but *Policy History*, which needs a var from another folder), web `tsc` + `vite build`. **Not yet checked in a browser.**

## 10. Follow-up — queue search, filters and sort (20 Oct 2026)

Asked for by Abu Bakar after the first walkthrough: the queue had status chips and nothing else.
Settled: queue page only; search by **client, producer or policy number**; filters **producer**,
**line of business**, **aging only**, **sold date**; sorts **longest waiting** (default),
**client**, **producer**, **recently submitted**. Plan: `~/.claude/plans/start-planning-curried-lovelace.md`.

- **API.** `listDealAuditQueueSchema` reuses `dashboardFilterFields` (`producerIds`, `policyTypes`,
  `from`/`to`) plus `q`, `aging` (the Analytics `'true'|'false'` flag), `range`
  (`DEAL_AUDIT_QUEUE_RANGE_KEYS`, default `all` — the dashboards default to month-to-date, which
  would hide last month's open audits) and `sort`. No `branchId` (`BranchGuard` reads it).
  `listQueue` builds one deal filter for both scope arms and puts it before
  `latestDealAuditLookup`; the sold window and the aging cutoff merge into one `soldDate` clause.
  Producer sort ranks by a name order resolved in Node (`$indexOfArray`, unknown last); client sort
  lower-cases a copy rather than using a collation, which would stop the string `agencyId`
  indexes serving the queue. `GET /deal-audits/queue/options` → `{ producers }`, the sellers in
  reach.
- **Web.** `DealAuditQueueFilters` + `queue-filters.ts`; `useDealAuditsUrlState` holds every key;
  picking *Approved* switches *Aging only* off (the two cannot both hold).
- **Verified.** DTO + sort-stage units; 11 e2e cases in `test/deal-audit-review.e2e-spec.ts`
  (search by each field, AND across words, each filter, each sort, options gate, 400s); Bruno
  *Review Queue Options*, *List Review Queue (Filtered)* and *(Aging Only)* green twice on the demo
  tenant; web `tsc` + build. **Not yet checked in a browser.**
