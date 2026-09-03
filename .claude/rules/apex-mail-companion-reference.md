---
paths:
  - "packages/api/src/mailers/**"
  - "packages/api/src/performance/**"
  - "packages/api/src/leaderboard/**"
  - "packages/api/src/quote-recaps/**"
  - "packages/api/src/sold-deals/**"
  - "packages/api/src/policies/**"
  - "packages/shared/src/domain/mailer*.ts"
  - "packages/shared/src/domain/performance.ts"
  - "packages/shared/src/domain/leaderboard.ts"
  - "packages/web/src/lib/mailers-api.ts"
  - "packages/web/src/lib/platform-mailers-api.ts"
  - "packages/web/src/features/platform/AddMailersPage.tsx"
  - "packages/web/src/features/lead/components/MailerLookupDrawer.tsx"
  - "packages/web/src/components/leads/MailersButton.tsx"
  - "docs/mailers-handoff.md"
---

# `apex-mail-companion` (ApexReports) — read-only reference

The **`apex-mail-companion`** repo is available inside this repo at
`./apex-mail-companion` — a **symlink** to the sibling `../apex-mail-companion`
checkout, so you can read and search it without leaving the AIOS-SFA workspace.
It is **gitignored** (see `.gitignore` → "Local project folders") and never
committed here.

The folder name understates it. Internally the app is **ApexReports**: an
internal **operations & reporting portal for Apex Agency** whose core mission is
replacing a legacy **Alteryx** reporting stack with browser-based ETL. Mail
campaign automation is one of five families it covers — the others are
**chargeback processing**, **transaction/commission reporting**, **producer
performance & quote-to-sold analytics**, and **data-quality reconciliation**.
It is the source-of-truth for how all of that behaves in production today.

**It is being retired.** The plan (2026-09-03) is to rebuild its features
inside the AIOS-SFA Super Admin Panel — better, with less manual work — and then
switch it off. Until then it is still live and still the thing that writes the
mailer BigQuery tables. Treat it as **the behavioural reference for what gets
rebuilt, and as an upstream data producer during the transition**.

## Rules
- **Read-only.** Never edit, create, or delete files under
  `./apex-mail-companion`. All work goes in `packages/*`. If the folder is
  missing, recreate the link with `ln -s ../apex-mail-companion apex-mail-companion`
  from the repo root.
- **Different stack — read for behaviour, not for patterns.** ApexReports is
  React 19 + **TanStack Start** (file routes + `createServerFn` RPC) on
  **Cloudflare Workers**, with **Supabase** auth/Postgres and **BigQuery** as the
  analytical store. AIOS-SFA is **NestJS + Mongo + JWT**. Port the *rules*
  (control-number format, campaign numbering, chargeback per-diem math, ZIP
  normalization, dedupe semantics), never the transport, the `createServerFn`
  idiom, the Supabase `assert*` helpers, or the Lovable connector-gateway calls.
- **Its pipeline code is deliberate Alteryx fidelity.** Every report mirrors the
  original `.yxmd` workflow step for step — same filter order, same rounding
  order, same aggregation semantics — validated against known-good Alteryx
  output. An oddity is almost always faithfulness to the source workflow. Copy
  the *result*, never a "cleaned-up" version.
- **No conventional unit-test net.** Correctness there is established by
  ground-truth validation against Alteryx output (row counts per filter stage,
  dollars to the penny). Do not read the absence of tests as "unverified" — but
  do not trust a refactor of that logic either.
- **Its BigQuery tables are upstream of ours.** Project `allstate123`, dataset
  `smartsuite_data`. `Mailer_Test_Alteryx` / `Mailer_Test_Alteryx_Current` are
  what ApexReports writes and what our `mailers` collection was imported from
  (PAC-73). Do not add request-time BigQuery reads to AIOS-SFA — see
  `docs/mailers-handoff.md`.

## App shape

A single-page app behind Supabase auth. Everything is numbered **tabs** on `/`
(`src/routes/_authenticated.index.tsx`, `?tab=N`), grouped into four **hubs** —
Pipelines, Reports, Tools, System (`src/lib/nav.ts`). Feature UIs all live in
`src/components/mail/` (**historical directory name — it is not all mail**), one
component per tab. Adding a tab means touching the registry, `TAB_PERMISSIONS`
in `src/lib/rbac.ts`, and the `?tab` zod `max()` bound.

Other routes: `/spatial` (infinite-canvas view of every report), `/views`
(pageview log), `/producer-review/$token` (public token-gated chargeback review),
admin pages (`admin.users`, `admin.errors`, `admin.mcp`, `admin.quote-recap-schema`),
an MCP server (`/mcp`, `.mcp/*`), an AI chat endpoint (`api/chat`), and a
cron-secret-gated public hook (`api/public/hooks/scheduled-sfa`).

## Feature inventory (by hub)

