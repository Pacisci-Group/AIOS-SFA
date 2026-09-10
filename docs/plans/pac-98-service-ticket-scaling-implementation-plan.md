# PAC-98/99/102 — Service ticket scaling: implementation plan

Tickets: [PAC-98](https://linear.app/paciscigroup/issue/PAC-98) (server-side pagination), [PAC-99](https://linear.app/paciscigroup/issue/PAC-99) (renewal scan → worker), [PAC-102](https://linear.app/paciscigroup/issue/PAC-102) ("Needs Action Today" undercounts). The tickets hold the problem statements; this plan is the execution order and the design decisions that cut across all three.
Paths are relative to the repo root; `api/` = `packages/api/`, `web/` = `packages/web/`, `shared/` = `packages/shared/`.

## Context

Three reported problems on the Service Dashboard turn out to be two causes.

**Cause 1 — a ticket's status is derived at read time, not stored.** `serializeTicket` computes it from step timing via `deriveStepStatus` whenever the ticket carries an onboarding or renewal step and `statusOverriddenAt` is null. The stored `status` column says `open` forever, because the `waiting → open → overdue` transitions happen through the passage of time with no write to hang an update off. That is the documented reason for deriving (`api/src/crm/scheduling/step-status.ts`), and it was correct when written: there was no worker. There is one now.

This one cause produces:
- **PAC-102**, directly. `stats()` counts `t.status === 'overdue'` on the stored column, so "Needs Action Today" reads ~0 while the Overdue tab beside it reads 577. Confirmed against a populated environment.
- The latent `?status=` gap. `onboardingStatusMatch` mirrors the derivation but only for `onboarding.*`, missing renewal steps entirely. Not user-visible today because no web caller passes `status`.
- **The blocker under PAC-98.** You cannot index a computed field. Ranking on a derived status means every list request scans the caller's whole scope and sorts in memory — which is the problem server-side paging exists to solve. Deriving in a `$facet` aggregation would page correctly and still not scale.

**Cause 2 — write work on a read path.** `renewalDesk()` calls `materializeRenewalCycles()` inline on the GET: rolling forward renewal dates, scanning the policy book over a 90-day horizon, upserting cycles. `claimScanWindow` throttles it, so most requests skip it and one unlucky request pays for the whole scan while a CSR waits. That is **PAC-99**, and it is why the desk feels slow — not row count, which is already capped at `RENEWAL_DESK_LIMIT = 100`.

Decision taken with the user (2026-09-10): **materialize the status with an Inngest job.** Reads then use one indexed column, PAC-102 disappears without its own fix, the `?status=` gap closes, and PAC-98 becomes an indexed sort instead of an in-memory one.

### Alternatives considered

- **Derive in a `$facet` aggregation (the original PAC-98 sketch).** No staleness, no job, no backfill — and no index. The `$match` would have to be selective enough that the in-memory sort stays small, which is not true for an agency-scoped owner or manager view. Rejected: it fixes the payload size and leaves the query cost.
- **Materialize only stable keys and express status as range predicates.** `dueAt` does not change with time; only its comparison to `now` does. Tab filters could be indexed range queries with no job and no lag. Genuinely viable and exact, but the urgency *ordering* — status bucket, then age, then priority — cannot be expressed as one index traversal across plain, onboarding and renewal tickets. Rejected for complexity; worth revisiting if the staleness window ever becomes a problem.

### Staleness — the tradeoff being accepted

A materialized status is wrong between the instant a step crosses its `dueAt` and the next job tick. At a 5-minute interval, on an SLA measured in days, that is immaterial. It is a real behaviour change and it is written down here so nobody rediscovers it as a bug: **the queue can be up to one tick stale.** The mitigation if that ever bites is the range-predicate design above, not a shorter interval.

---

## PR0 — PAC-102 stopgap (optional)

Ship **only if PR1 will not land within a few days.** PR1 fixes PAC-102 by making the column correct; this is a holdover so the dashboard is not visibly wrong in the meantime, and PR1 deletes it.

### 0.1 `api/src/crm/service-tickets.service.ts` — `stats()`

Derive before counting, calling the same `deriveStepStatus` the serializer uses — not a second copy of the rule:

```ts
const effective = (t) =>
  (t.onboarding ?? t.renewal) && !t.statusOverriddenAt
    ? deriveStepStatus(t.onboarding ?? t.renewal, now)
    : t.status;
```

`openTickets` and `resolvedToday` are already correct and must not be touched: completion writes `status = 'resolved'` (L931/L1986), so stored and derived agree on terminality. Only `needsActionToday` changes.

### 0.2 Test

Unit: a renewal ticket past `dueAt` with stored `status: 'open'` counts toward `needsActionToday`.

---

## PR1 — Materialize ticket status (foundation)

The whole plan rests on this. Nothing else should start until it is merged.

### 1.1 `api/src/crm/schemas/service-ticket.schema.ts` — new fields

- `urgencyRank: number` — 0 overdue / 1 open+in_progress / 2 waiting\* / 3 terminal. Maintained with `status`.
- `urgencyAt: Date` — **stable**, set at write time: `onboarding.dueAt ?? openedAt`.
- `priorityRank: number` — **stable**, set at write time from `priority`.

`urgencyAt` mirrors `urgencyInstant` in `web/src/lib/ticket-urgency.ts` exactly, including that it consults `onboarding.dueAt` and **not** `renewal.dueAt`. That looks like an oversight; porting it verbatim keeps this PR order-neutral. Changing it is a separate, visible decision — see Risks.

### 1.2 `api/src/crm/scheduling/step-status.ts` — single definition

`deriveStepStatus` stays the one definition of the rule and gains `urgencyRankFor(status)`. The job calls it; nothing else re-implements it. Update the docblock that says *"Nothing here mutates rows, so the queue needs no cron"* — it is about to be false, and a stale docblock is worse than none.

### 1.3 `api/src/worker/functions/sync-ticket-status.fn.ts` — new cron

Modelled on `sweep-event-log.fn.ts` (`@Injectable() @InngestFunction()`, `cron(...)`, 5-minute interval).

Do not scan and recompute every ticket. Query the boundary directly — two indexed `updateMany`s per step kind:

```
→ overdue: { statusOverriddenAt: null, status: { $ne: 'overdue' },
             '<step>.completedAt': null,
             '<step>.dueAt': { $ne: null, $lt: now } }

→ open:    { statusOverriddenAt: null, status: { $ne: 'open' },
             '<step>.completedAt': null,
             '<step>.availableAt': { $ne: null, $lte: now },
             '<step>.dueAt': { $gte: now } }
```

`{agencyId, 'renewal.dueAt'}` and `{agencyId, 'renewal.availableAt'}` already exist; onboarding needs the equivalents. `waiting` and `resolved` need no sweep — both are written at their transition (`resolved` by `completeRenewalStep`/`completeOnboardingStep`, `waiting` at creation).

No `SWEEP_BATCH_SIZE` cap here, unlike the event-log sweeper: this is one indexed range update per tick, not N event replays. Log `modifiedCount` so a tick that suddenly moves thousands of rows is visible.

### 1.4 `api/src/worker/agency-sweep.ts` — new helper

A cron has no request and no `AccessContext`. Both this job and PR2 need to iterate tenants, so build it once: `forEachAgency(fn)` over active agencies, errors isolated per tenant so one bad agency does not abort the sweep.

### 1.5 `api/migrations/` — backfill

The job would converge on its own within one tick; the migration makes the deploy deterministic instead of briefly wrong. Same two updates, once, across all agencies. Raw `db` handle, no Mongoose model, idempotent — see `api/migrations/README.md`.

### 1.6 Reads stop deriving

- `serializeTicket` reads `ticket.status` directly. Delete the derivation block.
- `onboardingStatusMatch` and `scheduledOnboardingMatch` collapse into plain equality on `status`. **This closes the latent renewal gap for free** — confirm with the user that the narrowing was not deliberate before it silently widens.
- `stats()` needs no change; its column is now correct. **PAC-102 closes here.**

### 1.7 PR1 tests

- Worker e2e (`api/test/worker/`, pattern in `sweep-event-log.e2e-spec.ts`): a renewal ticket past due flips to `overdue`; an overridden one does not; the sweep spans agencies.
- Unit: `deriveStepStatus` and `urgencyRankFor` agree with `URGENCY_RANK` in `web/src/lib/ticket-urgency.ts`.
- Regression: PAC-102's fixture.

---

## PR2 — Renewal scan → worker (PAC-99)

Independent of PR1 in behaviour, dependent on it for `forEachAgency`.

### 2.1 Lift the scan out of the request scope

`materializeRenewalCycles(access)` is written against a request's `AccessContext`. Recast as `(agencyId) => void` running agency-wide. `RenewalScanState` is already keyed by `agencyId`, so the per-tenant cursor and `claimScanWindow` lock carry over unchanged — keep the lock, it is what stops a worker run and a straggler double-scanning.

### 2.2 `api/src/worker/functions/materialize-renewal-cycles.fn.ts` — new cron

Interval matched to `RENEWAL_SCAN_INTERVAL_MS`. **Batched with a cap**, unlike PR1's job: this one does per-candidate upserts, and a backlog after downtime must not be attempted in one run. Log when the cap is hit.

### 2.3 `renewalDesk()` becomes a pure read

Drop the `materializeRenewalCycles` call. Update both docblocks that explain the inline scan as deliberate (*"there is no cron, so reading the desk is what makes renewals appear"*) — `service-tickets.controller.ts` L79 and `service-tickets.service.ts` L2129.

### 2.4 Fresh-environment behaviour

Today, opening the desk is what makes renewals appear; after this a fresh or newly-migrated agency shows an empty desk until the first tick.

**Decision changed during implementation: no boot-time scan.** The plan called for one, and building it showed the case it was for is already covered — the demo seed calls `materializeRenewalCycles` directly (`seed/renewal-scenarios.ts`), clearing the throttle first, so a seeded environment is populated the moment seeding finishes. That is the demo. What a boot hook would add is a full multi-tenant scan on every worker start, plus a background write racing every e2e that boots `WorkerModule` — real cost against a gap of at most one tick for the one case (a migrated agency, mid-cycle) that the cron closes on its own.

`ServiceTicketsService.materializeRenewalCycles` therefore stays as a thin delegate rather than being deleted: the seed is its caller.

### 2.5 PR2 tests

Worker e2e: cycles materialize across agencies, the cap is respected, a held claim prevents a double scan.

---

## PR3 — Server-side pagination (PAC-98)

Now an indexed sort, because PR1 made the sort key a stored column.

### 3.1 `shared/` — envelope

Follow `LeadListResponse`/`HouseholdListResponse` rather than inventing a shape:

```ts
export interface ServiceTicketListResponse {
  page: number;
  pageSize: number;
  total: number;      // matches filters, before the tab narrows
  totalPages: number;
  items: ServiceTicketView[];
  counts: { all: number; overdue: number; waiting: number };
}
```

`counts` ships with the page so the tab chips need no second round-trip, and is computed over the filtered set *before* the tab predicate — which is what the chips mean today.

### 3.2 `api/` — query

`.find()` with `.sort({ urgencyRank: 1, urgencyAt: 1, priorityRank: 1, ticketNumber: 1 })`, `.skip()`, `.limit()`. Counts via three `countDocuments` or one `$facet` — measure; three indexed counts may well beat a faceted scan.

Sort order must reproduce `compareTicketUrgency` exactly. That is the regression risk in this PR: a queue that looks fine and is subtly reordered.

### 3.3 `ListTicketsQueryDto`

Gains `page`, `pageSize` (bounded), `tab` (`all` | `overdue` | `waiting`).

### 3.4 `api/migrations/` — index

Candidate: `{ agencyId, assignedUserId, urgencyRank, urgencyAt, priorityRank }`, plus an agency-scoped variant for owner/manager views. **Verify with `explain()` against realistic volume before committing** — this is the one number in the plan that should not be guessed. Migration file, not a schema-only edit: `autoIndex` never rebuilds an index whose options changed.

### 3.5 `web/` — three consumers

- `PriorityTicketQueue` drops `sortByUrgency` and the client slice; `tab`/`page`/`type` become request params. Query key includes them; `placeholderData` to avoid a flash between pages.
- **Re-pin `?type=` to the vocabulary in `URL_ALLOWED`.** PAC-97 loosened it precisely because the value never reached the API. Once it does, the guard has to tighten again.
- `TicketWorkspacePage` and `ArchivedTicketsPage` move to the same envelope.
- Delete `web/src/lib/ticket-urgency.ts` once nothing client-side ranks.

### 3.6 Bruno + tests

Update `bruno/` for the new params and response shape with a real `docs` block (`.claude/rules/api-bruno-docs.md`). Unit test asserting server order matches `compareTicketUrgency` over a fixture set, kept even after the client helper is deleted — it is the contract.

---

## PR4 — Desk pagination (PAC-99 follow-on)

`RENEWAL_DESK_LIMIT = 100` is a silent truncation: a CSR with more than 100 open cycles never sees the rest and nothing says so. Same envelope treatment; `RenewalOutreachDesk` already pages client-side over `?page=`. Lowest urgency here — after PR2 the desk is fast, just capped.

---

## What actually shipped

All four PRs landed as **one** branch at the user's request (`awaris/pac-102-materialize-ticket-status`), in the order below. Departures from the plan above, and why:

| Plan said | Shipped | Why |
| --- | --- | --- |
| PR0 stopgap for PAC-102 | **Not shipped** | PR1 landed in the same branch, so a holdover PR1 would delete had no window to be useful in. |
| PR1: sweep handles `overdue` and `open`; `waiting` "written at creation" | Also derives status in a `pre('save')` hook | The assumption was wrong. Every creation path leaves `status` on its `open` default, *including* for a call scheduled days out — invisible while reads re-derived. The onboarding e2e caught it. |
| PR2: run the scan once on worker boot | **Not shipped** | The demo seed already materializes directly, so the gap it covered is one tick for a migrated agency. A boot hook would add a multi-tenant scan to every worker start and a background write racing every e2e that boots `WorkerModule`. |
| PR3: `$facet` for page + counts | Three `countDocuments` + a `find` | Each count is index-served; a facet walks the matched set once per branch. They run concurrently with the page fetch. |
| PR3: sort tiebreak on `ticketNumber` | `_id` | `ticketNumber` is a string whose numeric part does not sort lexicographically (`RENEW-100` before `RENEW-99`), and a non-unique tiebreak lets a row appear on two pages or neither. |
| PR4: desk pagination | **Not shipped** | Still open. `RENEWAL_DESK_LIMIT = 100` remains a silent truncation; see PAC-99's follow-on section. |

Two things the plan did not anticipate:

- **`TicketFeed`'s filters had to move server-side too.** The Workspace and Archived pages filter and search through that component, over the array they were given. Paging the endpoint without moving those would have left a search box that silently searched only the current 25 rows. `?search=` is new on the API for this.
- **A characterization suite came first.** Renewal materialization had no integration coverage at all — only unit tests over the pure scheduling helpers — so `test/renewal-materialization.e2e-spec.ts` was written against the pre-refactor code and had to pass unchanged after the move. It did.

## Verification

- `npm run lint -w @sfa/api` and `-w @sfa/web` green on each PR.
- `cd bruno && npx @usebruno/cli run --env Local` green after PR3.
- After PR1, on a populated environment: `needsActionToday` and the Overdue tab agree. This is the single clearest signal the foundation worked.
- After PR3: the dashboard issues one request per page rather than one for the book; page 3 of Overdue is a shareable URL that renders the same rows on reload.

## Risks and things to watch

- **Silent reordering (PR3).** The highest-consequence, lowest-visibility failure. The fixture test is the guard.
- **The job writes real status data (PR1).** Mitigated by it only ever writing what `deriveStepStatus` returns, and only for schedule-owned tickets — reproducible from the step fields, so a bad run is recoverable by fixing the rule and re-running.
- **`urgencyAt` ignoring `renewal.dueAt`.** Ported verbatim so PR1 is order-neutral. It probably *is* a bug — renewal tickets sort by `openedAt` rather than when the call is due — but fixing it while porting would reorder the live queue invisibly. Separate ticket, separate PR, visible in isolation.
- **Staleness window** — see Context. One tick.
- **Scope change in PR2.** The scan currently inherits a request's data scope; agency-wide is more correct, but confirm nothing quietly relied on `own`-scoped narrowing.
