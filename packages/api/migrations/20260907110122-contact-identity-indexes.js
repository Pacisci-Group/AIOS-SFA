/**
 * PAC-91 §9 — enforce "one person, one contact" with two partial unique
 * indexes, and **refuse to proceed** if the database still holds duplicates.
 *
 * The owner's rule (David, 2026-09-07):
 *
 * > A contact is unique on **date of birth + full name + phone or email**.
 * > Same name, same DOB and either the same phone *or* the same email is the
 * > same person.
 *
 * Two indexes because the rule is an **OR**, and partial because every leg is
 * optional — on the 2026-09-04 production export 322 contacts have no DOB and
 * 611 have neither phone nor email. A row missing a leg is deliberately not
 * indexed: without a birth date nothing can prove two namesakes are one person,
 * and a unique index that pretended otherwise would refuse legitimate data.
 *
 * ── Why this is a separate migration from the scalars one ───────────────────
 * It has a precondition the other does not: the duplicates have to be gone
 * first. `merge-duplicate-contacts.ts` does that, under a **reviewed dry run**,
 * because it deletes people — which is why it is a script and not a migration
 * (`README.md`'s line between the two).
 *
 * ── Why this exists at all, when the schema declares the same indexes ───────
 * Mongoose's `autoIndex` creates a missing index *silently*, and a unique index
 * build over duplicate data simply **fails** — leaving the collection with no
 * uniqueness at all and nothing in the logs naming the rows that caused it.
 * That is README rule 4 in its most expensive form. This migration is the loud
 * version: it finds the conflicts first, prints them, and throws. The API
 * applies pending migrations *before* it binds a port and before any Mongoose
 * model exists, so a deploy that skipped the merge stops here rather than
 * shipping an unenforced rule.
 *
 * Idempotent: an index that already exists is left alone, and the conflict scan
 * is read-only.
 */

/** Must match `CONTACT_IDENTITY_INDEXES` in `src/contacts/contact-identity.ts`. */
const IDENTITY_INDEXES = [
  { agencyId: 1, nameKey: 1, dobKey: 1, phone: 1 },
  { agencyId: 1, nameKey: 1, dobKey: 1, email: 1 },
];

/** How many offending groups to print before truncating. */
const SAMPLE = 20;

function indexName(keys) {
  return Object.entries(keys)
    .map(([field, direction]) => `${field}_${direction}`)
    .join('_');
}

/** Partial on all four legs being a string — the same filter the schema uses. */
function partialFilter(keys) {
  return Object.fromEntries(
    Object.keys(keys).map((field) => [field, { $type: 'string' }]),
  );
}

/**
 * Groups that would make this index fail to build.
 *
 * `isTestRecord` rows are excluded from the *report* but not from the index:
 * the index cannot express that exclusion, so a duplicate among test rows would
 * still break the build. It has never happened — the seeds allocate distinct
 * emails per contact for exactly this reason — and if it does, the group is
 * still printed below, just labelled.
 */
async function findConflicts(db, keys) {
  const fields = Object.keys(keys).filter((field) => field !== 'agencyId');
  const groupId = { agencyId: '$agencyId' };
  for (const field of fields) groupId[field] = `$${field}`;

  return db
    .collection('contacts')
    .aggregate([
      { $match: partialFilter(keys) },
      {
        $group: {
          _id: groupId,
          count: { $sum: 1 },
          ids: { $push: '$_id' },
          names: { $push: { $concat: ['$firstName', ' ', '$lastName'] } },
          testRecords: { $sum: { $cond: ['$isTestRecord', 1, 0] } },
        },
      },
      { $match: { count: { $gt: 1 } } },
      { $sort: { count: -1 } },
    ])
    .toArray();
}

module.exports = {
  /**
   * @param {import('mongodb').Db} db
   * @returns {Promise<void>}
   */
  async up(db) {
    const contacts = db.collection('contacts');
    const existing = new Set(
      (await contacts.indexes()).map((index) => index.name),
    );

    for (const keys of IDENTITY_INDEXES) {
      const name = indexName(keys);
      if (existing.has(name)) {
        console.log(`[PAC-91] ${name} already exists — nothing to do.`);
        continue;
      }

      const conflicts = await findConflicts(db, keys);
      if (conflicts.length) {
        // Loud, and specific enough to act on: the operator needs to know which
        // people are involved, not just that "some" duplicates exist.
        console.error(
          `[PAC-91] ${conflicts.length} duplicate group(s) block ${name}:`,
        );
        for (const group of conflicts.slice(0, SAMPLE)) {
          const who = [...new Set(group.names)].join(' / ');
          console.error(
            `  ${who}  dob=${group._id.dobKey}  ` +
              `${group._id.phone ? `phone=${group._id.phone}` : `email=${group._id.email}`}  ` +
              `${group.count} rows: ${group.ids.join(', ')}` +
              (group.testRecords ? `  (${group.testRecords} test record(s))` : ''),
          );
        }
        if (conflicts.length > SAMPLE) {
          console.error(`  … and ${conflicts.length - SAMPLE} more`);
        }

        throw new Error(
          `Cannot build ${name}: ${conflicts.length} duplicate contact group(s) ` +
            'remain. Run the reviewed merge first — ' +
            '`npm run merge:duplicate-contacts:dev -w @sfa/api -- --agency <slug> --dry-run --report ./merge.json`, ' +
            'review it, then re-run without --dry-run. See PAC-91 §9.',
        );
      }

      await contacts.createIndex(keys, {
        name,
        unique: true,
        partialFilterExpression: partialFilter(keys),
      });
      console.log(`[PAC-91] built ${name}`);
    }
  },

  /**
   * @param {import('mongodb').Db} db
   * @returns {Promise<void>}
   */
  async down(db) {
    // Genuinely reversible, unlike the scalars migration before it: dropping an
    // index destroys no data, it only stops the rule being enforced.
    const contacts = db.collection('contacts');
    const existing = new Set(
      (await contacts.indexes()).map((index) => index.name),
    );
    for (const keys of IDENTITY_INDEXES) {
      const name = indexName(keys);
      if (existing.has(name)) await contacts.dropIndex(name);
    }
  },
};
