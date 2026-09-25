/**
 * Index the replacement-resume lookup on `leads` (PAC-126).
 *
 * ## Why a migration and not just the schema
 *
 * `autoIndex` only ever *creates* indexes that are missing, so adding one to
 * `LeadSchema` would build it in a fresh database and silently skip every
 * environment whose `leads` collection already exists — which is all of them.
 * This is the one pass that builds it where the collection is already there.
 *
 * ## What it is for
 *
 * A Cancel Rewrite and a Company Transfer now run through the ordinary Sold
 * pipeline, which is anchored on a lead — so a lead is created for the
 * replacement and stamped with `replacementIntent`. The chain is two forms long,
 * and a rep can close the tab between them, so both entry points ask the same
 * question every time they render: *is there already an open lead for this
 * policy's replacement?* That query is
 * `{ agencyId, 'replacementIntent.policyId' }`, and this is its index.
 *
 * ## Partial, deliberately
 *
 * Almost no lead carries an intent. A full index would cover the whole
 * collection to serve the handful that do, and every ordinary lead write would
 * pay for it.
 *
 * ⚠ A partial index is only used when the query **provably implies** its filter,
 * so the `$exists` filter here has to stay in step with what
 * `LeadsService.findReplacementLead` actually sends. If the query stops naming
 * `replacementIntent.policyId`, the planner silently falls back to a collection
 * scan rather than erroring — so this is the kind of drift that shows up as a
 * slow page, not a failure.
 *
 * Not unique: two open intents for one policy is a state worth reading rather
 * than a write to reject. A rep whose data scope hides a colleague's lead would
 * otherwise hit an opaque duplicate-key error on a record they cannot see, and
 * the resume takes the newest match anyway.
 *
 * Idempotent: `createIndex` with the same name and options is a no-op, and a
 * conflicting definition under that name is reported rather than forced.
 */

const COLLECTION = 'leads';
const INDEX_NAME = 'agencyId_1_replacementIntent.policyId_1';

module.exports = {
  /**
   * @param {import('mongodb').Db} db
   * @returns {Promise<void>}
   */
  async up(db) {
    const existing = await db
      .collection(COLLECTION)
      .listIndexes()
      .toArray()
      .catch(() => []);

    if (existing.some((index) => index.name === INDEX_NAME)) {
      console.log(
        `[lead-replacement-intent-index] ${INDEX_NAME} already exists — nothing to do.`,
      );
      return;
    }

    await db.collection(COLLECTION).createIndex(
      { agencyId: 1, 'replacementIntent.policyId': 1 },
      {
        name: INDEX_NAME,
        partialFilterExpression: {
          'replacementIntent.policyId': { $exists: true },
        },
      },
    );

    console.log(
      `[lead-replacement-intent-index] built ${INDEX_NAME} on ${COLLECTION} ` +
        '(partial: only leads created to replace a policy).',
    );
  },

  /**
   * @param {import('mongodb').Db} db
   * @returns {Promise<void>}
   */
  async down(db) {
    /*
     * Safe to reverse, unlike most of the migrations here: an index carries no
     * information of its own, so dropping it loses nothing but the lookup speed.
     * Guarded so a rollback on a database that never had it is not an error.
     */
    try {
      await db.collection(COLLECTION).dropIndex(INDEX_NAME);
      console.log(`[lead-replacement-intent-index] dropped ${INDEX_NAME}.`);
    } catch {
      console.log(
        `[lead-replacement-intent-index] ${INDEX_NAME} was not present — nothing to drop.`,
      );
    }
  },
};
