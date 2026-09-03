# AIOS-SFA API — Bruno collection

A [Bruno](https://www.usebruno.com/) collection documenting and exercising the
AIOS-SFA NestJS API (`packages/api`). Bruno stores requests as plain-text `.bru`
files, so this collection is version-controlled and diff-friendly — it doubles as
living API docs for devs and agents.

## Scope

Every implemented endpoint, plus the auth endpoints you need to call them.

| Folder | Request | Endpoint | Notes |
|---|---|---|---|
| Auth | Login | `POST /auth/login` | Public. Captures tokens into the env. |
| Auth | Refresh Token | `POST /auth/refresh` | Public. Rotates the token pair. |
| Bug Reports | Presign Screenshot | `POST /bug-reports/screenshots/presign` | Screenshot upload URL. **No permission** — any authenticated caller, including a platform operator with no agency. |
| Bug Reports | Upload Screenshot | `PUT <uploadUrl>` | Raw PUT straight to storage. `auth: none` by design. |
| Bug Reports | Create Bug Report | `POST /bug-reports` | File a report. **No permission.** Captures `bugReportId` for the platform folder. |
| Bug Reports | Create Bug Report (Too Short) | `POST /bug-reports` | The 10-char description floor (400). |
| Bug Reports | Create Bug Report (Foreign Screenshot Key) | `POST /bug-reports` | The key-ownership check: a key from another user's namespace must 400. |
| Deal Audits | List Deal Audits | `GET /deal-audits` | **PAC-12** — Deals Pending Service Hand-off (read). `deal_audits:read`. |
| Deal Audits | Presign Audit Attachment | `POST /deal-audits/:itemId/attachments/presign` | **PAC-14** — resolution document upload. `deal_audits:write`. |
| Deal Audits | Resolve Deal Audit Item | `PATCH /deal-audits/:itemId/resolve` | **PAC-14** — resolve + optional note/document. `deal_audits:write`. |
| Leads | List Leads | `GET /leads` | **PAC-36** — Leads list: search, filters, pagination (read). `leads:read`. |
| Leads | Create Lead | `POST /leads` | **PAC-37** — New Lead intake pipeline. `leads:write`. |
| Leads | Create Lead (Replay) | `POST /leads` | **PAC-37** — submission-token idempotency check. |
| Leads | Get Lead | `GET /leads/:id` | **PAC-38** — Lead Detail 360° view. `leads:read`. Captures `primaryContactId`. |
| Leads | Get Lead (Foreign Lead) | `GET /leads/:id` | **PAC-38** — asserts an out-of-scope lead 404s, not 403s. |
| Leads | Update Lead | `PATCH /leads/:id` | **PAC-38** — inline status / temperature / source. `leads:write`. |
| Leads | Update Lead (Invalid) | `PATCH /leads/:id` | **PAC-38** — pins the write vocabulary (400). |
| Leads | Update Primary Contact | `PATCH /contacts/:id` | **PAC-38** — edit a lead's contact. **`clients:write`** — see its docs. |
| Leads | Update Primary Contact (Foreign Contact) | `PATCH /contacts/:id` | **PAC-38** — the derived-ownership clamp (404). |
| Leads | List Hot Leads | `GET /leads/hot` | **PAC-15** — Priority Contact List, stalest first. `leads:read`. Captures `hotLeadId`. |
| Leads | Log Activity (Call) | `POST /activities` | **PAC-16** — quick-action touch log. `leads:write`. |
| Leads | Log Activity (Note) | `POST /activities` | **PAC-16** — the Lead Detail note composer. `leads:write`. |
| Leads | Log Activity (Invalid Type) | `POST /activities` | **PAC-16** — pins the write vocabulary; a forged `sold` must 400. |
| Leads | Log Activity (Foreign Lead) | `POST /activities` | **PAC-16** — asserts an out-of-scope lead 404s, not 403s. |
| Leads › Share Links | Create / List / Revoke | `/leads/share-links…` | **PAC-37** — public intake links. `leads:write`. |
| Leads › Address | Address Autocomplete | `POST /address/autocomplete` | **PAC-60** — Google-backed predictions for every address field. OR-gated over four modules at `:write`. Fails open: always 200, read `available`. |
| Leads › Address | Resolve Address | `POST /address/resolve` | **PAC-60** — chosen prediction → `{street, city, state, zip}`. Accepts 200 **or** 400 by design; asserts the spelled-out state and the five-digit ZIP. |
| Public Intake | Public Address Autocomplete | `POST /public/address/:token/autocomplete` | **PAC-60** — the same lookup on the anonymous share-link form. `auth: none`. Over the per-link daily cap it answers `200 { available: false }`, never 429. |
| Public Intake | Public Address Autocomplete (Unknown Token) | `POST /public/address/:token/autocomplete` | **PAC-60** — the non-disclosure contract: an unknown token must be byte-identical to a revoked one. |
| Leaderboard | Get Leaderboard | `GET /leaderboard` | **PAC-13** — Motivation Hub. `leaderboard:read`. Asserts no entry leaks another producer's dollars. |
| Leaderboard | Get Leaderboard (Explicit Month) | `GET /leaderboard` | **PAC-13** — a past month; month-scoped, never range-scoped. |
| Mailers | Lookup Mailer (Long Form) | `GET /mailers/:controlNumber` | **PAC-61** — Mailers drawer QCN lookup. `mailers:read`. The `#`-prefixed form must be percent-encoded in the URL; the web client sends the normalized key instead. |
| Mailers | Lookup Mailer (Short Form) | `GET /mailers/:controlNumber` | **PAC-61** — the 12-char printed form must resolve to the *same* mailer. Reads the short form off the previous response, not the env. |
| Mailers | Lookup Mailer (Not Found) | `GET /mailers/:controlNumber` | **PAC-61** — an unknown number is a 404, which the drawer renders as an empty state rather than an error. |
| Mailers | Log Mailer Lead | `POST /mailers/log-lead` | **PAC-61** — creates Lead + Household + Contact via `LeadIntakeService`. Needs `mailers:read` **and** `leads:write`. 200, not 201: resolve-or-create. |
| Mailers | Log Mailer Lead (Replay, Other Form) | `POST /mailers/log-lead` | **PAC-61** — the same mailer through the *other* control-number form returns the same `leadId` with `alreadyExisted: true`. One mailer, one lead. |
| Performance | Get Performance (This Month) | `GET /performance` | **PAC-10 / PAC-11** — Sold + Quoted scorecards. `performance:read`. |
| Performance | Get Performance (Custom Range) | `GET /performance` | **PAC-9** — the 📅 Custom Date chip's arbitrary window. |
| Performance | Get Performance (Invalid Custom) | `GET /performance` | **PAC-9** — `range=custom` with no bounds must 400. |
| Policies | Check Policy Number | `GET /policies/check` | **PAC-40** — Sold wizard Card 3 dedupe. `deal_audits:read`. |
| Platform Agencies | Login as Super Admin | `POST /auth/login` | **PAC-69** — the platform operator. Each folder is self-contained, so this is duplicated rather than shared with **Platform Mailers**. |
| Platform Agencies | Check Availability | `GET /platform/agencies/availability` | **PAC-69** — live slug/email/ticker checks for the onboarding wizard. `platform:agencies:read`. Mints the timestamped identity the rest of the folder uses. |
| Platform Agencies | Onboard Agency | `POST /platform/agencies` | **PAC-69** — agency + roles + first branch + audit templates + invited owner, in one call. `platform:agencies:write`. A failed invite email is still a **201** with `emailStatus: "failed"` — see its docs. |
| Platform Agencies | Resend Owner Invite (Cooldown) | `POST /platform/agencies/:id/owner-invite/resend` | **PAC-69** — asserts the per-user cooldown refuses a resend seconds after onboarding. The 200 path needs a failed dispatch (which clears the stamp) and is covered by e2e. |
| Platform Agencies | Get / Accept Owner Invite (Public) | `GET /auth/invite/:token`, `POST /auth/accept-invite` | **PAC-69** — the owner's half: preview carries `firstName`/`lastName`/`agencySetupPending`, accept takes optional name corrections. `auth: none`. |
| Platform Agencies | Get / Complete Agency Setup | `GET`/`POST /agency/setup…` | **PAC-69** — the owner's first-run wizard state. `agency:branding:read` / `:write`. `complete` is idempotent. |
| Platform Agencies | Check Availability (After Onboarding) | `GET /platform/agencies/availability` | **PAC-69** — the same query, now answering "taken". Paired with the first so neither depends on which agencies happen to exist locally. |
| Platform Bug Reports | Login as Super Admin | `POST /auth/login` | Its own copy — this folder sorts **before** `Platform Mailers`, so it cannot rely on that one's login. Pins that a new `PlatformPermission` member reaches the super admin with no seed step. |
| Platform Bug Reports | List Bug Reports | `GET /platform/bug-reports` | The Super Admin queue, cross-tenant. `platform:bugs:read`. |
| Platform Bug Reports | Get Bug Report | `GET /platform/bug-reports/:id` | One report + signed inline screenshot URLs. `platform:bugs:read`. |
| Platform Bug Reports | Update Bug Report | `PATCH /platform/bug-reports/:id` | Status + internal notes. `platform:bugs:write`. |
| Platform Bug Reports | Update Bug Report (Empty Body) | `PATCH /platform/bug-reports/:id` | A PATCH that changes nothing must 400, not silently succeed. |
| Platform Bug Reports | List Bug Reports (Producer Rejected) | `GET /platform/bug-reports` | The boundary: anyone may **file**, only the platform may **read** (403). |
| Platform Mailers | Login as Super Admin | `POST /auth/login` | **PAC-73** — the platform operator (`admin@sfa.local`). Captures `platformAccessToken` separately: a platform account holds no module permissions, so it would 403 every other folder. |
| Platform Mailers | List Agencies | `GET /platform/agencies` | **PAC-73** — the Add Mailers agency picker. `platform:agencies:read`. Selects by slug, not `[0]` — the list has no guaranteed order. |
| Platform Mailers | Presign Import | `POST /platform/mailers/imports/presign` | **PAC-73** — RTP upload URL. `platform:mailers:write`. |
| Platform Mailers | Upload Import File | `PUT <uploadUrl>` | **PAC-73** — raw PUT straight to storage. `auth: none` by design. |
| Platform Mailers | Create Import | `POST /platform/mailers/imports` | **PAC-73** — queues the preview parse. Writes no mailers. |
| Platform Mailers | Get Import Run | `GET /platform/mailers/imports/:runId` | **PAC-73** — the poll target. `platform:mailers:read`. Waits for the queued preview before asserting. |
| Platform Mailers | Commit Import | `POST /platform/mailers/imports/:runId/commit` | **PAC-73** — the only call that writes. 409s unless the run is `previewed` and any agency mismatch was confirmed. |
| Platform Mailers | List Imports | `GET /platform/mailers/imports` | **PAC-73** — an agency's recent runs. `platform:mailers:read`. |
| Platform Mailers | Get Import Run (After Commit) | `GET /platform/mailers/imports/:runId` | **PAC-73** — proves the write happened: `created + updated === 1` on every run, because the upsert dedupes. |
| Platform Users | List Users | `GET /platform/users` | **PAC-70** — the cross-agency user directory. `platform:users:read`. Paginated; `q` reaches agency and role *names*, not just the user's own fields. |
| Platform Users | List Users (Filtered) | `GET /platform/users` | **PAC-70** — `roleSlugs=producer,csr` is ORed (slugs, not ids — a role's id differs per agency); `q=demo` hits the agency name. |
| Platform Users | List Roles | `GET /platform/users/roles` | **PAC-70** — one `{slug, name}` per distinct slug across the platform; the Role filter's options. |
| Platform Users | List Users (Forbidden) | `GET /platform/users` | **PAC-70** — a tenant user (the inherited producer token) gets 403. |
| Platform Users | Impersonate User | `POST /auth/impersonate/:userId` | **PAC-70** — a session *as* the target, resolved from the store. `platform:users:impersonate`. Returns the login envelope plus `appBaseUrl`, the origin the session must be used on. Deliberately not audited. |
| Platform Users | Impersonate Unknown User | `POST /auth/impersonate/:userId` | **PAC-70** — unknown and inactive targets are the same 404, so the endpoint is not a cross-tenant enumeration oracle. |
| Public Intake | Get Form / Submit | `/public/lead-form/:token`, `/public/leads/:token` | **PAC-37** — unauthenticated share-link intake. |
| Quote Recaps | Get Lead Context | `GET /quote-recaps/context` | **PAC-39** — lead + household header for the form. `quote_recaps:read`. |
| Quote Recaps | Presign Quote Document | `POST /quote-recaps/quote-document/presign` | **PAC-39** — carrier-quote upload URL. `quote_recaps:write`. |
| Quote Recaps | Upload Quote Document | `PUT <uploadUrl>` | **PAC-39** — raw PUT straight to storage. `auth: none` by design. |
| Quote Recaps | Create Quote Recap | `POST /quote-recaps` | **PAC-39** — record the proposal. `quote_recaps:write`. |
| Quote Recaps | Create Quote Recap (Replay) | `POST /quote-recaps` | **PAC-39** — submission-token idempotency check. |
| Quote Recaps | Create Quote Recap (Foreign Lead) | `POST /quote-recaps` | **PAC-39** — asserts an out-of-scope lead 404s. |
| Sold Deals | Get Sold Context | `GET /sold-deals/context` | **PAC-40** — lead + household + contacts for the wizard. `deal_audits:read`. |
| Sold Deals | Presign Sold Document | `POST /sold-deals/documents/presign` | **PAC-40** — Card 5 proof upload URL. `deal_audits:write`. |
| Sold Deals | Upload Sold Document | `PUT <uploadUrl>` | **PAC-40** — raw PUT straight to storage. `auth: none` by design. |
| Sold Deals | Create Sold Deal | `POST /sold-deals` | **PAC-40** — record the sale; auto-generates the audit. `deal_audits:write`. |
| Sold Deals | Create Sold Deal (Replay) | `POST /sold-deals` | **PAC-40** — submission-token idempotency check. |
| Sold Deals | Create Sold Deal (Foreign Lead) | `POST /sold-deals` | **PAC-40** — asserts an out-of-scope lead 404s. |
| Sold Deals | Check Policy Number (Match) | `GET /policies/check` | **PAC-40** — the duplicate-found branch. |

> ⚠ **This table is not exhaustive.** `CRM Service`, `Carriers`, `Households`
> and `Users` are in the collection but were never added here; every request
> still carries its own `docs` block, which is the actual source of truth.
>
> **`Platform Mailers` pauses on purpose.** Two of its requests sleep 5s in a
> pre-request script, because the preview and the commit are queued Inngest
> jobs rather than synchronous work. Without the pause the folder goes green
> while proving nothing: the assertions read a run still in `previewing`, and
> the commit gets a correct-but-useless 409. It also needs the Inngest dev
> server (`npx inngest-cli@latest dev -u http://localhost:4000/api/inngest`) —
> without it `Create Import` 500s.
>
> **Folder order matters when running the whole collection.** The CLI walks
> folders alphabetically (`Auth` → `Deal Audits` → `Leads` → `Mailers` →
> `Performance` → `Platform Mailers` → `Platform Users` → `Policies` →
> `Public Intake` → `Quote Recaps` → `Sold Deals`), and the downstream chains
> reuse ids captured earlier: Quote Recaps and Sold Deals both need
> `createdLeadId` from **Leads › Create Lead**, and the PAC-38 contact requests
> need `primaryContactId` from **Leads › Get Lead** (which in turn needs
> `leadId` from **Leads › List Leads**). Running a folder on its own will 404
> unless you set those vars yourself.

## Prerequisites

1. **Install Bruno** — desktop app or CLI (`npm i -g @usebruno/cli`).
2. **Run the API** from the repo root:
   ```bash
   npm run api:dev          # NestJS API + Mongo on http://localhost:4000/api/v1
   npm run api:seed:demo:dev  # populated demo tenant (users + CRM data)
   ```

## Usage (desktop)

1. **Open Collection** → select this `bruno/` folder.
2. Pick the **Local** environment (top-right).
3. Run **Auth › Login** — its post-response script stores `accessToken`,
   `refreshToken`, and `branchId` in the environment.
4. Run **Deal Audits › List Deal Audits** (inherits the bearer token).

## Usage (CLI)

```bash
cd bruno
bru run --env Local            # run the whole collection
bru run "Deal Audits" --env Local
```

## Environment

`environments/Local.bru` defines:

| var | default | purpose |
|---|---|---|
| `baseUrl` | `http://localhost:4000/api/v1` | API root |
| `producerEmail` | `producer@demoagency.local` | demo Producer login |
| `password` | `ChangeMe123!` | demo `SEED_DEFAULT_PASSWORD` |
| `accessToken` / `refreshToken` / `branchId` | *(runtime only)* | set by **Login** |

> Tokens are stored as **runtime variables** (`bru.setVar`), which are in-memory
> only and never written to disk — so they can't be committed to Git. Log in
> again after restarting Bruno.

## Notes for contributors

- Auth is set **at the collection level** (`collection.bru`, bearer
  `{{accessToken}}`). New authenticated requests should use `auth: inherit`;
  public endpoints set `auth: none`.
- Keep each request's `docs` block current — it is the source of API context for
  humans and agents. As new PAC tickets land, add a folder/request here in the
  same shape (meta → verb → params/headers/body → tests → docs).
- **Folders are self-contained.** The CLI walks them alphabetically and a folder
  must not depend on another having set a variable, which is why more than one
  has its own `Login as …` request.
- ⚠ **`Platform Agencies` leaves an agency behind on every run.** There is no
  delete-agency endpoint, and onboarding is the one flow here that creates a
  whole tenant. Its slug and owner email are timestamped so repeated runs do not
  collide; drop the database if the accumulation ever matters.
