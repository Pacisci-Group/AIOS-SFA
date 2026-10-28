/**
 * PAC-173 — one person per Allstate code within an agency.
 *
 * A user's Allstate **Bind ID** (the portal login that binds policies) and
 * **sub-producer code** (who Allstate credits) are what Dash Reconciliation
 * reads to tell the agency's business from Allstate's 1-800 business and to
 * credit each line. Two people holding one code would make a line's producer
 * a coin toss, so each code is unique within its agency, enforced by two
 * partial unique indexes on `users`. Partial on the field being a string,
 * because almost nobody has a code yet and a missing one must never collide.
 *
 * ── Why a migration, when the schema declares the same indexes ──────────────
 * The `contact-identity-indexes` reason: Mongoose's `autoIndex` builds a
 * missing unique index *silently*, and a build over duplicate data simply
 * fails — leaving no uniqueness and nothing in the logs naming the rows. The
 * fields are new, so no database should hold a duplicate; this checks anyway,
 * prints the users involved and throws, so a deploy over hand-edited data
 * stops here instead of shipping an unenforced rule.
 *
 * Idempotent: an index that already exists is left alone, and the conflict
 * scan is read-only.
 *
 * ⚠ Copied in, not imported: no TypeScript build is in this path, and an
 * applied migration must keep doing in a year what it did today.
 */

/** Must match the two `UserSchema.index` calls in `src/users/schemas/user.schema.ts`. */
const ALLSTATE_CODE_INDEXES = [
  { agencyId: 1, allstateBindId: 1 },
  { agencyId: 1, allstateSubProducerCode: 1 },
];

/** How many offending groups to print before truncating. */
const SAMPLE = 20;

function indexName(keys) {
  return Object.entries(keys)
    .map(([field, direction]) => `${field}_${direction}`)
    .join('_');
}

/** The code field of an index — the one that is not `agencyId`. */
function codeField(keys) {
  return Object.keys(keys).find((field) => field !== 'agencyId');
}

function partialFilter(keys) {
  return { [codeField(keys)]: { $type: 'string' } };
}

/** Groups of users in one agency sharing a code — what would fail the build. */
async function findConflicts(db, keys) {
  const field = codeField(keys);
  return db
    .collection('users')
    .aggregate([
      { $match: partialFilter(keys) },
      {
        $group: {
          _id: { agencyId: '$agencyId', code: `$${field}` },
          count: { $sum: 1 },
          users: { $push: { id: '$_id', email: '$email' } },
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
    const users = db.collection('users');
    const existing = new Set(
      (await users.indexes()).map((index) => index.name),
    );

    for (const keys of ALLSTATE_CODE_INDEXES) {
      const name = indexName(keys);
      if (existing.has(name)) {
        console.log(`[PAC-173] ${name} already exists — nothing to do.`);
        continue;
      }

      const conflicts = await findConflicts(db, keys);
      if (conflicts.length) {
        console.error(
          `[PAC-173] ${conflicts.length} shared code(s) block ${name}:`,
        );
        for (const group of conflicts.slice(0, SAMPLE)) {
          console.error(
            `  agency ${group._id.agencyId}  ${codeField(keys)}=${group._id.code}  ` +
              group.users.map((user) => `${user.email} (${user.id})`).join(', '),
          );
        }
        if (conflicts.length > SAMPLE) {
          console.error(`  … and ${conflicts.length - SAMPLE} more`);
        }
        throw new Error(
          `Cannot build ${name}: ${conflicts.length} code(s) are on more than ` +
            'one user of the same agency. Clear the wrong ones (unset the field ' +
            'on that user) and restart. See PAC-173.',
        );
      }

      await users.createIndex(keys, {
        name,
        unique: true,
        partialFilterExpression: partialFilter(keys),
      });
      console.log(`[PAC-173] built ${name}`);
    }
  },

  /**
   * @param {import('mongodb').Db} db
   * @returns {Promise<void>}
   */
  async down(db) {
    // Dropping an index destroys no data; it only stops the rule being enforced.
    const users = db.collection('users');
    const existing = new Set(
      (await users.indexes()).map((index) => index.name),
    );
    for (const keys of ALLSTATE_CODE_INDEXES) {
      const name = indexName(keys);
      if (existing.has(name)) await users.dropIndex(name);
    }
  },
};
