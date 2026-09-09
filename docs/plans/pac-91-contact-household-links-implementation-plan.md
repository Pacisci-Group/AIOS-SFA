# PAC-91 — Contacts / households: implementation plan

Ticket: https://linear.app/paciscigroup/issue/PAC-91 (the ticket is authoritative; this plan is the execution order).
Branch: `asad/pac-91-contacts-households-domain-model` (off `dev`). **The whole ticket ships as one PR**, built in five phases; each phase is left green on `build` / `lint` / e2e / Bruno before the next starts, so the branch is mergeable at every phase boundary if priorities change.
Paths are relative to the repo root; `api/` = `packages/api/`, `web/` = `packages/web/`, `shared/` = `packages/shared/`.

## Context

PAC-91 is a living list of places where the Mongo schema copied a SmartSuite *field type* instead of the domain. §8 (added 2026-09-07) is the production-blocking one: **most migrated contacts have no `householdId` and no migrated household has a `primaryContactId`**, because the importer reads the contact's single `Household` link (`s66cf9402f`), which the legacy app only ever wrote for form-created contacts, and never reads the household-side `Primary Contact` (`sdb36b3217`) / `Household Members` (`suxra4lb`) at all. §9 (same day) adds the owner's identity rule: a contact is unique on **DOB + full name + phone or email**.

David (owner) supplied SmartSuite CSV exports dated 2026-09-04 to repair production without a full re-import: `temp/Contacts 9_4_2026.csv` (3,064 rows), `temp/Households 9_4_2026.csv` (2,519), `temp/Policies 9_4_2026.csv` (4,328). `temp/` is gitignored and lives in the main checkout only.

**Measured on the restored production dump (2026-09-07, local `sfa` database):**

| | Count |
|---|---|
| Migrated contacts with `legacyHouseholdId` (= `s66cf9402f` was set) | 1,060 of 3,064 (35%) |
| Of those, agree with the export's household-side link / disagree | 1,040 / 2 (#C00023 Bennett, #C02694 Shurtleff) |
| Migrated contacts fillable from the export | 1,700 |
| Migrated contacts with no link on either side | 304 |
| Migrated households with a `primaryContactId` | 2 of 2,519 — both set by intake to an *app-created* contact while the export names a migrated one |
| Migrated leads with `legacyHouseholdId` / with `householdId` | 961 / 41 |
| Policies: agree with export / no household either side | 4,192 / 136 (nothing to repair) |
| App-created since go-live (no legacy id) | 42 contacts, 28 households, 25 policies |
| Contacts with a DOB | 2,784 of 3,106 |
| Contacts with more than one email or phone | 0 |

What the exports established on their own (full numbers in the ticket §8/§9):
- Household-side links are complete enough to use: 2,440 households have a primary, 2,233 have members; 322 contacts have no link at all (6 are Sample/Test rows, the rest the agency will link by hand after go-live).
- **266 primaries are not in their household's member list** — membership must be the *union* of the two link columns.
- 13 contacts belong to 2–3 households (the §5 many-to-many case is real but tiny); **4 contacts are primary of two households**, which contradicts the owner's "primary of at most one" rule and would make the §5 partial unique index fail to build.
- 47 full-key duplicate groups (48 contacts) under the §9 identity rule; 244 further groups share only a name.
- CSV quirk: multi-valued *rec-id* columns are ` | `-separated, the `#HH1234` *title* columns are `, `-separated.

