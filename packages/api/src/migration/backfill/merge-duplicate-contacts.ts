import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { config as loadEnv } from 'dotenv';
import { createConnection, Types } from 'mongoose';
import type { AnyBulkWriteOperation, Db } from 'mongodb';
import { ENV_FILE_PATH } from '../../config/env.config';

/**
 * One-off, re-runnable: merge the contacts that are the **same person** under
 * the owner's identity rule (PAC-91 §9).
 *
 * > A contact is unique on **date of birth + full name + phone or email**.
 * > Same name, same DOB and either the same phone *or* the same email is the
 * > same person. (David, 2026-09-07.)
 *
 * USAGE
 * -----
 *   npm run merge:duplicate-contacts:dev -w @sfa/api -- \
 *     --agency smith-family-agency --dry-run --report ./pac-91-merge.json
 *
 * ⚠ Run it through the workspace, not the root alias: the root scripts swallow
 * everything after `--`, so the flags silently vanish.
 *
 * WHY A SCRIPT AND NOT A migrate-mongo MIGRATION
 * ----------------------------------------------
 * It deletes people. The dry-run report is meant to be *read* by the owner
 * before anything is written, and `migrations/README.md` draws the line exactly
 * there. The migration that follows it — the one that builds the two partial
 * unique indexes — is what stops a deploy that skipped this: it checks for
 * conflicts first and fails loudly, naming them.
 *
 * ORDERING
 * --------
 * Runs **after** the Phase 1 link backfill (`backfill-household-links.ts`),
 * because "has a household link" is the tiebreak for which row survives, and
 * before Phase 1 that was true of only 35% of contacts — the winner would have
 * been chosen almost at random.
 *
 * WHAT IT WILL NOT DO
 * -------------------
 * - It never merges on a **partial** key. 244 groups in the 2026-09-04 export
 *   share only a name; without a birth date nothing can prove they are one
 *   person, and merging two strangers is the one mistake here that cannot be
 *   undone. Those are for the agency to judge by hand — a UI merge tool is a
 *   follow-up ticket, and this script does not touch them.
 * - It never merges a `isTestRecord` row, in either direction: the seeded
 *   Sample/Test contacts share names by design.
 * - It never merges across agencies. Every query is keyed on `agencyId`, which
 *   on `TenantRecord` is a **string** — an ObjectId here matches nothing at
 *   all, which reads as an empty database.
 *
 * SAFETY
 * ------
 * - `--dry-run` writes nothing and reports exactly what a live run would do.
 * - The loser's references are repointed **before** it is deleted, and the
 *   delete only runs for a loser whose repoint succeeded.
 * - Idempotent: once merged there is one row per key, so a second run finds no
 *   groups and reports zero merges.
 * - Writes run with no request context, so `updatedBy` stays null ("system",
 *   per AGENTS.md §11). No placeholder user is minted.
 * - Bare Mongoose connection, no models: loading the schemas would fire
 *   `autoIndex` and try to build the very unique indexes this exists to make
 *   buildable.
 */

loadEnv({ path: ENV_FILE_PATH });

/** `bulkWrite` batch size. */
const BATCH_SIZE = 500;

/**
 * Every place a contact is referenced, and how.
 *
 * Found by grepping the schemas for a `ref: 'Contact'` prop — `quoteRecaps`,
 * `policies`, `serviceTickets` and `activities` carry **no** contact reference,
 * despite the plan's first guess, so they are deliberately absent rather than
 * forgotten. A reference added later and not listed here would be left pointing
 * at a deleted contact, which is what {@link auditDanglingRefs} checks for at
 * the end of every run.
 */
const SINGLE_REFS = [
  { collection: 'households', field: 'primaryContactId' },
  { collection: 'leads', field: 'primaryContactId' },
  { collection: 'deals', field: 'primaryContactId' },
  { collection: 'dealAuditItems', field: 'subjectContactId' },
] as const;

