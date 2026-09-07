import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { config as loadEnv } from 'dotenv';
import { createConnection, Types } from 'mongoose';
import type { AnyBulkWriteOperation, Collection, Db } from 'mongodb';
import { ENV_FILE_PATH } from '../../config/env.config';
import {
  buildHouseholdMembership,
  decideLink,
  pickTargetHousehold,
} from './household-link-decisions';
import {
  parseContactsCsv,
  parseHouseholdsCsv,
  parsePoliciesCsv,
  type ContactCsvRow,
  type PolicyCsvRow,
} from './smartsuite-csv';

/**
 * One-off, re-runnable: repair the contact ↔ household links on a database that
 * was migrated before the importer read the household side (PAC-91 §8).
 *
 * USAGE
 * -----
 *   npm run backfill:household-links:dev -w @sfa/api -- \
 *     --agency smith-family-agency \
 *     --contacts "temp/Contacts 9_4_2026.csv" \
 *     --households "temp/Households 9_4_2026.csv" \
 *     --policies "temp/Policies 9_4_2026.csv" \
 *     --apply-owner-decisions --dry-run --report ./pac-91-backfill.json
 *
 * ⚠ Run it through the workspace, not the root alias: the root scripts swallow
 * everything after `--`, so the flags silently vanish. `-w` also runs the
 * script with `packages/api` as the working directory, so give the CSVs as
 * absolute paths rather than paths relative to the repo root.
 *
 * WHY A SCRIPT AND NOT A RE-RUN OF THE MIGRATION
 * ----------------------------------------------
 * `MigrationService.persist` `$set`s every mapped field on every migrated row.
 * Re-importing to fix links would therefore overwrite whatever the agency has
 * edited on migrated records since go-live. This touches **link fields only**.
 *
 * WHY A SCRIPT AND NOT A migrate-mongo MIGRATION
 * ----------------------------------------------
 * It needs an external file (the 2026-09-04 SmartSuite exports) and a reviewed
 * dry-run. `migrations/README.md` draws the line there.
 *
 * SAFETY RULES, all enforced below
 * --------------------------------
 * - Every match is keyed on `{ agencyId, legacySmartSuiteId }`. A document
 *   without a legacy id was created in the app and is **never** touched — that
 *   is the 42 contacts / 28 households / 25 policies added since go-live.
 * - `agencyId` on `TenantRecord` is a **string**. A query with an `ObjectId`
 *   silently matches nothing, which looks exactly like an empty database.
 * - Links are **fill-if-empty**. A stored value that disagrees with the export
 *   is a conflict row in the report, never a write — that is the case where an
 *   employee has already linked the record by hand. `memberContactIds` is
 *   `$addToSet`, so intake-added members survive.
 * - Nothing writes names, emails, phones or `isTestRecord` — except the
 *   `--apply-owner-decisions` step, which writes exactly the committed list in
 *   `pac-91-owner-decisions.json` and nothing else.
 * - Idempotent: a second run reports zero fills and the same conflicts.
 * - Writes run with no request context, so `updatedBy` stays null ("system",
 *   per AGENTS.md §11). No placeholder user is minted.
 * - Bare Mongoose connection, no models: loading the schemas would fire
 *   `autoIndex` while this is running.
 */

loadEnv({ path: ENV_FILE_PATH });

/** `bulkWrite` batch size. ~5k updates across three collections. */
const BATCH_SIZE = 500;

/** Collections that must not still point at a household being removed. */
const HOUSEHOLD_REFERENCE_COLLECTIONS = [
  'policies',
  'deals',
  'quoteRecaps',
  'serviceTickets',
  'priorInsurance',
  'priorPolicies',
  'interestedParties',
] as const;

interface Options {
  agencySlug: string;
  contactsCsv: string;
  householdsCsv: string;
  policiesCsv?: string;
  decisionsPath: string;
  applyOwnerDecisions: boolean;
  dryRun: boolean;
  reportPath?: string;
}

function parseOptions(argv: string[]): Options {
  const has = (flag: string) => argv.includes(flag);
  const value = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith('--')
      ? argv[index + 1]
      : undefined;
  };

  const contactsCsv = value('--contacts');
  const householdsCsv = value('--households');
  if (!contactsCsv || !householdsCsv) {
    throw new Error(
      'Both --contacts <path> and --households <path> are required ' +
        '(the SmartSuite CSV exports).',
    );
  }

  return {
    agencySlug: value('--agency') ?? 'smith-family-agency',
    contactsCsv,
    householdsCsv,
    policiesCsv: value('--policies'),
    decisionsPath:
      value('--decisions') ?? resolve(__dirname, 'pac-91-owner-decisions.json'),
    applyOwnerDecisions: has('--apply-owner-decisions'),
    dryRun: has('--dry-run'),
    reportPath: value('--report'),
  };
}

// ---------------------------------------------------------------------------
// Shapes read out of Mongo (raw driver — no models, see the docblock)
// ---------------------------------------------------------------------------

interface HouseholdDoc {
  _id: Types.ObjectId;
  legacySmartSuiteId: string;
  householdRef?: string;
  name?: string;
  primaryContactId?: Types.ObjectId;
  memberContactIds?: Types.ObjectId[];
  isTestRecord?: boolean;
}