Decisions this plan fixes (the ticket left them open; each is confined to one phase):
- **Repair production with a CSV-driven backfill, not a migration re-run.** `MigrationService.persist` `$set`s every mapped field on every migrated row, so a re-run would overwrite whatever the agency has edited on migrated records since go-live. The backfill touches link fields only and never matches a document without a `legacySmartSuiteId`.
- **Link semantics are "fill, never move".** `Contact.householdId` and `Household.primaryContactId` are set only when empty; a stored value that disagrees with SmartSuite is a *conflict row in the report*, not a write. `memberContactIds` is `$addToSet`. Re-running is a no-op. The dump already shows both conflict classes (2 contacts, 2 households).
- **Phase 1 writes to the schema as it is today** (`householdId` + `memberContactIds` + `primaryContactId`), because that is what every reader uses now. The household side keeps every membership, so nothing is lost when the §5 join collection lands in Phase 3 and is seeded from `memberContactIds`.
- **Denormalised copies go (§1, option "read through `primaryContactId`").** `Household.primaryContactName/primaryEmails/primaryPhones` and `Lead.emails/phones` are dropped in Phase 2; list endpoints `$lookup` the primary contact. §7's succession cascade is the deciding argument.
- **Membership model = `householdMembers` join collection** (§5 "preferred"), because role is per membership.
- **Death of a primary = successor named in the same operation, falling back to a data-quality flag** (§7 recommendation (a) → (c)). No auto-promotion.
- **Which migration mechanism for which job.** `dev` now has `migrate-mongo` (`api/migrations/`, runs at API boot, raw `db` handle, immutable once applied — see `api/migrations/README.md`). Use it for every change that needs **no external input**: index rebuilds, array→scalar conversion, key stamping, seeding the join collection. Keep a **CLI script under `api/src/migration/backfill/`** (the `allstate-id-to-carrier-appointment.ts` pattern: `--dry-run`, discovery by field presence, report) for anything that needs a **file or a human decision**: the CSV link backfill and the duplicate merge.

Reference material: legacy `SFA/lib/intake/resolveHousehold.ts` (the three-field fallback order the importer should mirror) and `SFA/lib/intake/linkEntities.ts` (which side legacy wrote), `docs/smartsuite-tables/The Contacts Table.md` / `The Households Table.md` / `The Leads Table.md` (field ids), `AGENTS.md` §11 and `api/migrations/README.md` (data-migration house rules).

---

## Phase 1 — Link repair: importer fix + CSV backfill for production

### 1.1 Field ids — `api/src/migration/smartsuite/field-ids.ts`
- `HOUSEHOLD_FIELDS`: add `primaryContact: 'sdb36b3217'`, `householdMembers: 'suxra4lb'`.
- `CONTACT_FIELDS`: add `householdPrimaryBacklink: 'sljrnhhg'`, `householdMemberBacklink: 'su8pm1bp'`, with a docblock stating that `household` (`s66cf9402f`) is the writable single link legacy set **only** from the intake form, and the two back-links mirror the household-side fields that everything else populated.
- `LEAD_FIELDS`: add `primaryInsured: 's8754c9e3b'`, `householdMembers: 'sa3501b7c2'` (single link despite the name).
- `docs/smartsuite-tables/README.md`: a short "read side vs write side" note for household links, so the next importer does not repeat this.

### 1.2 Contact household resolution — `migration.service.ts` `migrateContacts` (~L1024)
- Replace `firstLinkedId(rec[CONTACT_FIELDS.household])` with a helper `resolveContactHousehold(rec)` in `api/src/migration/helpers/derive.ts` returning `{ householdLegacyId, memberLegacyIds, primaryLegacyIds, via: 'household' | 'primary-backlink' | 'member-backlink' | 'none' }`: legacy's order — `s66cf9402f[0]`, else `sljrnhhg[0]`, else `su8pm1bp[0]`; `memberLegacyIds` = union of all three, primary-first.
- `migrateContacts` returns `Map<legacyId, ObjectId>` (it currently returns `void`); `run()` (~L324) keeps it for 1.3.
- Report: extend `CollectionStat` in `api/src/migration/report.ts` with an optional `householdLinks: { viaHouseholdField, viaBacklink, unlinked, multiMembership, multiPrimary }` block, printed by `printReport`. This is the §6 reconciliation count the ticket asks for.