const ARRAY_REFS = [
  // Gone after PAC-91 §5's `drop-contact-household-fields` migration; harmless
  // to keep listed, because the audit and the repoint both match on the field
  // existing and simply find nothing once it does not.
  { collection: 'households', field: 'memberContactIds' },
  { collection: 'leads', field: 'memberContactIds' },
] as const;

/**
 * The membership join collection (PAC-91 §5) — a contact reference, but not one
 * the generic repoint above can handle.
 *
 * `{agencyId, householdId, contactId}` is **unique**, so blindly `$set`-ting a
 * loser's membership to the survivor fails with E11000 whenever both were
 * members of the same household — which, for two rows that the identity rule
 * says are one person, is the common case rather than the exotic one. It is
 * repointed by {@link planMembershipRepoints}, which moves what it can and
 * deletes the duplicate rest, and audited here like every other reference.
 */
const MEMBERSHIP_REF = {
  collection: 'householdMembers',
  field: 'contactId',
} as const;

interface Options {
  agencySlug: string;
  dryRun: boolean;
  reportPath?: string;
}

function parseOptions(argv: string[]): Options {
  const value = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith('--')
      ? argv[index + 1]
      : undefined;
  };

  return {
    agencySlug: value('--agency') ?? 'smith-family-agency',
    dryRun: argv.includes('--dry-run'),
    reportPath: value('--report'),
  };
}

// ---------------------------------------------------------------------------
// Shapes read out of Mongo (raw driver — no models, see the docblock)
// ---------------------------------------------------------------------------

interface ContactDoc {
  _id: Types.ObjectId;
  firstName?: string;
  lastName?: string;
  nameKey?: string;
  dobKey?: string;
  email?: string;
  phone?: string;
  householdId?: Types.ObjectId;
  legacySmartSuiteId?: string;
  roleInHousehold?: string;
  isPrimary?: boolean;
  createdAt?: Date;
  /**
   * Households this contact belongs to, from `householdMembers` (PAC-91 §5).
   *
   * Loaded alongside the contact rather than derived from `householdId`,
   * because that field is removed by the same release: before it is,
   * both answer the survivor tiebreak and agree; afterwards this is the only
   * one left. Empty when the join collection does not exist yet.
   */
  householdIds?: Types.ObjectId[];
}

/** Whether the row has a household at all, from whichever side still holds it. */
function hasHousehold(contact: ContactDoc): boolean {
  return Boolean(contact.householdId) || Boolean(contact.householdIds?.length);
}

/** One resolved merge: a survivor and the rows folded into it. */
interface MergeGroup {
  key: string;
  matchedOn: 'phone' | 'email';
  keep: ContactDoc;
  losers: ContactDoc[];
}

