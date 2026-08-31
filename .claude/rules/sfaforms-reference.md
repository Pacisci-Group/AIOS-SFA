---
paths:
  - "packages/web/src/features/household/**"
  - "packages/web/src/features/lead/**"
  - "packages/web/src/features/quote-recap/**"
  - "packages/web/src/features/sold/**"
  - "packages/web/src/components/form/**"
  - "packages/api/src/households/**"
  - "packages/api/src/quote-recaps/**"
  - "packages/api/src/sold-deals/**"
  - "packages/api/src/deal-audits/**"
  - "packages/api/src/audit-generation/**"
  - "docs/form-pipeline/**"
---

# `sfaforms` prototype — read-only reference for the form pipeline

The **`sfaforms`** repo (a standalone Next.js 15 prototype of the
Lead → Quote → Sold → Audit intake pipeline) is available inside this repo at
`./sfaforms` — a **symlink** to the sibling `../sfaforms` checkout, so you can
read and search it without leaving the AIOS-SFA workspace. It is **gitignored**
(see `.gitignore` → "Local project folders") and never committed here.

This is the **behavioural reference for the native intake forms** that replace
the legacy Fillout forms (see `docs/form-pipeline/`). Once the forms are ported
into `packages/api` + `packages/web`, this reference can be dropped.

## Rules
- **Read-only.** Never edit, create, or delete files under `./sfaforms`. Build
  all new work in `packages/*`. If the folder is missing, recreate the link with
  `ln -s ../sfaforms sfaforms` from the repo root.
- **Port, don't copy.** `sfaforms` is a throwaway Next.js App Router scaffold
  with a **localStorage mock API** (`src/lib/mockApi.ts`) and hand-rolled UI
  primitives (`src/components/ui/`). In AIOS-SFA the same flow becomes:
  - **Persistence:** NestJS controllers/services + the existing Mongoose schemas
    (`households`, `quotes`, `deals`, `auditRecords`) — **never** localStorage.
  - **UI:** `packages/web` shadcn/ui primitives + design tokens — **not** the
    prototype's `Input`/`Select`/`Card`/`Checkbox`/`FileInput`.
  - **Uploads:** real file storage, not base64 `dataUrl` blobs.
  - **Routing:** React Router 7 routes under `ProtectedRoute`, behind the
    `leads` / `quote_recaps` / `deal_audits` module keys + permissions.
  - **Keep:** the zod schemas (bound via **TanStack Form**, not the prototype's
    `react-hook-form` + resolvers — that library is fully removed here), the
    session-isolated entity-driven flow (`?householdId=` / `?quoteId=`), the
    field arrays, the
    "Same as Household Address" toggle, and the sold → audit auto-trigger.

## What's in `./sfaforms`
| Path | What it is |
|---|---|
| `src/app/page.tsx` | Index linking the 3 forms |
| `src/app/lead/new/page.tsx` → `src/components/forms/NewLeadForm.tsx` | **Phase 1 — New Lead / Household** |
| `src/app/quote/new/page.tsx` → `src/components/forms/QuoteRecapForm.tsx` | **Phase 2 — Quote Recap** (reads `?householdId=`) |
| `src/app/sold/new/page.tsx` → `src/components/forms/SoldForm.tsx` | **Phase 3 — Sold Deal** (reads `?householdId=&quoteId=`), auto-creates the audit record |
| `src/lib/mockApi.ts` | Entity types + localStorage CRUD — the **de-facto data contract** for the ported DTOs |
| `src/components/ui/` | Throwaway primitives — do not port |
| `src/__tests__/SoldToAuditFlow.test.tsx` | Asserts Sold submit ⇒ pending `AuditRecord` with 4 unchecked flags |

## Prototype ≠ spec
The prototype implements a **flattened, single-page** version of the Sold form.
`docs/form-pipeline/Form Pipeline Technical Specification.md` (v2.0) is the
**authoritative scope** and is considerably larger — an 8-card wizard with a
policy loop, `GET /api/policies/check` dedupe, and highly conditional discount /
documentation branching that drives the audit flags. Where the two disagree, the
spec wins; the prototype only shows shape and interaction patterns.

Known gaps in the prototype vs. the spec: no multi-step card wizard or policy
loop, no policy-number dedupe check, no Carrier field, no quote Notes field, no
"Child" household-member role, no per-policy discount conditionals (escrow /
fire / roof / Drivewise / defensive driver / student), no prior-insurance
"none" toggle, no cancellation card, escrow unconditionally required, and the
audit checklist is a fixed 4 booleans instead of dynamically generated flags.

## Legacy Fillout forms this replaces (in `./SFA`)
The legacy app embedded hosted Fillout forms (`paciscigroup.fillout.com/t/<id>`)
and ingested them via webhooks. Source of record:
- `SFA/lib/filloutForms.ts` / `SFA/lib/filloutConfig.ts` — form URLs.
- `SFA/lib/intake/formRegistry.ts` — New-Lead form variants + field-name mapping.
- `SFA/app/api/webhooks/fillout/{new-lead,quote-recap,sold-log}/route.ts` —
  ingest + normalisation (behaviour source-of-truth for the ported endpoints).
- `SFA/app/api/quote-recaps/start/route.ts`, `SFA/app/api/leads/[id]/mark-sold/route.ts` —
  prefill-URL construction (which fields were pre-populated).