interface ContactDoc {
  _id: Types.ObjectId;
  legacySmartSuiteId: string;
  firstName?: string;
  lastName?: string;
  householdId?: Types.ObjectId;
  legacyHouseholdId?: string;
}

interface LeadDoc {
  _id: Types.ObjectId;
  firstName?: string;
  lastName?: string;
  householdId?: Types.ObjectId;
  legacyHouseholdId?: string;
  primaryContactId?: Types.ObjectId;
}

interface PolicyDoc {
  _id: Types.ObjectId;
  legacySmartSuiteId: string;
  policyNumber?: string;
  householdId?: Types.ObjectId;
  dealId?: Types.ObjectId;
}

// ---------------------------------------------------------------------------
// Owner decisions (pac-91-owner-decisions.json)
// ---------------------------------------------------------------------------

interface RemoveHouseholdDecision {
  householdRef: string;
  recordId: string;
  reason: string;
  repointLeadsTo?: string;
  repointLeadsToRecordId?: string;
  unlinkLeads?: boolean;
}

interface OwnerDecisions {
  removeHouseholds: RemoveHouseholdDecision[];
  flagTestHouseholds: { householdRef: string; recordId: string }[];
  flagTestContacts: { contactRef: string; recordId: string }[];
  flagTestPolicies: { policyNumber: string; recordId: string }[];
  deletePolicies: {
    policyNumber: string;
    recordId: string;
    keepRecordId: string;
  }[];
  setPrimaryContacts: {
    householdRef: string;
    recordId: string;
    contactRef: string;
    contactRecordId: string;
  }[];
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

interface ConflictRow {
  kind: 'contact-household' | 'household-primary' | 'policy-household';
  ref: string;
  recordId: string;
  label: string;
  stored: string;
  inExport: string;
}

interface ContactStats {
  inCsv: number;
  matched: number;
  filled: number;
  alreadyCorrect: number;
  conflicts: number;
  notInMongo: number;
  notInCsv: number;
  unlinkedInSource: number;
  householdNotMigrated: number;
  targetRemovedByOwner: number;
}

interface HouseholdStats {
  inCsv: number;
  matched: number;
  primaryFilled: number;
  primaryAlreadyCorrect: number;
  primaryConflicts: number;
  noPrimaryInSource: number;
  ambiguousPrimary: number;
  membersAdded: number;
  householdsGainingMembers: number;
  contactNotMigrated: number;
  notInMongo: number;
  notInCsv: number;
}

interface LeadStats {
  candidates: number;
  householdFilled: number;
  primaryContactFilled: number;
  householdNotMigrated: number;
}

interface PolicyStats {
  checked: number;
  agree: number;
  differ: number;
  fillableFromExport: number;
  noHouseholdEitherSide: number;
  notInMongo: number;
}

interface OwnerDecisionsReport {
  testHouseholdsFlagged: number;
  testContactsFlagged: number;
  testPoliciesFlagged: number;
  duplicatePoliciesDeleted: number;
  duplicatePoliciesRefused: number;
  householdsRemoved: number;
  householdsAlreadyRemoved: number;
  householdsRefused: number;
  testReferencesUnlinked: number;
  leadsRepointed: number;
  leadsUnlinked: number;
  contactsRelinked: number;
  contactsLeftUnlinked: number;
  primaryContactsSet: number;
  primaryContactsAlreadyCorrect: number;
  primaryContactsRefused: number;
}

interface BackfillReport {
  generatedAt: string;
  dryRun: boolean;
  agency: { slug: string; id: string };
  csv: { contacts: number; households: number; policies: number };
  contacts: ContactStats;
  households: HouseholdStats;
  leads: LeadStats;
  policies: PolicyStats;
  ownerDecisions?: OwnerDecisionsReport;
  conflictRows: ConflictRow[];
  refusals: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const idKey = (id: Types.ObjectId | undefined): string | undefined =>
  id ? id.toString() : undefined;

async function runBulk(
  collection: Collection,
  ops: AnyBulkWriteOperation[],
  dryRun: boolean,
): Promise<void> {
  if (dryRun || !ops.length) return;
  for (let i = 0; i < ops.length; i += BATCH_SIZE) {
    await collection.bulkWrite(ops.slice(i, i + BATCH_SIZE), {
      ordered: false,
    });
  }
}

/** A household's human label, for report rows a person has to read. */
function householdLabel(doc: HouseholdDoc | undefined): string {
  if (!doc) return '(not migrated)';
  return doc.householdRef ?? doc.name ?? doc._id.toString();
}

function contactLabel(row: ContactCsvRow): string {
  return (
    [row.firstName, row.lastName].filter(Boolean).join(' ') || row.contactRef
  );
}

function loadDecisions(path: string): OwnerDecisions {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<OwnerDecisions>;
  return {
    removeHouseholds: raw.removeHouseholds ?? [],
    flagTestHouseholds: raw.flagTestHouseholds ?? [],
    flagTestContacts: raw.flagTestContacts ?? [],
    flagTestPolicies: raw.flagTestPolicies ?? [],
    deletePolicies: raw.deletePolicies ?? [],
    setPrimaryContacts: raw.setPrimaryContacts ?? [],
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function run(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const uri = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/sfa';
  console.log(`Connecting to ${uri.replace(/\/\/[^@]+@/, '//****@')}`);
  console.log(
    options.dryRun
      ? 'DRY RUN — nothing will be written.\n'
      : 'LIVE RUN — link fields will be written.\n',
  );

  const connection = createConnection(uri);
  await connection.asPromise();
  const db = connection.db;
  if (!db) throw new Error('No database handle on the connection');

  try {
    const report = await backfill(db, options);
    printReport(report);
    if (options.reportPath) {
      const out = resolve(options.reportPath);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, JSON.stringify(report, null, 2), 'utf8');
      console.log(`\nReport written to ${out}`);
    }
    if (report.refusals.length) process.exitCode = 1;
  } finally {
    await connection.close();
  }
}

async function backfill(db: Db, options: Options): Promise<BackfillReport> {
  const agency = await db
    .collection('agencies')
    .findOne({ slug: options.agencySlug }, { projection: { _id: 1, name: 1 } });
  if (!agency) {
    throw new Error(`No agency with slug "${options.agencySlug}".`);
  }
  /*
   * ⚠ String, not ObjectId — `TenantRecord.agencyId` is a string, and an
   * ObjectId here matches nothing at all, which reads as an empty database.
   */
  const agencyId = agency._id.toString();
  console.log(`Agency: ${options.agencySlug} (${agencyId})\n`);

  /*
   * Refuse to run once membership has moved to `householdMembers` (PAC-91 §5).
   *
   * This script writes `Contact.householdId` and `Household.memberContactIds`,
   * which the Phase 3 migrations remove — so on a migrated database it would
   * resurrect two dead fields that nothing reads and that would then disagree
   * with the join collection. Its place in the production sequence is *before*
   * the deploy (link repair → duplicate merge → deploy → migrations), and this
   * is what makes running it out of order an error rather than a quiet mess.
   */
  const memberships = await db
    .collection('householdMembers')
    .countDocuments({ agencyId }, { limit: 1 });
  if (memberships > 0) {
    throw new Error(
      'This agency already has `householdMembers` rows, so the PAC-91 §5 ' +
        'membership migration has run. This backfill writes the pre-membership ' +
        'link fields and must not run after it — it belongs before the deploy. ' +
        'Nothing was written.',
    );
  }

  const csvContacts = parseContactsCsv(
    readFileSync(options.contactsCsv, 'utf8'),
  );
  const csvHouseholds = parseHouseholdsCsv(
    readFileSync(options.householdsCsv, 'utf8'),
  );
  const csvPolicies = options.policiesCsv
    ? parsePoliciesCsv(readFileSync(options.policiesCsv, 'utf8'))
    : new Map<string, PolicyCsvRow>();
  console.log(
    `Export: ${csvContacts.size} contacts, ${csvHouseholds.size} households, ` +
      `${csvPolicies.size} policies\n`,
  );

  const decisions = loadDecisions(options.decisionsPath);
  assertDecisionsMatchExport(decisions, csvContacts, csvHouseholds);
  /*
   * Known before anything is written, so a link never lands on a household the
   * owner has decided to remove — whichever order the steps run in.
   */
  const removedHouseholdIds = new Set(
    decisions.removeHouseholds.map((d) => d.recordId),
  );

  const households = db.collection('households');
  const contacts = db.collection('contacts');
  const leads = db.collection('leads');
  const policies = db.collection('policies');

  const legacyOnly = { agencyId, legacySmartSuiteId: { $type: 'string' } };

  const householdDocs = (await households
    .find(legacyOnly, {
      projection: {
        legacySmartSuiteId: 1,
        householdRef: 1,
        name: 1,
        primaryContactId: 1,
        memberContactIds: 1,
        isTestRecord: 1,
      },
    })
    .toArray()) as unknown as HouseholdDoc[];
  const contactDocs = (await contacts
    .find(legacyOnly, {
      projection: {
        legacySmartSuiteId: 1,
        firstName: 1,
        lastName: 1,
        householdId: 1,
        legacyHouseholdId: 1,
      },
    })
    .toArray()) as unknown as ContactDoc[];

  const householdByLegacyId = new Map(
    householdDocs.map((d) => [d.legacySmartSuiteId, d]),
  );
  const householdByObjectId = new Map(
    householdDocs.map((d) => [d._id.toString(), d]),
  );
  const contactByLegacyId = new Map(
    contactDocs.map((d) => [d.legacySmartSuiteId, d]),
  );
  const contactByObjectId = new Map(
    contactDocs.map((d) => [d._id.toString(), d]),
  );

  const report: BackfillReport = {
    generatedAt: new Date().toISOString(),
    dryRun: options.dryRun,
    agency: { slug: options.agencySlug, id: agencyId },
    csv: {
      contacts: csvContacts.size,
      households: csvHouseholds.size,
      policies: csvPolicies.size,
    },
    contacts: {
      inCsv: csvContacts.size,
      matched: 0,
      filled: 0,
      alreadyCorrect: 0,
      conflicts: 0,
      notInMongo: 0,
      notInCsv: contactDocs.filter(
        (d) => !csvContacts.has(d.legacySmartSuiteId),
      ).length,
      unlinkedInSource: 0,
      householdNotMigrated: 0,
      targetRemovedByOwner: 0,
    },
    households: {
      inCsv: csvHouseholds.size,
      matched: 0,
      primaryFilled: 0,
      primaryAlreadyCorrect: 0,
      primaryConflicts: 0,
      noPrimaryInSource: 0,
      ambiguousPrimary: 0,
      membersAdded: 0,
      householdsGainingMembers: 0,
      contactNotMigrated: 0,
      notInMongo: 0,
      notInCsv: householdDocs.filter(
        (d) => !csvHouseholds.has(d.legacySmartSuiteId),
      ).length,
    },
    leads: {
      candidates: 0,
      householdFilled: 0,
      primaryContactFilled: 0,
      householdNotMigrated: 0,
    },
    policies: {
      checked: 0,
      agree: 0,
      differ: 0,
      fillableFromExport: 0,
      noHouseholdEitherSide: 0,
      notInMongo: 0,
    },
    conflictRows: [],
    refusals: [],
  };

  // -------------------------------------------------------------------------
  // 1. Contacts — one household each, fill-if-empty
  // -------------------------------------------------------------------------

  /** The household each CSV contact should land on, excluding removed ones. */
  const targetHouseholdForContact = (
    row: ContactCsvRow,
  ): string | undefined => {
    const target = pickTargetHousehold(row, removedHouseholdIds);
    return target.kind === 'ok' ? target.legacyHouseholdId : undefined;
  };

  const contactOps: AnyBulkWriteOperation[] = [];
  for (const row of csvContacts.values()) {
    const doc = contactByLegacyId.get(row.recordId);
    if (!doc) {
      report.contacts.notInMongo++;
      continue;
    }
    report.contacts.matched++;

    const target = pickTargetHousehold(row, removedHouseholdIds);
    if (target.kind === 'unlinked-in-source') {
      report.contacts.unlinkedInSource++;
      continue;
    }
    if (target.kind === 'target-removed') {
      report.contacts.targetRemovedByOwner++;
      continue;
    }
    const household = householdByLegacyId.get(target.legacyHouseholdId);
    if (!household) {
      report.contacts.householdNotMigrated++;
      continue;
    }

    switch (decideLink(doc.householdId, household._id)) {
      case 'fill':
        contactOps.push({
          updateOne: {
            filter: { _id: doc._id },
            update: {
              $set: {
                householdId: household._id,
                legacyHouseholdId: target.legacyHouseholdId,
              },
            },
          },
        });
        report.contacts.filled++;
        // Keep the in-memory copy true, so later steps see the post-run state.
        doc.householdId = household._id;
        doc.legacyHouseholdId = target.legacyHouseholdId;
        break;
      case 'already-correct':
        report.contacts.alreadyCorrect++;
        break;
      case 'conflict':
        report.contacts.conflicts++;
        report.conflictRows.push({
          kind: 'contact-household',
          ref: row.contactRef,
          recordId: row.recordId,
          label: contactLabel(row),
          stored: householdLabel(
            householdByObjectId.get(doc.householdId!.toString()),
          ),
          inExport: householdLabel(household),
        });
        break;
    }
  }
  await runBulk(contacts, contactOps, options.dryRun);

  // -------------------------------------------------------------------------
  // 2. Households — primary fill-if-empty, membership by $addToSet
  // -------------------------------------------------------------------------

  /*
   * Both sides come from the *contacts* export: the households export carries
   * only the address and the policy list. Membership is the union of the two
   * contact-side columns, because 266 contacts are a household's primary
   * without appearing in its member list.
   */
  const { primaryContactsFor, memberContactsFor } = buildHouseholdMembership(
    csvContacts.values(),
  );

  /** Primary per household after this run — what step 3 gives a lead. */
  const resolvedPrimaryFor = new Map<string, Types.ObjectId>();

  const householdOps: AnyBulkWriteOperation[] = [];
  for (const csvRow of csvHouseholds.values()) {
    if (removedHouseholdIds.has(csvRow.recordId)) continue;
    const doc = householdByLegacyId.get(csvRow.recordId);
    if (!doc) {
      report.households.notInMongo++;
      continue;
    }
    report.households.matched++;

    const set: Record<string, unknown> = {};
    const primaryCandidates = primaryContactsFor.get(csvRow.recordId) ?? [];
    if (!primaryCandidates.length) {
      report.households.noPrimaryInSource++;
    } else if (primaryCandidates.length > 1) {
      /*
       * Two contacts each naming this household as the one they are primary of.
       * Picking one would set a household's primary at random, so it is
       * reported and left unset.
       */
      report.households.ambiguousPrimary++;
      report.refusals.push(
        `${householdLabel(doc)}: ${primaryCandidates.length} contacts claim to be ` +
          `its primary (${primaryCandidates
            .map((id) => csvContacts.get(id)?.contactRef ?? id)
            .join(', ')}) — left unset`,
      );
    } else {
      const primaryContact = contactByLegacyId.get(primaryCandidates[0]);
      if (!primaryContact) {
        report.households.contactNotMigrated++;
      } else {
        switch (decideLink(doc.primaryContactId, primaryContact._id)) {
          case 'fill':
            set.primaryContactId = primaryContact._id;
            report.households.primaryFilled++;
            resolvedPrimaryFor.set(csvRow.recordId, primaryContact._id);
            break;
          case 'already-correct':
            report.households.primaryAlreadyCorrect++;
            resolvedPrimaryFor.set(csvRow.recordId, doc.primaryContactId!);
            break;
          case 'conflict': {
            report.households.primaryConflicts++;
            resolvedPrimaryFor.set(csvRow.recordId, doc.primaryContactId!);
            const storedContact = contactByObjectId.get(
              doc.primaryContactId!.toString(),
            );
            report.conflictRows.push({
              kind: 'household-primary',
              ref: householdLabel(doc),
              recordId: csvRow.recordId,
              label: doc.name ?? '',
              stored: storedContact
                ? [storedContact.firstName, storedContact.lastName]
                    .filter(Boolean)
                    .join(' ')
                : `(app-created contact ${doc.primaryContactId!.toString()})`,
              inExport: contactLabel(csvContacts.get(primaryCandidates[0])!),
            });
            break;
          }
        }
      }
    }

    const existingMembers = new Set(
      (doc.memberContactIds ?? []).map((id) => id.toString()),
    );
    const newMembers: Types.ObjectId[] = [];
    for (const contactLegacyId of memberContactsFor.get(csvRow.recordId) ??
      []) {
      const member = contactByLegacyId.get(contactLegacyId);
      if (!member) {
        report.households.contactNotMigrated++;
        continue;
      }
      if (!existingMembers.has(member._id.toString())) {
        newMembers.push(member._id);
      }
    }
    if (newMembers.length) {
      report.households.membersAdded += newMembers.length;
      report.households.householdsGainingMembers++;
    }

    if (!Object.keys(set).length && !newMembers.length) continue;
    const update: Record<string, unknown> = {};
    if (Object.keys(set).length) update.$set = set;
    if (newMembers.length) {
      update.$addToSet = { memberContactIds: { $each: newMembers } };
    }
    householdOps.push({ updateOne: { filter: { _id: doc._id }, update } });
  }
  await runBulk(households, householdOps, options.dryRun);

  // -------------------------------------------------------------------------
  // 3. Leads — resolve the household they already name, never move one
  // -------------------------------------------------------------------------

  const leadDocs = (await leads
    .find(
      {
        agencyId,
        legacyHouseholdId: { $type: 'string' },
        /*
         * `{ field: null }` matches a missing field *and* an explicit null —
         * `$exists: false` matches only the first, and would silently skip a
         * lead some future writer had nulled out. There are none in the
         * 2026-09-07 dump; this is so there is no way for one to be missed.
         */
        householdId: null,
      },
      {
        projection: {
          firstName: 1,
          lastName: 1,
          householdId: 1,
          legacyHouseholdId: 1,
          primaryContactId: 1,
        },
      },
    )
    .toArray()) as unknown as LeadDoc[];

  const leadOps: AnyBulkWriteOperation[] = [];
  for (const lead of leadDocs) {
    const legacyHouseholdId = lead.legacyHouseholdId!;
    /*
     * Leads on a household the owner is removing are handled by that removal,
     * which is the only step that knows where they should go instead.
     */
    if (removedHouseholdIds.has(legacyHouseholdId)) continue;
    report.leads.candidates++;

    const household = householdByLegacyId.get(legacyHouseholdId);
    if (!household) {
      report.leads.householdNotMigrated++;
      continue;
    }

    const set: Record<string, unknown> = { householdId: household._id };
    report.leads.householdFilled++;
    if (!lead.primaryContactId) {
      const primary =
        resolvedPrimaryFor.get(legacyHouseholdId) ?? household.primaryContactId;
      if (primary) {
        set.primaryContactId = primary;
        report.leads.primaryContactFilled++;
      }
    }
    leadOps.push({
      updateOne: { filter: { _id: lead._id }, update: { $set: set } },
    });
  }
  await runBulk(leads, leadOps, options.dryRun);

  // -------------------------------------------------------------------------
  // 4. Policies — verification only, never rewritten
  // -------------------------------------------------------------------------

  if (csvPolicies.size) {
    const policyDocs = (await policies
      .find(legacyOnly, {
        projection: { legacySmartSuiteId: 1, policyNumber: 1, householdId: 1 },
      })
      .toArray()) as unknown as PolicyDoc[];
    const policyByLegacyId = new Map(
      policyDocs.map((d) => [d.legacySmartSuiteId, d]),
    );

    for (const row of csvPolicies.values()) {
      const doc = policyByLegacyId.get(row.recordId);
      if (!doc) {
        report.policies.notInMongo++;
        continue;
      }
      report.policies.checked++;
      const expected = row.householdRecordId
        ? householdByLegacyId.get(row.householdRecordId)
        : undefined;
      if (!expected && !doc.householdId) {
        report.policies.noHouseholdEitherSide++;
      } else if (expected && !doc.householdId) {
        report.policies.fillableFromExport++;
      } else if (idKey(doc.householdId) === idKey(expected?._id)) {
        report.policies.agree++;
      } else {
        report.policies.differ++;
        report.conflictRows.push({
          kind: 'policy-household',
          ref: row.policyNumber,
          recordId: row.recordId,
          label: row.policyNumber,
          stored: householdLabel(
            householdByObjectId.get(doc.householdId!.toString()),
          ),
          inExport: row.householdRef ?? '(none)',
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // 5. Owner decisions
  // -------------------------------------------------------------------------

  if (options.applyOwnerDecisions) {
    report.ownerDecisions = await applyOwnerDecisions({
      db,
      agencyId,
      options,
      decisions,
      report,
      csvContacts,
      householdByLegacyId,
      contactByLegacyId,
      targetHouseholdForContact,
    });
  }

  return report;
}

/**
 * The 2026-09-07 owner decisions, applied last and counted individually.
 *
 * The household removals depend on the test flags: #HH0032's only reference is
 * its own junk policy 00006, which this same list flags as a test record, and
 * the reference check lets a declared test row pass. It consults the *list*
 * rather than the stored `isTestRecord`, so `--dry-run` — where no flag is
 * written — predicts the same outcome the live run produces. Anything the list
 * does not name blocks the removal and is reported instead.
 */
async function applyOwnerDecisions(args: {
  db: Db;
  agencyId: string;
  options: Options;
  decisions: OwnerDecisions;
  report: BackfillReport;
  csvContacts: Map<string, ContactCsvRow>;
  householdByLegacyId: Map<string, HouseholdDoc>;
  contactByLegacyId: Map<string, ContactDoc>;
  targetHouseholdForContact: (row: ContactCsvRow) => string | undefined;
}): Promise<OwnerDecisionsReport> {
  const {
    db,
    agencyId,
    options,
    decisions,
    report,
    csvContacts,
    householdByLegacyId,
    contactByLegacyId,
    targetHouseholdForContact,
  } = args;
  const dryRun = options.dryRun;
  const households = db.collection('households');
  const contacts = db.collection('contacts');
  const leads = db.collection('leads');
  const policies = db.collection('policies');

  const out: OwnerDecisionsReport = {
    testHouseholdsFlagged: 0,
    testContactsFlagged: 0,
    testPoliciesFlagged: 0,
    duplicatePoliciesDeleted: 0,
    duplicatePoliciesRefused: 0,
    householdsRemoved: 0,
    householdsAlreadyRemoved: 0,
    householdsRefused: 0,
    testReferencesUnlinked: 0,
    leadsRepointed: 0,
    leadsUnlinked: 0,
    contactsRelinked: 0,
    contactsLeftUnlinked: 0,
    primaryContactsSet: 0,
    primaryContactsAlreadyCorrect: 0,
    primaryContactsRefused: 0,
  };

  /** Flag rows as test records; an already-flagged row is a no-op on re-run. */
  const flagTest = async (
    collection: Collection,
    recordIds: string[],
  ): Promise<number> => {
    if (!recordIds.length) return 0;
    const filter = {
      agencyId,
      legacySmartSuiteId: { $in: recordIds },
      isTestRecord: { $ne: true },
    };
    const count = await collection.countDocuments(filter);
    if (!dryRun && count) {
      await collection.updateMany(filter, { $set: { isTestRecord: true } });
    }
    return count;
  };

  out.testHouseholdsFlagged = await flagTest(
    households,
    decisions.flagTestHouseholds.map((d) => d.recordId),
  );
  out.testContactsFlagged = await flagTest(
    contacts,
    decisions.flagTestContacts.map((d) => d.recordId),
  );
  out.testPoliciesFlagged = await flagTest(
    policies,
    decisions.flagTestPolicies.map((d) => d.recordId),
  );

  /*
   * Every record this list declares to be a test record, whether or not the
   * flag has physically been written yet.
   *
   * The reference check below must consult *this*, not `isTestRecord` alone: in
   * `--dry-run` the flags above are not written, so a live run would let
   * #HH0032 through on its flagged junk policy while the rehearsal refused it —
   * and a dry-run that predicts a different outcome from the real thing is
   * worse than no dry-run.
   */
  const declaredTestRecordIds = [
    ...decisions.flagTestHouseholds.map((d) => d.recordId),
    ...decisions.flagTestContacts.map((d) => d.recordId),
    ...decisions.flagTestPolicies.map((d) => d.recordId),
  ];

  // --- duplicate policy rows ------------------------------------------------
  for (const decision of decisions.deletePolicies) {
    const doomed = (await policies.findOne({
      agencyId,
      legacySmartSuiteId: decision.recordId,
    })) as unknown as PolicyDoc | null;
    // Already deleted — the re-run case.
    if (!doomed) continue;

    const keeper = await policies.findOne({
      agencyId,
      legacySmartSuiteId: decision.keepRecordId,
    });
    if (!keeper) {
      out.duplicatePoliciesRefused++;
      report.refusals.push(
        `Policy ${decision.policyNumber}: the row to keep ` +
          `(${decision.keepRecordId}) is not in this database — ` +
          'refusing to delete the duplicate',
      );
      continue;
    }
    const tickets = await db
      .collection('serviceTickets')
      .countDocuments({ agencyId, policyId: doomed._id });
    if (doomed.householdId || doomed.dealId || tickets) {
      out.duplicatePoliciesRefused++;
      report.refusals.push(
        `Policy ${decision.policyNumber} (${decision.recordId}) has gained ` +
          `${doomed.householdId ? 'a household ' : ''}` +
          `${doomed.dealId ? 'a deal ' : ''}` +
          `${tickets ? `${tickets} ticket(s) ` : ''}since the decision — not deleted`,
      );
      continue;
    }
    if (!dryRun) await policies.deleteOne({ _id: doomed._id });
    out.duplicatePoliciesDeleted++;
  }

  // --- household removals ---------------------------------------------------
  for (const decision of decisions.removeHouseholds) {
    const doc = householdByLegacyId.get(decision.recordId);
    if (!doc) {
      out.householdsAlreadyRemoved++;
      continue;
    }
    const label = `${decision.householdRef} (${householdLabel(doc)})`;

    // (1) Reference check. A row the decisions file declares to be a test
    //     record does not block — that is exactly #HH0032's junk policy.
    const blockers: string[] = [];
    for (const name of HOUSEHOLD_REFERENCE_COLLECTIONS) {
      const count = await db.collection(name).countDocuments({
        agencyId,
        householdId: doc._id,
        isTestRecord: { $ne: true },
        legacySmartSuiteId: { $nin: declaredTestRecordIds },
      });
      if (count) blockers.push(`${count} ${name}`);
    }

    const relatedLeads = (await leads
      .find({
        agencyId,
        $or: [
          { householdId: doc._id },
          { legacyHouseholdId: decision.recordId },
        ],
      })
      .toArray()) as unknown as LeadDoc[];
    if (
      relatedLeads.length &&
      !decision.repointLeadsToRecordId &&
      !decision.unlinkLeads
    ) {
      blockers.push(
        `${relatedLeads.length} lead(s) with nowhere to go (add repointLeadsTo ` +
          'or unlinkLeads to the decisions file)',
      );
    }
    const keptHousehold = decision.repointLeadsToRecordId
      ? householdByLegacyId.get(decision.repointLeadsToRecordId)
      : undefined;
    if (decision.repointLeadsToRecordId && !keptHousehold) {
      blockers.push(
        `the household to keep (${decision.repointLeadsTo}) is not in this database`,
      );
    }

    if (blockers.length) {
      out.householdsRefused++;
      report.refusals.push(
        `${label}: still referenced by ${blockers.join(', ')} — not removed`,
      );
      continue;
    }

    /*
     * (2) The declared test rows that were allowed past the check still point
     *     at this household, and it is about to stop existing. Unlink them, or
     *     the removal trades a double primary for a dangling reference —
     *     which is what the first rehearsal's re-run caught on policy 00006.
     */
    for (const name of HOUSEHOLD_REFERENCE_COLLECTIONS) {
      const filter = { agencyId, householdId: doc._id };
      const count = await db.collection(name).countDocuments(filter);
      if (!count) continue;
      if (!dryRun) {
        await db.collection(name).updateMany(filter, {
          $unset: { householdId: '', legacyHouseholdId: '' },
        });
      }
      out.testReferencesUnlinked += count;
    }

    // (3) Leads: to the kept household, or unlinked when there is none.
    for (const lead of relatedLeads) {
      if (keptHousehold) {
        if (!dryRun) {
          await leads.updateOne(
            { _id: lead._id },
            {
              $set: {
                householdId: keptHousehold._id,
                legacyHouseholdId: decision.repointLeadsToRecordId,
              },
            },
          );
        }
        out.leadsRepointed++;
      } else {
        if (!dryRun) {
          await leads.updateOne(
            { _id: lead._id },
            { $unset: { householdId: '', legacyHouseholdId: '' } },
          );
        }
        out.leadsUnlinked++;
      }
    }

    /*
     * (4) Contacts: clear the link to the doomed household, then re-run the
     *     fill so the contact lands on whichever household the export says they
     *     keep. This is the one place the "fill, never move" rule is
     *     deliberately suspended — the household it points at is about to stop
     *     existing, so leaving it would be a dangling reference.
     */
    const strandedContacts = (await contacts
      .find({
        agencyId,
        legacySmartSuiteId: { $type: 'string' },
        $or: [
          { householdId: doc._id },
          { legacyHouseholdId: decision.recordId },
        ],
      })
      .toArray()) as unknown as ContactDoc[];
    for (const contact of strandedContacts) {
      const csvRow = csvContacts.get(contact.legacySmartSuiteId);
      const targetLegacyId = csvRow
        ? targetHouseholdForContact(csvRow)
        : undefined;
      const target = targetLegacyId
        ? householdByLegacyId.get(targetLegacyId)
        : undefined;
      if (target) {
        if (!dryRun) {
          await contacts.updateOne(
            { _id: contact._id },
            {
              $set: {
                householdId: target._id,
                legacyHouseholdId: targetLegacyId,
              },
            },
          );
        }
        out.contactsRelinked++;
      } else {
        if (!dryRun) {
          await contacts.updateOne(
            { _id: contact._id },
            { $unset: { householdId: '', legacyHouseholdId: '' } },
          );
        }
        out.contactsLeftUnlinked++;
      }
    }

    // (5) The household itself.
    if (!dryRun) await households.deleteOne({ _id: doc._id });
    out.householdsRemoved++;
  }

  // --- explicit primary contacts -------------------------------------------
  for (const decision of decisions.setPrimaryContacts) {
    const household = householdByLegacyId.get(decision.recordId);
    const contact = contactByLegacyId.get(decision.contactRecordId);
    if (!household || !contact) {
      out.primaryContactsRefused++;
      report.refusals.push(
        `${decision.householdRef}: cannot set ${decision.contactRef} as primary — ` +
          `${!household ? 'the household' : 'the contact'} is not in this database`,
      );
      continue;
    }
    const outcome = decideLink(household.primaryContactId, contact._id);
    if (outcome === 'already-correct') {
      out.primaryContactsAlreadyCorrect++;
      continue;
    }
    if (outcome === 'conflict') {
      out.primaryContactsRefused++;
      report.refusals.push(
        `${decision.householdRef}: already has a different primary contact — ` +
          `${decision.contactRef} not set`,
      );
      continue;
    }
    if (!dryRun) {
      await households.updateOne(
        { _id: household._id },
        { $set: { primaryContactId: contact._id } },
      );
    }
    out.primaryContactsSet++;
  }

  return out;
}

/**
 * The decisions file names every record by both title and rec id. Check the
 * export still agrees before writing anything: a later export that renumbered a
 * title would otherwise flag or delete the wrong record silently.
 */
function assertDecisionsMatchExport(
  decisions: OwnerDecisions,
  csvContacts: Map<string, ContactCsvRow>,
  csvHouseholds: Map<string, { householdRef: string }>,
): void {
  const problems: string[] = [];
  const checkHousehold = (ref: string, recordId: string) => {
    const row = csvHouseholds.get(recordId);
    if (!row) problems.push(`${ref}: rec id ${recordId} is not in the export`);
    else if (row.householdRef !== ref) {
      problems.push(
        `${ref}: rec id ${recordId} is ${row.householdRef} in the export`,
      );
    }
  };
  const checkContact = (ref: string, recordId: string) => {
    const row = csvContacts.get(recordId);
    if (!row) problems.push(`${ref}: rec id ${recordId} is not in the export`);
    else if (row.contactRef !== ref) {
      problems.push(
        `${ref}: rec id ${recordId} is ${row.contactRef} in the export`,
      );
    }
  };

  for (const d of decisions.removeHouseholds) {
    checkHousehold(d.householdRef, d.recordId);
    if (d.repointLeadsTo && d.repointLeadsToRecordId) {
      checkHousehold(d.repointLeadsTo, d.repointLeadsToRecordId);
    }
  }
  decisions.flagTestHouseholds.forEach((d) =>
    checkHousehold(d.householdRef, d.recordId),
  );
  decisions.flagTestContacts.forEach((d) =>
    checkContact(d.contactRef, d.recordId),
  );
  decisions.setPrimaryContacts.forEach((d) => {
    checkHousehold(d.householdRef, d.recordId);
    checkContact(d.contactRef, d.contactRecordId);
  });

  if (problems.length) {
    throw new Error(
      'The owner-decisions file disagrees with the export:\n  ' +
        problems.join('\n  ') +
        '\nRe-check the decisions against this export before running.',
    );
  }
}

function printReport(report: BackfillReport): void {
  const line = '-'.repeat(76);
  console.log(`\n${line}`);
  console.log(
    `PAC-91 household-link backfill${report.dryRun ? ' (DRY RUN)' : ''}`,
  );
  console.log(line);

  const table = (title: string, rows: object) => {
    console.log(title);
    for (const [key, value] of Object.entries(rows)) {
      console.log(`  ${key.padEnd(28)}${String(value).padStart(8)}`);
    }
  };

  table('Contacts', report.contacts);
  table('Households', report.households);
  table('Leads', report.leads);
  table('Policies (verification only)', report.policies);
  if (report.ownerDecisions) table('Owner decisions', report.ownerDecisions);

  if (report.conflictRows.length) {
    console.log(`${line}\nConflicts — stored value kept, nothing written:`);
    for (const row of report.conflictRows) {
      console.log(
        `  ${row.kind.padEnd(18)} ${row.ref.padEnd(10)} ` +
          `${row.label.padEnd(28)} stored=${row.stored}  export=${row.inExport}`,
      );
    }
  }
  if (report.refusals.length) {
    console.log(`${line}\nRefused (${report.refusals.length}):`);
    report.refusals.forEach((r) => console.log(`  - ${r}`));
  }
  console.log(line);
}

run().catch((error) => {
  console.error('Household-link backfill failed:', error);
  process.exit(1);
});