interface MergeReport {
  ranAt: string;
  dryRun: boolean;
  agency: { slug: string; id: string };
  contactsScanned: number;
  groupsFound: number;
  contactsMerged: number;
  refsRepointed: Record<string, number>;
  membershipsUnioned: number;
  danglingAfter: Record<string, number>;
  merges: Array<{
    matchedOn: 'phone' | 'email';
    name: string;
    dobKey: string;
    detail: string;
    keep: { id: string; ref: string | null; household: string | null };
    losers: Array<{ id: string; ref: string | null; household: string | null }>;
    /** Why this row survived, in the words of the rule below. */
    reason: string;
  }>;
  skipped: string[];
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

/**
 * Group contacts by the **full** identity key, one group per leg of the OR.
 *
 * Two passes rather than one union-find over "phone or email": the rule is an
 * OR of two *complete* keys, and a chain of the form A~B by phone, B~C by
 * email, A≁C would otherwise silently merge A into C on the strength of a
 * transitivity nobody agreed to. Each pass merges only rows that share a full
 * key outright; if a genuine chain exists, the second run of the script picks
 * up what the first left, which is a slower but honest convergence.
 */
function groupByIdentity(contacts: ContactDoc[]): MergeGroup[] {
  const groups: MergeGroup[] = [];

  for (const leg of ['phone', 'email'] as const) {
    const byKey = new Map<string, ContactDoc[]>();
    for (const contact of contacts) {
      const detail = contact[leg];
      if (!contact.nameKey || !contact.dobKey || !detail) continue;
      const key = `${contact.nameKey}|${contact.dobKey}|${leg}:${detail}`;
      const bucket = byKey.get(key);
      if (bucket) bucket.push(contact);
      else byKey.set(key, [contact]);
    }

    for (const [key, bucket] of byKey) {
      if (bucket.length < 2) continue;
      const [keep, ...losers] = [...bucket].sort(compareSurvivor);
      groups.push({ key, matchedOn: leg, keep, losers });
    }
  }

  return dedupeOverlappingGroups(groups);
}

/**
 * Which row survives: **the one with a household link**, else the oldest.
 *
 * The household link is the tiebreak that matters, and it is why this runs
 * after the Phase 1 backfill. The typical duplicate pair in the 2026-09-04
 * export is one row linked to a household and one of the 322 unlinked rows;
 * keeping the linked one means the merge repoints almost nothing and the
 * client's records stay where the agency last saw them. Age is the fallback so
 * the choice is deterministic rather than dependent on query order — a
 * re-run has to reach the same answer or the "idempotent" claim is empty.
 */
function compareSurvivor(a: ContactDoc, b: ContactDoc): number {
  const linked = Number(hasHousehold(b)) - Number(hasHousehold(a));
  if (linked !== 0) return linked;

  const age =
    (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0) || 0;
  if (age !== 0) return age;

  return a._id.toString().localeCompare(b._id.toString());
}

/**
 * A contact matched on both phone *and* email appears in both passes. Keep the
 * first group that claims it and drop it from any later one, so no row is
 * merged twice in a single run and no group is left claiming a contact that is
 * already gone.
 */
function dedupeOverlappingGroups(groups: MergeGroup[]): MergeGroup[] {
  const claimed = new Set<string>();
  const out: MergeGroup[] = [];

  for (const group of groups) {
    const ids = [group.keep, ...group.losers].map((c) => c._id.toString());
    if (ids.some((id) => claimed.has(id))) continue;
    ids.forEach((id) => claimed.add(id));
    out.push(group);
  }

  return out;
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
      : 'LIVE RUN — duplicate contacts will be merged and deleted.\n',
  );

  const connection = createConnection(uri);
  await connection.asPromise();
  const db = connection.db;
  if (!db) throw new Error('No database handle on the connection');

  try {
    const report = await merge(db, options);
    printReport(report);
    if (options.reportPath) {
      const out = resolve(options.reportPath);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, JSON.stringify(report, null, 2), 'utf8');
      console.log(`\nReport written to ${out}`);
    }
    if (report.skipped.length) process.exitCode = 1;
  } finally {
    await connection.close();
  }
}