### 1.3 New link pass `migrateHouseholdLinks` — runs after contacts and leads, before quote recaps
- `migrateHouseholds` keeps, per household, `{ id, legacyPrimaryContactId, legacyMemberIds }` (change its return type to `Map<string, HouseholdEntry>` and adapt the ~12 `this.ref(legacyHouseholdId, households)` call sites via a small `householdRef()` helper, so no other importer changes semantics).
- For each household: `primaryContactId` = contacts map lookup of `legacyPrimaryContactId`; `memberContactIds` = union(members, primary) resolved through the contacts map. Write with `updateOne({ _id }, { $set: { primaryContactId }, $addToSet: { memberContactIds: { $each } } })` — `$set` is correct here because on a *first* import the migration is the source of truth, and on a re-run the value it writes is the same legacy fact. Unresolvable ids (a contact the migration skipped) are counted, not fatal.
- For each migrated lead: set `householdId` from `legacyHouseholdId`, `primaryContactId` from `LEAD_FIELDS.primaryInsured` (fallback: the household's primary), `memberContactIds` from `LEAD_FIELDS.householdMembers`. This closes ticket §2's "migration never sets `householdId` / `primaryContactId` on a lead".
- Order in `run()`: users → households → contacts → leads → **household links** → quote recaps → …
- Docblock: why a separate pass exists (households are imported before contacts, so `primaryContactId` cannot be set in the household pass).

### 1.4 CSV loader — `api/src/migration/backfill/smartsuite-csv.ts` (+ `smartsuite-csv.unit-spec.ts`)
- Pure functions, no Mongo: `parseContactsCsv`, `parseHouseholdsCsv`, `parsePoliciesCsv` → typed rows keyed by `Record ID`, built on `csv-parse` (already a dependency; `bom: true`). Split rec-id columns on `/\s*\|\s*/`, title columns on `,`; assert the two counts agree per row (they do on the 2026-09-04 files, and a mismatch means a format change).
- Unit tests: pipe vs comma, a row with 3 memberships, an empty column, BOM on the header.

### 1.5 Backfill script — `api/src/migration/backfill/backfill-household-links.ts`
CLI: `npm run backfill:household-links:dev -w @sfa/api -- --agency smith-family-agency --contacts <csv> --households <csv> [--policies <csv>] [--dry-run] [--report <path>]` (add `backfill:household-links` / `:dev` to `api/package.json` and the root passthroughs; run through the workspace, never the root alias, which swallows flags). Bare Mongoose connection, no models (same reason as the appointments script: loading schemas fires `autoIndex`).

Semantics, in order, all keyed on `{ agencyId, legacySmartSuiteId }` and all idempotent:
1. Load the three CSVs; build `legacyId → ObjectId` maps for `households` and `contacts` from Mongo (one `find` each, projection `_id legacySmartSuiteId householdId primaryContactId memberContactIds isTestRecord`). `agencyId` is a **string** on `TenantRecord` — querying with an `ObjectId` silently matches nothing.
2. **Contacts.** For each CSV contact present in Mongo: target household = `primary household rec id[0]` else `household member rec id[0]`. If `householdId` is empty → `$set` it and `legacyHouseholdId`. If set and equal → no-op. If set and different → **conflict row** (`contact`, stored, csv), no write. Count `unlinkedInSource` (304 expected on the dump).
3. **Households.** For each CSV household present in Mongo: `primaryContactId` from the contact whose `primary household rec id` names it. Empty → `$set`; equal → no-op; different → **conflict row**, no write (the 2 intake-set households on the dump land here). `memberContactIds` ← `$addToSet $each` of union(members, primary). A CSV contact missing from Mongo is counted as `contactNotMigrated`.
4. **Leads.** For each lead with `legacyHouseholdId` and no `householdId`: `$set householdId` from the map; if `primaryContactId` is empty, `$set` it from the household's (now filled) `primaryContactId`. Never touches a lead that already has either.
5. **Policies (verification only, `--policies`).** Compare `Policy.householdId` against `Household Rec Id`; report agree / differ / missing. The dump shows 4,192 agree and 0 differ, so no `--fix-policies` flag is written.
6. Never writes `isTestRecord`, names, emails, phones, or anything on a document without `legacySmartSuiteId`. Writes run without request context, so `updatedBy` stays null ("system", per `AGENTS.md`); do not mint a placeholder user.
7. Report: JSON to `--report` plus a console table — per collection `{ matched, filled, alreadyCorrect, conflicts, notInMongo, notInCsv }`, then the conflict rows in full (they are the list an employee has to look at). `--dry-run` prints the same report with zero writes.

Runtime: three collection scans and ~5k `updateOne`s; `bulkWrite` in batches of 500 (updates, so no `authorshipForInsert`).

### 1.6 Rehearsal and production run
1. The restored dump first needs `migrate:tickets:dev` and `backfill:appointments:dev` (both on `dev`), run from this worktree with `--dry-run` first. Record the "before" counts from the table above.
2. `--dry-run` → read every conflict row. Expected: the 2 contact conflicts and the 2 household conflicts already identified; anything else is a script bug.
3. Real run → re-run → the second run must report zero `filled` and identical conflicts.
4. Spot-check in the Clients page and the Household drawer (`/clients`) that a previously blank household now shows its primary; open a migrated lead and confirm the household card.
5. Attach the before/after report to PAC-91 as a comment. Then run against production the same way (dry-run first, report attached).
6. After production: the 304 unlinked contacts and the conflict rows go to David as the manual follow-up list.

### 1.7 Tests and docs
- Unit: `smartsuite-csv.unit-spec.ts`; `resolveContactHousehold` cases in `mappers.unit-spec.ts` (all three sources, empty, multi); the backfill's decision table (fill / equal / conflict) over an in-memory model.
- No API surface changes → no Bruno changes in this phase.
- `docs/SESSION-HANDOFF.md`: one paragraph pointing at the backfill and the CSV location.

### 1.8 Owner decisions (David, Slack, 2026-09-07) — applied by the backfill as a final `--apply-owner-decisions` step
Kept in one committed file, `api/src/migration/backfill/pac-91-owner-decisions.json`, so the rehearsal and the production run apply exactly the same list and the report shows each item.

- **Remove households `HH-4717`, `HH-4718`, `HH-4764`, `HH-4313`, `HH-0032`.** Resolves every double primary: Adeyemi keeps #HH3932, Bizzell #HH3458, Dewayne Allen #HH3690, Miskowiak #HH4314. Per household: (1) reference check — refuse and report if any `policies`, `deals`, `quoteRecaps`, `serviceTickets`, `priorInsurance`, `priorPolicies` or `interestedParties` row points at it (none do on the dump); (2) re-point `leads` with `householdId`/`legacyHouseholdId` on it to the contact's kept household (one lead on HH-4717 → HH-3932); (3) clear `contact.householdId`/`legacyHouseholdId` where it names the removed household and re-run the contact fill so it lands on the kept one; (4) delete the household document. `HH-0032` also gets its junk policy `00006` flagged `isTestRecord`.
- **Flag test rows:** households `HH-0001`–`HH-0017` and contacts #C00001, #C00002, #C00003, #C00018, #C00019, #C00034 → `isTestRecord: true` (`scope-filter.ts` already hides them from every producer-facing read).
- **Duplicate policy 856719796:** two distinct SmartSuite rows with identical values and no whitespace difference; delete the newer (`legacySmartSuiteId` `6968735d3852d860110a1024`), keep `696135463c06f3648be9cbeb`. Refuse if the newer one has gained a household, deal or ticket since.
- **`HH-3149`:** Brianne Ray (only member, Named Insured, one active policy) becomes primary. Decided 2026-09-07 — no owner input is outstanding for Phase 1.
- **Unlinked policies (136) and contacts (~304) stay unlinked.** David wants the team to work from a list in the app → Phase 5.

Every action above is idempotent (a removed household is simply absent on re-run; a flag already set is a no-op) and counted in the report under `ownerDecisions`.

---

## Phase 2 — Scalars, the end of the denormalised copies, contact identity (§1–§4, §9)

This is the phase that fixes **"leads show no phone / email"** (§2, §3): the lead stops carrying its own copy and the Leads list, Hot Leads and Lead Detail read the primary contact through `primaryContactId` (which Phase 1 fills on every migrated lead). Nothing is "backfilled onto the lead" — the copy is deleted, not repaired.

### 2.1 Schemas
- `Contact.email?: string`, `Contact.phone?: string` (normalised: lowercase email, digits/E.164 phone via `intake.normalize.ts`). Remove `emails`/`phones`.
- `Lead`: remove `emails`/`phones`. `Household`: remove `primaryContactName`/`primaryEmails`/`primaryPhones`.
- Index: `{ agencyId, email }` and `{ agencyId, phone }` partial on `$type: 'string'` (replaces the regex-over-array search in `leads.service.ts:274–282`).

### 2.2 Versioned migration — `api/migrations/<ts>-contact-scalars.js` (migrate-mongo)
- Discover by `$type: 'array'` on each field, take `[0]`, `$unset` the array; count rows with `>1` element and log them (the ticket's footprint number — 0 on the dump). Idempotent; `down` throws (a scalar cannot be turned back into "the array it came from").
- `$unset`s the three household copies and the two lead copies. Ships in the same PR as the read path (2.4), so no deploy ever runs the old readers against the new shape.

### 2.3 Writers
- `migration.service.ts:1033, 1109` and the household pass: first element, count `>1` into the report.
- Intake: `resolve-contact.step.ts` / `resolve-lead.step.ts` from `$addToSet` to **fill-if-empty**; a differing submitted value produces an `activities` entry of type `contact_conflict` (new enum member in `shared`) instead of a second value.
- Seeds: `demo-seed.service.ts`, `onboarding-scenarios.ts`, `renewal-scenarios.ts`, `scroll-fixtures.ts`, `post-sale-fixture.ts`.

### 2.4 Readers — every `?.[0]` in the ticket's §1 list
- API: `leads.service.ts:353`, `hot-leads.service.ts:227` gain a `$lookup` on `contacts` by `primaryContactId` (falls back to the lead's own `firstName/lastName` when unlinked). `contacts.service.ts:145`, `crm/lead-tickets.service.ts:138–145`, `crm/service-tickets.service.ts:547–605, 1503` read the contact. `contact-match.ts` scores scalars.
- Web: `LeadContactCard.tsx:92`, `HouseholdProfile.tsx:147`, `start-quote-prefill.ts:84`, `HouseholdDrawer.tsx:74`; remove the PAC-86 fallback once the household response carries the primary contact.
- Shared/DTO/Bruno: `shared/src/clients/client-records.ts`, `shared/src/domain/lead-detail.ts`, `web/src/lib/service-tickets-api.ts`, and the `docs` block of every Bruno request that returns a contact, lead or household.

### 2.5 Rule
- `AGENTS.md` §11 and `docs/smartsuite-tables/README.md`: "model the domain, never the SmartSuite field type", with the array/select/date-object examples from the ticket.

### 2.6 Contact identity — one person, one contact (ticket §9)
Owner rule (2026-09-07): a contact is unique on **date of birth + full name + phone or email**. Two rows with the same name, the same DOB and either the same phone *or* the same email are the same person.

- **Keys on `Contact`:** `nameKey` (`"<first> <last>"` lowercased, whitespace collapsed, from the existing `normalizeName`), `dobKey` (`YYYY-MM-DD` from `toDateKey`), plus the scalar `email` / `phone` from 2.1. Stamped by a pre-save/`findOneAndUpdate` hook so no writer can forget them; the 2.2 migration computes them for existing rows.
- **Enforcement = two partial unique indexes**, because the rule is an OR and every leg is optional (on the dump 322 contacts have no DOB, 611 have neither phone nor email):
  `{ agencyId, nameKey, dobKey, phone }` and `{ agencyId, nameKey, dobKey, email }`, each with `partialFilterExpression` requiring all four to be `$type: 'string'`. A row missing any leg is not indexed, which is the honest position — we cannot call it a duplicate. Declared on the schema **and** created by a migrate-mongo migration that runs *after* the merge script has been applied and **checks for conflicting data first** (README rule 4): the boot-time migration must fail loudly, not build a non-unique index or drop anything.
- **One check for every writer** — `ContactIdentityService.findDuplicate(agencyId, person)` in `api/src/contacts/`: exact match on the full key, `isTestRecord: { $ne: true }`, no household filter. Used by:
  - intake `resolve-contact.step.ts` — runs *before* the PAC-37 fuzzy scorer; a full-key hit is a definite match. The scorer keeps handling the partial-key cases exactly as today, since a missing DOB still cannot prove identity either way.
  - the Household form (`POST /households`, pipeline phase 1 contacts array) and any contact create/edit endpoint — a hit returns **409** carrying the existing `contactId` so the UI can offer "use existing" instead of creating a second person. A `PATCH` that would *make* a contact collide is refused the same way. E11000 on either index maps to the same 409 (belt and braces for concurrent writes).
  - migration and seeds — migration counts collisions into the report instead of upserting a second row; seeds are fixed so they do not produce any.
- **Existing duplicates must be merged before the index can build.** `api/src/migration/backfill/merge-duplicate-contacts.ts` (CLI, `--dry-run`, report): group by full key, keep the row with a household link (else the oldest), repoint every reference to the loser (`households.primaryContactId` / `memberContactIds`, `leads.primaryContactId` / `memberContactIds`, `quoteRecaps`, `deals`, `policies`, `serviceTickets`, `activities` — grep for `contactId` refs when writing it), union memberships, then delete the loser and record the pair. Runs **after** Phase 1's link backfill so "has a household link" is meaningful. Because it needs a reviewed dry-run, it is a script, not a boot-time migration — and the index migration above is what stops a deploy from proceeding if it was skipped.
- **Out of scope here, filed as a follow-up:** a UI merge tool for the 244 name-only groups the rule cannot decide (same name, different or missing DOB). Those are for the agency to judge by hand; the script never touches them.
- Tests: unit spec for the key derivation and for `findDuplicate` (each leg missing, phone-only hit, email-only hit, DOB conflict); e2e for the 409 on intake and on the Household form; Bruno docs for the new 409 on every contact-creating request.

---

## Phase 3 — Membership model (§5, §6)

### 3.1 Schema — `api/src/households/schemas/household-member.schema.ts`
- Collection `householdMembers`: `{ agencyId, branchId, householdId, contactId, role, addedAt, endedAt?, legacySource?: 'smartsuite' | 'intake' }`, extends `TenantRecord`. Unique `{ agencyId, householdId, contactId }`; `{ agencyId, contactId }`.
- `Household`: partial unique index `{ agencyId, primaryContactId }` on `$type: 'objectId'`, created by a migrate-mongo migration that **checks for duplicates first** — the 4 double-primary contacts from 1.8 will fail it until resolved, and that failure must be loud.
- `Contact`: `householdId`, `legacyHouseholdId`, `isPrimary`, `roleInHousehold` removed **last**, after 3.3 and 3.4 (a second migration `$unset`s them).

### 3.2 Versioned migration — `api/migrations/<ts>-seed-household-members.js`
- One row per `(household, contactId ∈ memberContactIds ∪ {primaryContactId})`, role from `Contact.roleInHousehold`; idempotent via the unique index (`ordered: false`, ignore E11000). Then the SmartSuite migration writes memberships directly in the 1.3 pass (union of the three link sources) and the report count is the §6 reconciliation.

### 3.3 Intake
- `link-entities.step.ts`: "add a membership" (upsert into `householdMembers`), never `$set contact.householdId`; no `$pull`.
- `resolve-household.step.ts:111`: household comes from the pin or the lead; for an unpinned multi-household contact return a `409`-shaped `IntakeAmbiguousHousehold` the form surfaces as a chooser (choose explicitly, never guess).
- `resolve-contact.step.ts:71`: pinned filter becomes "has a membership in this household"; an agency-wide name hit on another household's member is a match to *add* a membership to.
- Ending a membership: `DELETE /households/:id/members/:contactId` sets `endedAt` (soft), `clients:write`.

### 3.4 Readers
- `contacts.service.ts:148`, `HouseholdDrawer.tsx:67`, `HouseholdProfile.tsx:139`, `start-quote-prefill.ts:68`: household-scoped responses carry `isPrimary = contact._id equals household.primaryContactId` and `role` from the membership; no contact-global flag.
- Bruno: households/members endpoints, contacts response shape.

---

## Phase 4 — Deceased contacts and primary-contact reassignment (§7)

- `Contact.deceasedAt?: Date`; `PATCH /contacts/:id` accepts it (`clients:write`).
- `POST /households/:id/primary-contact { contactId }` (`clients:write`): must be a current member, must not be primary elsewhere (pre-check, then rely on the 3.1 index; E11000 → 409 with a usable message), writes an `activities` entry `primary_contact_changed`.
- Marking the current primary deceased requires `successorContactId` in the same request; without one the request succeeds only with `allowNoPrimary: true`, which sets `Household.dataQuality: 'no_primary'` for a Clients-page filter (rule (a) → (c)).
- Forward-looking exclusions: `resolve-contact.step.ts` matching, successor pickers, quote prefill and outbound details skip `deceasedAt`-set contacts; historical records keep rendering the name.
- UI: an action on the Household profile, and a "Mark deceased" on the contact card that opens the successor picker when needed.
- Bruno for both endpoints; e2e for the exclusivity failure and the deceased-primary path.

---

## Phase 5 — "Unlinked records" work list for the team (ticket §10)

David's answer to "what about the records the backfill cannot link": leave them, but give the team a list to work from. Deliberately the smallest thing that does that.

- `GET /clients/unlinked?kind=policies|contacts|households` (`clients:read`, agency scope): policies without `householdId`, contacts without a household (Phase 3: without a membership), households without `primaryContactId`. Excludes `isTestRecord`. Paginated, sorted newest first, plus a `counts` endpoint (or the same route with `kind=summary`) for the three numbers.
- Web: an **Unlinked** tab on the Clients page (`web/src/features/clients/`) with the three filters as chips showing their counts; each row opens the existing record page where the existing link/assign actions live. No new actions are built here — if assigning a policy to a household has no UI yet, that is its own ticket and this view just makes the gap visible.
- Bruno: the new request(s) with docs; e2e: one case per kind plus the test-record exclusion.
- Not here: the 244 name-only duplicate groups (need a merge tool — follow-up ticket).

---

## Verification checklist per phase
- `npm run build -w @sfa/api` (lint alone does not typecheck), `npm run lint -w @sfa/api`, `-w @sfa/web`.
- `npm run build -w @sfa/shared` before e2e/Bruno (they read `dist`). In a worktree, make sure `@sfa/shared` resolves *inside the worktree* first.
- e2e with no live `api:dev` running; Bruno `cd bruno && npx @usebruno/cli run --env Local`.
- Every migrate-mongo migration: `npm run db:migrate:status -w @sfa/api` shows it pending, `db:migrate` applies it, a second `db:migrate` is a no-op, and `down` either reverses it or throws.
- Phase 1 additionally: the rehearsal in 1.6 with the before/after report attached to the ticket. Phase 2 additionally: the duplicate-merge dry-run report attached to the ticket.
