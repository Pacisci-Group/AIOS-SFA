/**
 * PAC-149 — every agency gets an `endOfDayHour` (a whole hour, 0–23).
 *
 * Until PAC-149 every agency was set Away at 8 PM local, fixed in code
 * (`END_OF_DAY_LOCAL_HOUR`). The hour is now the owner's to set; an agency
 * that has not set it keeps exactly what it had.
 *
 * ## Why a migration and not just the schema default
 *
 * The same reason as `agency_timezone_backfill`: the worker's Away sweep reads
 * the agency with `.lean()`, which applies no schema defaults, so an agency
 * created before this field would read `undefined` forever. The sweep and
 * `AgencyProfileService` do fall back to 20 in code, but a fact on the row is
 * what lets the next reader rely on it without re-deriving the fallback.
 *
 * ## Idempotent
 *
 * Matches `{ endOfDayHour: { $exists: false } }` only, so a re-run finds
 * nothing to do and never overwrites an hour an owner has since chosen.
 *
 * ⚠ The default is **copied in, not imported** from `@sfa/shared`
 * (`DEFAULT_AGENCY_END_OF_DAY_HOUR`): no TypeScript build is in this path, and
 * an applied migration must keep doing in a year what it did today.
 */

/** Copied from `DEFAULT_AGENCY_END_OF_DAY_HOUR` (`@sfa/shared`). 8 PM. */
const DEFAULT_END_OF_DAY_HOUR = 20;

module.exports = {
  /**
   * @param {import('mongodb').Db} db
   * @returns {Promise<void>}
   */
  async up(db) {
    const result = await db
      .collection('agencies')
      .updateMany(
        { endOfDayHour: { $exists: false } },
        { $set: { endOfDayHour: DEFAULT_END_OF_DAY_HOUR } },
      );
    console.log(
      `[agency-end-of-day-hour] set ${DEFAULT_END_OF_DAY_HOUR} on ${result.modifiedCount} agenc(y/ies)`,
    );
  },

  /**
   * Removes the field only where it still holds the default — an agency whose
   * owner has since chosen another hour keeps that choice, since old code
   * never read the field and cannot be confused by it.
   *
   * @param {import('mongodb').Db} db
   * @returns {Promise<void>}
   */
  async down(db) {
    const result = await db
      .collection('agencies')
      .updateMany(
        { endOfDayHour: DEFAULT_END_OF_DAY_HOUR },
        { $unset: { endOfDayHour: '' } },
      );
    console.log(
      `[agency-end-of-day-hour] removed the default from ${result.modifiedCount} agenc(y/ies)`,
    );
  },
};