### Pipelines
| Tab | Feature | Component | What it does |
|---|---|---|---|
| 2 | **Quote Burst** | `Part1.tsx` | Bulk quote-outreach prep: upload → cleanse → rename → add ID → RecordID + tab assignment → filter → output |
| 3 | **SFA Processor** | `Part2.tsx` (1.9k lines) | **The main mailer run** — parse RTP/mailer file, map columns, assign campaign number + control numbers, dedupe against existing, chunked BigQuery upload, append new ZIPs to the campaign Google Sheet, completion email |
| 5 | **Lead Update** | `SmartSuiteMatcher.tsx` | Fetch SmartSuite leads → filter unmatched → load BigQuery campaign/address lookups → standardize control numbers → match engine → write leads table → **PATCH back into SmartSuite** |

### Reports
| Tab | Feature | Component | What it does |
|---|---|---|---|
| 6 | **Aggregated Reports** | `Reports.tsx` + `OklahomaZipHeatMap.tsx` | ZIP × Campaign performance: pieces per ZIP per campaign, joined with leads/quotes/sold by ZIP, best/worst/trending, Oklahoma heat map |
| 7 | **Active Policy Report** | `ActivePolicyReport.tsx` | Currently-active policies; address matching via exact normalized key then Levenshtein ≥ 0.80 with house number + directional anchored |
| 12 | **Sold Producer Reports** | `SoldProducerReports.tsx` (1.6k) | Weekly/monthly producer performance + OLS linear-regression forecasting (`forecast.utils.ts`) |
| 13 | **Send Reports by Email** | `EmailReports.tsx` | Email any report as a PDF or CSV attachment |
| 14 | **Chargeback Report** | `ChargebackReviewScreen.tsx` | Largest pipeline family — replicates an **81-tool Alteryx workflow**; joins Agency Zoom reference data + SmartSuite Deals Sold Log via three-pass case-insensitive producer match; per-diem chargebacks (round to cents *before* multiplying; **181 days Auto, 365 otherwise**); dedupe on Policy Number + Termination Effective Date; producer review sessions with emailed expiring links |
| 16 | **Custom Report** | `CustomReport.tsx` | No-code filter builder across datasets |
| 17 | **Quotes & Sales** | `QuoteReport.tsx` (1.5k) | Quote→sold conversion, producer scorecard, close rates, weekly email. Quote-to-deal match: policy number first (multi-value comma-split), fallback to normalized producer name (`NNN-` prefix stripped, title-cased) |
| 19 | **Monthly Transactions** | `NewBusinessReport.tsx` (2.1k) | New Business / Cancellations / Renewals / Summary from the monthly Allstate file. One shared `New_Business_Report` table; variants derived at read time from a single `VARIANT_WHERE` map; dedupe on policy no. + trans type + comp code within a report month. **Cancellations carry negative written premium — "net" is a signed sum** |
| 21 | **Weekly Brief** | `WeeklyBriefReport.tsx` | Auto-written narrative weekly report from quotes + sold data (`quote-insights.utils.ts` deterministic rules, `weekly-brief-pdf.ts`), emailable in one click |
| 22 | **Quote Scrubber** | `QuoteScrubber.tsx` | Reconciles SmartSuite Quote Recaps against the Allstate quotes file, per producer per quote date |
| 23 | **Sold Policy Scrubber** | `PolicyScrubber.tsx` | Reconciles "New Business Details ALL" against the SmartSuite Deals Sold Log by policy number — finds what's missing |
| 24 | **Requests & Feedback** | `FeedbackCenter.tsx` | Request a new report, report a data error with a screenshot, and **Metric Search** over `metric-catalog.ts` (every report and the metrics it exposes) |

### Tools
| Tab | Feature | Component |
|---|---|---|
| 8 | **Search Mailer** | `MailerSearch.tsx` — name/address lookup against the mailer table; ancestor of our `GET /mailers/:controlNumber` |
| 15 | **Search Chargebacks** | `ChargebackSearch.tsx` — historical `Chargeback_Log` lookup |
| 4 | **Email Log** | `EmailLog.tsx` — per-email event history |
| 11 | **Assistant** | `Assistant.tsx` — AI chat over agency data via the Lovable AI Gateway |
| 1 | **Instructions** | `Instructions.tsx` |

### System
| Tab | Feature | Component |
|---|---|---|
| 0 / 20 | **Home** / **Full Metrics** | `WelcomeHome.tsx`, `Dashboard.tsx` — alerts, freshness, reports-to-run |
| 9 | **Activity** | `ActivityLog.tsx` — system-wide activity log |
| 10 | **Settings** | `Settings.tsx` |
| 18 | **Data Export** | `DataExport.tsx` — **admin-only** bulk CSV/NDJSON dump of BigQuery + SmartSuite tables |

## Platform capabilities worth knowing about

- **RBAC** (`src/lib/rbac.ts`): roles `super_admin · admin · operator · viewer ·
  producer · user`, a named-permission map, and `TAB_PERMISSIONS` gating each
  tab. Permission-based like ours, but its own vocabulary — **not** our
  `packages/shared` permission strings. `producer` sees only their own portal.