async function merge(db: Db, options: Options): Promise<MergeReport> {
  const agency = await db
    .collection('agencies')
    .findOne({ slug: options.agencySlug }, { projection: { _id: 1 } });
  if (!agency) throw new Error(`No agency with slug "${options.agencySlug}".`);

  // ⚠ String, not ObjectId — `TenantRecord.agencyId` is a string, and an
  // ObjectId here matches nothing at all, which reads as an empty database.
  const agencyId = agency._id.toString();
  console.log(`Agency: ${options.agencySlug} (${agencyId})\n`);

  const contacts = (await db
    .collection('contacts')
    .find(
      { agencyId, isTestRecord: { $ne: true } },
      {
        projection: {
          firstName: 1,
          lastName: 1,
          nameKey: 1,
          dobKey: 1,
          email: 1,
          phone: 1,
          householdId: 1,
          legacySmartSuiteId: 1,
          roleInHousehold: 1,
          isPrimary: 1,
          createdAt: 1,
        },
      },
    )
    .toArray()) as unknown as ContactDoc[];

  /*
   * Attach each contact's memberships (PAC-91 §5). One query for the whole
   * agency rather than one per contact — the collection has roughly one row per
   * contact, so this is the same order of data the contacts query already
   * pulled. Absent on a database that predates the join collection, which is
   * the state this script normally runs in.
   */
  const membershipsByContact = new Map<string, Types.ObjectId[]>();
  const membershipRows = (await db
    .collection(MEMBERSHIP_REF.collection)
    .find(
      { agencyId, endedAt: null },
      { projection: { contactId: 1, householdId: 1 } },
    )
    .toArray()) as unknown as Array<{
    contactId: Types.ObjectId;
    householdId: Types.ObjectId;
  }>;
  for (const row of membershipRows) {
    const key = row.contactId.toString();
    const bucket = membershipsByContact.get(key);
    if (bucket) bucket.push(row.householdId);
    else membershipsByContact.set(key, [row.householdId]);
  }
  for (const contact of contacts) {
    contact.householdIds = membershipsByContact.get(contact._id.toString());
  }

  const withKeys = contacts.filter((c) => c.nameKey && c.dobKey).length;
  console.log(
    `Contacts: ${contacts.length} in scope, ${withKeys} with a full name+DOB key.`,
  );
  if (withKeys === 0 && contacts.length > 0) {
    throw new Error(
      'No contact carries `nameKey`/`dobKey`. Run the migrations first ' +
        '(`npm run db:migrate -w @sfa/api`) — they are what stamp the keys ' +
        'this script groups by.',
    );
  }

  const groups = groupByIdentity(contacts);
  console.log(
    `Duplicate groups under the full identity rule: ${groups.length}\n`,
  );

  const report: MergeReport = {
    ranAt: new Date().toISOString(),
    dryRun: options.dryRun,
    agency: { slug: options.agencySlug, id: agencyId },
    contactsScanned: contacts.length,
    groupsFound: groups.length,
    contactsMerged: 0,
    refsRepointed: {},
    membershipsUnioned: 0,
    danglingAfter: {},
    merges: [],
    skipped: [],
  };

  const ops: Array<{ collection: string; op: AnyBulkWriteOperation }> = [];

  for (const group of groups) {
    const loserIds = group.losers.map((l) => l._id);

    for (const ref of SINGLE_REFS) {
      ops.push({
        collection: ref.collection,
        op: {
          updateMany: {
            filter: { agencyId, [ref.field]: { $in: loserIds } },
            update: { $set: { [ref.field]: group.keep._id } },
          },
        },
      });
    }

    /*
     * An array reference is two operations, not one: `$pull` the losers and
     * `$addToSet` the survivor. They cannot be combined — Mongo refuses two
     * update operators on the same path in one document — and the order
     * matters only in that both must happen, which `ordered: false` batching
     * still guarantees per document.
     */
    for (const ref of ARRAY_REFS) {
      ops.push({
        collection: ref.collection,
        op: {
          updateMany: {
            filter: { agencyId, [ref.field]: { $in: loserIds } },
            // The driver's `PullOperator` cannot express a `$in` behind a
            // computed key, so the operator is built and cast rather than
            // written inline. The shape is `{ $pull: { <field>: { $in: [...] } } }`.
            update: {
              $pull: { [ref.field]: { $in: loserIds } },
            } as unknown as AnyBulkWriteOperation,
          },
        },
      });
      ops.push({
        collection: ref.collection,
        op: {
          updateMany: {
            filter: { agencyId, [ref.field]: { $in: loserIds } },
            update: { $addToSet: { [ref.field]: group.keep._id } },
          },
        },
      });
    }

    ops.push(...planMembershipRepoints(agencyId, group));

    /*
     * Fill the survivor from the losers where it is blank — a household link,
     * a role, an email or phone the other row carried. Never overwrite: the
     * survivor was chosen because its values are the ones the agency has been
     * working with.
     */
    const fill: Record<string, unknown> = {};
    for (const loser of group.losers) {
      if (!group.keep.householdId && loser.householdId) {
        fill.householdId = loser.householdId;
        group.keep.householdId = loser.householdId;
      }
      if (!group.keep.email && loser.email) fill.email = loser.email;
      if (!group.keep.phone && loser.phone) fill.phone = loser.phone;
      if (!group.keep.roleInHousehold && loser.roleInHousehold) {
        fill.roleInHousehold = loser.roleInHousehold;
      }
    }
    if (Object.keys(fill).length) {
      ops.push({
        collection: 'contacts',
        op: {
          updateOne: {
            filter: { _id: group.keep._id },
            update: { $set: fill },
          },
        },
      });
    }

    ops.push({
      collection: 'contacts',
      op: { deleteMany: { filter: { _id: { $in: loserIds }, agencyId } } },
    });

    report.contactsMerged += group.losers.length;
    report.merges.push({
      matchedOn: group.matchedOn,
      name: displayName(group.keep),
      dobKey: group.keep.dobKey ?? '',
      detail:
        (group.matchedOn === 'phone' ? group.keep.phone : group.keep.email) ??
        '',
      keep: describe(group.keep),
      losers: group.losers.map(describe),
      reason: hasHousehold(group.keep)
        ? 'kept the row with a household link'
        : 'no row had a household link — kept the oldest',
    });
  }

  if (!options.dryRun && ops.length) {
    await applyOps(db, ops, report);
  } else if (options.dryRun) {
    // Counted from the intent, since nothing is executed. `updateMany` reports
    // the documents it touched; a dry run can only say how many it would try.
    for (const { collection } of ops) {
      report.refsRepointed[collection] =
        (report.refsRepointed[collection] ?? 0) + 1;
    }
  }

  report.danglingAfter = await auditDanglingRefs(db, agencyId);
  for (const [where, count] of Object.entries(report.danglingAfter)) {
    if (count > 0) {
      report.skipped.push(
        `${count} dangling contact reference(s) in ${where} — a reference this ` +
          'script does not know about, or a contact deleted elsewhere.',
      );
    }
  }

  return report;
}

