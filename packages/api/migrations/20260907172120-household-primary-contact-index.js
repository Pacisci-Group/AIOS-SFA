/**
 * PAC-91 §5 — enforce "a contact is the primary contact of **at most one**
 * household" with a partial unique index, and **refuse to build it** while the
 * database still contradicts the rule.
 *
 * The owner's ground truth (David, 2026-09-04):
 *
 * > A contact can belong to several households, but can be the primary contact
 * > of at most one.
 *
 * Membership became many-to-many in this same release; primacy did not. It
 * stays a single field, `Household.primaryContactId`, and this index is what
 * makes "at most one" a property of the database rather than a habit of the
 * application.
 *
 * ── Partial, not sparse ─────────────────────────────────────────────────────
 * `partialFilterExpression: { primaryContactId: { $type: 'objectId' } }`.
 * MongoDB only omits a document from a *compound* sparse index when **every**
 * indexed field is missing, and `agencyId` is always present — so a sparse
 * index here would index every household without a primary as
 * `(agencyId, null)` and the second such household in an agency would fail with
 * E11000. That is the same trap `LEGACY_DEDUPE_INDEX_OPTIONS` and
 * `householdRef` both document; 77 households on the production dump have no
 * primary at all.
 *
 * ── Why this is the last migration of the three ─────────────────────────────
 * It is the one that can legitimately fail on real data, and everything before
 * it is a data change that should land regardless. Ordering the shape first and
 * the enforcement last means a database with double primaries still gets its
 * memberships and still drops the old fields; only the rule waits for a human.
 *
 * ── Why it throws rather than skipping ──────────────────────────────────────
 * Same argument as `20260907110122-contact-identity-indexes.js`, and the same
 * failure it prevents: `autoIndex` creates a missing index *silently*, a unique
 * build over conflicting data simply **fails**, and the collection is then left
 * with no uniqueness and nothing in the logs naming the rows responsible. The
 * API applies pending migrations before it binds a port, so a deploy that has
 * not resolved the conflicts stops here rather than shipping a rule that
 * enforces nothing.
 *
 * ⚠ **Known blocked on the production data set as of 2026-09-07.** Phase 2's
 * duplicate-contact merge repointed both households of three
 * *household-level* duplicates onto the surviving contact — susan dudley
 * (HH-4790 / HH-4792), Justin Rivera (HH-4774 / HH-4775), Cristal Lubbers
 * (HH-4527 / HH-4540). §9's identity rule can prove the two *contacts* are one
 * person; it says nothing about which *household* is real, so the answer is the
 * owner's: merge the pair, or keep both and name which one the person is
 * primary of. Same class as the five households removed under §8, and the same
 * shape of answer. This migration is the thing that makes that decision
 * unskippable.
 *
 * Idempotent: an existing index is left alone and the conflict scan is
 * read-only.
 */

const INDEX_KEYS = { agencyId: 1, primaryContactId: 1 };
const INDEX_NAME = 'agencyId_1_primaryContactId_1';
const PARTIAL_FILTER = { primaryContactId: { $type: 'objectId' } };

/** How many offending contacts to print before truncating. */
const SAMPLE = 20;

/**
 * Contacts that are the primary of more than one household in the same agency.
 *
 * Reports the household *references* (`HH-4790`) rather than ObjectIds: those
 * are what the owner sees in SmartSuite and in the app, and a decision cannot
 * be made from a 24-hex id.
 */
async function findConflicts(db) {
  return db
    .collection('households')
    .aggregate([
      { $match: PARTIAL_FILTER },
      {
        $group: {
          _id: { agencyId: '$agencyId', primaryContactId: '$primaryContactId' },
          count: { $sum: 1 },
          households: { $push: { $ifNull: ['$householdRef', '$_id'] } },
          ids: { $push: '$_id' },
        },
      },
      { $match: { count: { $gt: 1 } } },
      {
        $lookup: {
          from: 'contacts',
          localField: '_id.primaryContactId',
          foreignField: '_id',
          as: 'contact',
        },
      },
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
    const households = db.collection('households');
    const existing = new Set(
      (await households.indexes()).map((index) => index.name),
    );
    if (existing.has(INDEX_NAME)) {
      console.log(`[PAC-91] ${INDEX_NAME} already exists — nothing to do.`);
      return;
    }

    const conflicts = await findConflicts(db);
    if (conflicts.length) {
      console.error(
        `[PAC-91] ${conflicts.length} contact(s) are the primary of more than ` +
          `one household, which ${INDEX_NAME} forbids:`,
      );
      for (const group of conflicts.slice(0, SAMPLE)) {
        const contact = group.contact?.[0];
        const who =
          [contact?.firstName, contact?.lastName].filter(Boolean).join(' ') ||
          String(group._id.primaryContactId);
        console.error(
          `  ${who}  (contact ${group._id.primaryContactId})  ` +
            `primary of ${group.count}: ${group.households.join(' / ')}`,
        );
      }
      if (conflicts.length > SAMPLE) {
        console.error(`  … and ${conflicts.length - SAMPLE} more`);
      }

      throw new Error(
        `Cannot build ${INDEX_NAME}: ${conflicts.length} contact(s) are the ` +
          'primary of two households. Each pair needs an owner decision — merge ' +
          'the two households, or keep both and name which one the person is ' +
          'primary of (the other then needs a different primary). See PAC-91 §5.',
      );
    }

    await households.createIndex(INDEX_KEYS, {
      name: INDEX_NAME,
      unique: true,
      partialFilterExpression: PARTIAL_FILTER,
    });
    console.log(`[PAC-91] built ${INDEX_NAME}`);
  },

  /**
   * @param {import('mongodb').Db} db
   * @returns {Promise<void>}
   */
  async down(db) {
    // Genuinely reversible: dropping an index destroys no data, it only stops
    // the rule being enforced.
    const households = db.collection('households');
    const existing = new Set(
      (await households.indexes()).map((index) => index.name),
    );
    if (existing.has(INDEX_NAME)) await households.dropIndex(INDEX_NAME);
  },
};