- **Server authz contract** (`src/lib/authz.ts`): any handler touching
  `supabaseAdmin` under auth middleware must call `assertAdmin`/`assertStaff`/
  `assertUserHasAnyRole` first; enforced by `__tests__/authz.test.ts`.
  `__tests__/security-surface.test.ts` fails CI if a `/api/public/**` route ships
  without signature/secret verification, or a `createServerFn` is both
  unauthenticated and missing an `inputValidator`.
- **MCP server** (`src/lib/mcp/`): exposes `search_mailer` and `lookup_policy`
  as OAuth-authenticated MCP tools, with every invocation logged to
  `activity_log`. Runs as the signed-in user.
- **AI assistant**: Lovable AI Gateway (OpenAI-compatible), tools in
  `chat-tools.server.ts`.
- **Observability**: `observability.ts` (`withServerLogging` — structured JSON
  entry/exit, request ids surfaced into toasts), `server_errors` table +
  admin errors page, `bigquery-alerts.server.ts` (pipeline failure alerts),
  `cron-alert.server.ts` (unauthorized-cron-hit spike alerts with cooldown).
- **Supabase Postgres tables** (`supabase/migrations/`, 19 migrations):
  `user_roles`, `activity_log`, `app_settings`, `changelog_entries`,
  `column_mappings`, `help_content`, `page_views`, `quote_report_runs`,
  `saved_searches`, `saved_views`, `server_errors`, `chargeback_name_exclusions`,
  `chargeback_producer_links`, `chargeback_producer_responses`,
  `chargeback_review_sessions`.
- **Shared UX plumbing** we have analogues for: saved views/searches, bookmarks,
  command palette, shared period bar, data-freshness badges, onboarding tour,
  changelog, export audit trail, URL-encoded shareable filter state.

## Mailer-flow specifics (the part closest to us)

- `src/lib/mail-utils.ts` — file parsing (CSV routed through SheetJS so quoted
  fields survive), CSV/XLSX emit, download helpers.
- `src/lib/column-mapper.ts` + `column-mappings.functions.ts` +
  `components/ColumnMapperDialog.tsx` — header → canonical-field mapping with
  aliases, saved per pipeline (`mailer.sfa.v1`, `mailer.quoteburst.v1`). Mailer
  targets: `firstname · lastname · address · city · state · zip` (required) +
  `yearlyprem`.
- `src/lib/bigquery.functions.ts` + `bigquery-upload.server.ts` —
  campaign-exists check, chunked append, existing-control-number lookup.
  Chunking exists because of **Worker memory limits**; that constraint is not ours.
- `src/lib/campaign-metrics.functions.ts` — read its header comment. ZIP is
  truncated to 5 chars (`74003-6036` → `74003`); "latest campaign" is the highest
  `Campaign_Number` **within the most recent `campaign_year`**, never inferred
  from the campaign number alone; `cost` is deliberately unsourced.
- `src/lib/address-normalize.ts` — suffix/direction/unit normalization, shared by
  the SmartSuite matcher and the BigQuery side.
- `src/lib/zip-sheet.functions.ts` — appends new ZIP + city to the campaign
  Google Sheet the mailer run reads back.
- `src/lib/outcome-match.functions.ts` — email → downstream outcome by joining
  the mailer table with SmartSuite.

## Where to read first
1. `docs/TECHNICAL_OVERVIEW.md` — architecture, conventions, the Alteryx-fidelity
   rule, and the gotchas list. **Start here.**
2. `src/lib/README.md` — domain map: which module belongs to which domain, the
   `*.functions.ts` / `*.server.ts` / `*.utils.ts` naming contract, and the
   authorization contract.
3. `docs/ENGINEERING_PROCESS.md` — lanes and verification bars (bun only; never
   `npm install` there).
4. `docs/TECH_DEBT_TRACKER.md` — 12 audited items, all closed, each note
   explaining *why* the current design is what it is. Also lists the gaps vs. a
   real reporting platform (semantic layer, lineage, producer-scoped RLS,
   scheduled delivery) — useful input when scoping our own reporting.
5. `docs/Transaction_Reports_User_Guide.md` — end-user behaviour of the
   New Business / Cancellations / Renewals reports.

## Our side of the boundary

AIOS-SFA already owns the **read** side of mailers (PAC-73 + PAC-61):
`packages/api/src/mailers/`, `packages/shared/src/domain/mailer.ts` +
`mailer-control-number.ts`, and the Leads-page lookup drawer.
`docs/mailers-handoff.md` records what was settled — canonical control number
(long form), premium presentation, the campaign line, Oklahoma-only county
resolution, and the `mailers:read` / `leads:write` split. **Read that before
designing campaign features** so a new one doesn't re-litigate a decision or
contradict the control-number contract.

Beyond mailers, ApexReports overlaps our roadmap in several places — producer
performance and leaderboards, quote-to-sold conversion, sold/policy
reconciliation, chargebacks (which we do not model at all yet). When a feature
here touches one of those, check what ApexReports already computes before
inventing a definition; where the two disagree on a metric, that is a product
question, not a bug to fix silently.