/**
 * Repoint a group's memberships onto the survivor, without tripping the unique
 * `{agencyId, householdId, contactId}` index (PAC-91 §5).
 *
 * Two rows the identity rule calls one person are very often members of the
 * same household — that is how they came to be filed twice. Moving both onto
 * the survivor would then be two rows for one membership, which the index
 * refuses, so:
 *
 * - a loser's membership of a household the survivor is **not** in is moved
 *   (the person keeps the household);
 * - a loser's membership of a household the survivor **is** in is deleted
 *   (the survivor's own row already says it, and it is the one the agency has
 *   been working with).
 *
 * The survivor's set is tracked as it grows, so two losers who are both in the
 * same new household do not collide with each other either.
 */
function planMembershipRepoints(
  agencyId: string,
  group: MergeGroup,
): Array<{ collection: string; op: AnyBulkWriteOperation }> {
  const ops: Array<{ collection: string; op: AnyBulkWriteOperation }> = [];
  const kept = new Set((group.keep.householdIds ?? []).map(String));

  for (const loser of group.losers) {
    for (const householdId of loser.householdIds ?? []) {
      const filter = {
        agencyId,
        householdId,
        contactId: loser._id,
      };
      if (kept.has(String(householdId))) {
        ops.push({
          collection: MEMBERSHIP_REF.collection,
          op: { deleteOne: { filter } },
        });
        continue;
      }
      kept.add(String(householdId));
      ops.push({
        collection: MEMBERSHIP_REF.collection,
        op: {
          updateOne: {
            filter,
            update: { $set: { contactId: group.keep._id } },
          },
        },
      });
    }
  }

  return ops;
}

async function applyOps(
  db: Db,
  ops: Array<{ collection: string; op: AnyBulkWriteOperation }>,
  report: MergeReport,
): Promise<void> {
  const byCollection = new Map<string, AnyBulkWriteOperation[]>();
  for (const { collection, op } of ops) {
    const bucket = byCollection.get(collection);
    if (bucket) bucket.push(op);
    else byCollection.set(collection, [op]);
  }

  for (const [collection, all] of byCollection) {
    for (let i = 0; i < all.length; i += BATCH_SIZE) {
      const batch = all.slice(i, i + BATCH_SIZE);
      const result = await db
        .collection(collection)
        .bulkWrite(batch, { ordered: false });
      report.refsRepointed[collection] =
        (report.refsRepointed[collection] ?? 0) +
        (result.modifiedCount ?? 0) +
        (result.deletedCount ?? 0);
    }
  }
}

