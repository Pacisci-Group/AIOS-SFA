/**
 * Template for `npm run db:migrate:create -- <description>`.
 *
 * migrate-mongo copies this file for every new migration, and never *runs* it:
 * `sample-migration.js` is excluded from the migration list by name. Edit it to
 * change what a new migration starts out looking like.
 *
 * ── Rules for a migration in this repo ──────────────────────────────────────
 *
 * 1. **Applied migrations are immutable.** `useFileHash` is off, so editing a
 *    file that already ran changes nothing anywhere it has run. Fix a mistake
 *    with a new migration, never by editing an old one.
 *
 * 2. **Use the raw `db` handle, never a Mongoose model.** Importing a schema
 *    would compile a model and fire `autoIndex`, which races the very index a
 *    migration is often here to rebuild. The raw driver is also the only thing
 *    that still works when a migration predates a schema's current shape.
 *
 * 3. **Be idempotent and re-runnable.** The changelog normally guarantees one
 *    run, but a migration that fails halfway is *not* recorded and will be
 *    retried from the top on the next boot — so it has to tolerate finding its
 *    own partial work already done.
 *
 * 4. **Check before you destroy.** Rebuilding a unique index over data that
 *    contains duplicates fails, and failing *after* the drop leaves the
 *    collection with no uniqueness at all. Look for conflicts first, and bail
 *    with a clear error rather than dropping and hoping.
 *
 * 5. **Write `down` when a rollback is meaningful, and throw when it is not.**
 *    An empty `down` silently reports success and rolls back nothing.
 *
 * ── Changing the options of an existing index ────────────────────────────────
 * This is the case that most often needs a migration. Mongoose's `autoIndex`
 * only creates indexes that are *missing* — it never rebuilds one whose options
 * changed. So editing a schema fixes only collections created afterwards and
 * silently leaves existing ones on the old definition. MongoDB also rejects two
 * indexes with the same key pattern differing only in options, which forces
 * drop-then-create. Discover affected collections by index name rather than
 * hard-coding a list: which ones are stale depends on when each was created, so
 * it differs between dev, staging and production.
 */

module.exports = {
  /**
   * @param {import('mongodb').Db} db
   * @param {import('mongodb').MongoClient} client
   * @returns {Promise<void>}
   */
  async up(db, client) {
    // TODO write your migration here. Example:
    // await db.collection('households').updateMany(
    //   { archived: { $exists: false } },
    //   { $set: { archived: false } },
    // );
  },

  /**
   * @param {import('mongodb').Db} db
   * @param {import('mongodb').MongoClient} client
   * @returns {Promise<void>}
   */
  async down(db, client) {
    // TODO write the statements to roll `up` back. If a rollback is not
    // meaningful, throw — an empty `down` reports success and undoes nothing:
    // throw new Error('Irreversible: <why>.');
  },
};
