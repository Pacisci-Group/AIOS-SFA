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
| Leaderboard | Get Leaderboard | `GET /leaderboard` | **PAC-13** — Motivation Hub. `leaderboard:read`. Asserts no entry leaks another producer's dollars. |
| Leaderboard | Get Leaderboard (Explicit Month) | `GET /leaderboard` | **PAC-13** — a past month; month-scoped, never range-scoped. |
| Performance | Get Performance (This Month) | `GET /performance` | **PAC-10 / PAC-11** — Sold + Quoted scorecards. `performance:read`. |
| Performance | Get Performance (Custom Range) | `GET /performance` | **PAC-9** — the 📅 Custom Date chip's arbitrary window. |
| Performance | Get Performance (Invalid Custom) | `GET /performance` | **PAC-9** — `range=custom` with no bounds must 400. |
| Policies | Check Policy Number | `GET /policies/check` | **PAC-40** — Sold wizard Card 3 dedupe. `deal_audits:read`. |
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

> **Folder order matters when running the whole collection.** The CLI walks
> folders alphabetically (`Auth` → `Deal Audits` → `Leads` → `Policies` →
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
| `producerEmail` | `producer@smithfamily.local` | demo Producer login |
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