/**
 * Every contact reference that now points at nothing.
 *
 * Run on both a dry run and a live one, because it is the check that would
 * catch a reference added to some schema after this script was written: the
 * `SINGLE_REFS` / `ARRAY_REFS` lists are a snapshot, and a merge that leaves a
 * dangling ref is the one outcome worse than not merging at all.
 */
async function auditDanglingRefs(
  db: Db,
  agencyId: string,
): Promise<Record<string, number>> {
  const ids = new Set(
    (
      await db
        .collection('contacts')
        .find({ agencyId }, { projection: { _id: 1 } })
        .toArray()
    ).map((c) => c._id.toString()),
  );

  const out: Record<string, number> = {};

  for (const ref of [...SINGLE_REFS, MEMBERSHIP_REF]) {
    const rows = await db
      .collection(ref.collection)
      .find(
        { agencyId, [ref.field]: { $type: 'objectId' } },
        { projection: { [ref.field]: 1 } },
      )
      .toArray();
    out[`${ref.collection}.${ref.field}`] = rows.filter(
      (row) => !ids.has(String(row[ref.field])),
    ).length;
  }

  for (const ref of ARRAY_REFS) {
    const rows = await db
      .collection(ref.collection)
      .find(
        { agencyId, [ref.field]: { $type: 'objectId' } },
        { projection: { [ref.field]: 1 } },
      )
      .toArray();
    out[`${ref.collection}.${ref.field}`] = rows.reduce(
      (total: number, row) =>
        total +
        ((row[ref.field] as unknown[]) ?? []).filter(
          (id) => !ids.has(String(id)),
        ).length,
      0,
    );
  }

  return out;
}

function displayName(contact: ContactDoc): string {
  return (
    [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim() ||
    'Unnamed contact'
  );
}

function describe(contact: ContactDoc): {
  id: string;
  ref: string | null;
  household: string | null;
} {
  return {
    id: contact._id.toString(),
    ref: contact.legacySmartSuiteId ?? null,
    household: contact.householdId ? contact.householdId.toString() : null,
  };
}

function printReport(report: MergeReport): void {
  const line = '-'.repeat(78);
  console.log(`\n${line}`);
  console.log(
    `PAC-91 duplicate-contact merge${report.dryRun ? ' (DRY RUN)' : ''}`,
  );
  console.log(line);
  console.log(`  contacts in scope           ${report.contactsScanned}`);
  console.log(`  duplicate groups            ${report.groupsFound}`);
  console.log(`  contacts merged away        ${report.contactsMerged}`);
  console.log(line);

  if (report.merges.length) {
    console.log('Merges — the survivor is listed first:');
    for (const m of report.merges) {
      console.log(
        `  ${m.name.padEnd(26)} dob ${m.dobKey}  by ${m.matchedOn} ${m.detail}`,
      );
      console.log(
        `      keep  ${m.keep.ref ?? '(app-created)'} ${m.keep.id}` +
          `  household=${m.keep.household ?? '—'}  [${m.reason}]`,
      );
      for (const loser of m.losers) {
        console.log(
          `      drop  ${loser.ref ?? '(app-created)'} ${loser.id}` +
            `  household=${loser.household ?? '—'}`,
        );
      }
    }
    console.log(line);
  }

  console.log('Dangling contact references after this run:');
  for (const [where, count] of Object.entries(report.danglingAfter)) {
    console.log(`  ${where.padEnd(34)}${String(count).padStart(6)}`);
  }

  if (report.skipped.length) {
    console.log(`${line}\nProblems (${report.skipped.length}):`);
    report.skipped.forEach((s) => console.log(`  - ${s}`));
  }
  console.log(line);
}

run().catch((error) => {
  console.error('Duplicate-contact merge failed:', error);
  process.exit(1);
});
