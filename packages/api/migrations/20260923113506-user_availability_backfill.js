/**
 * PAC-139 §6 — every user gets an `availability` ("taking leads or not").
 *
 * ## Why a migration and not just the schema default
 *
 * Mongoose fills a missing path with its default when it *hydrates* a document,
 * so `GET /auth/me` would already say `available` for an old row. But the two
 * consumers this field exists for do not hydrate: the Manager view's Team
 * Activity table and the Command Center's "assign to" picker (PAC-138) filter
 * and group with `.lean()` / raw `{ availability: 'available' }` queries, and a
 * row without the field simply would not match — every producer created before
 * this deploy would vanish from "who can take this lead". Backfilling makes the
 * field a fact on the row rather than a convention in the reader.
 *
 * ## Idempotent
 *
 * Matches `{ availability: { $exists: false } }` only, so a re-run finds nothing
 * to do and never overwrites a value a user has since chosen.
 *
 * ⚠ The default is **copied in, not imported** from `@sfa/shared`
 * (`DEFAULT_USER_AVAILABILITY`): no TypeScript build is in this path, and an
 * applied migration must keep doing in a year what it did today.
 */

/** Copied from `DEFAULT_USER_AVAILABILITY` (`@sfa/shared`). */
const DEFAULT_AVAILABILITY = 'available';

module.exports = {
  /**
   * @param {import('mongodb').Db} db
   * @returns {Promise<void>}
   */
  async up(db) {
    const result = await db
      .collection('users')
      .updateMany(
        { availability: { $exists: false } },
        { $set: { availability: DEFAULT_AVAILABILITY } },
      );
    console.log(
      `[user-availability] set '${DEFAULT_AVAILABILITY}' on ${result.modifiedCount} user(s)`,
    );
  },

  /**
   * Removes the field from every user. Lossy by nature — a user who chose
   * `busy` loses that choice — which is acceptable: old code never read it,
   * and the next `up` restores the default.
   *
   * @param {import('mongodb').Db} db
   * @returns {Promise<void>}
   */
  async down(db) {
    const result = await db
      .collection('users')
      .updateMany(
        { availability: { $exists: true } },
        { $unset: { availability: '' } },
      );
    console.log(
      `[user-availability] removed the field from ${result.modifiedCount} user(s)`,
    );
  },
};
