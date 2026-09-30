/**
 * PAC-139 §6a — every agency gets a `timezone` (IANA name).
 *
 * ## Why a migration and not just the schema default
 *
 * The one reader today is the worker's end-of-day Away sweep, which reads the
 * agency with `.lean()` — and `.lean()` applies no schema defaults, so an
 * agency created before this field would read `undefined` forever. The sweep
 * does fall back to Central time in code, but a fact on the row is what lets
 * the next reader (a settings page, a report) rely on it without re-deriving
 * the fallback.
 *
 * ## Why `America/Chicago`
 *
 * Every agency on the platform today is in Oklahoma, which keeps US Central
 * time and has no IANA zone of its own. Deliberately not a per-agency guess
 * from an address: nothing on the row says where the agency is, and a wrong
 * zone would set people Away in the middle of their afternoon.
 *
 * ## Idempotent
 *
 * Matches `{ timezone: { $exists: false } }` only, so a re-run finds nothing to
 * do and never overwrites a value an operator has since set.
 *
 * ⚠ The default is **copied in, not imported** from
 * `src/common/dates/time-zones.ts` (`DEFAULT_AGENCY_TIME_ZONE`): no TypeScript
 * build is in this path, and an applied migration must keep doing in a year
 * what it did today.
 */

/** Copied from `DEFAULT_AGENCY_TIME_ZONE` (`common/dates/time-zones.ts`). */
const DEFAULT_TIME_ZONE = 'America/Chicago';

module.exports = {
  /**
   * @param {import('mongodb').Db} db
   * @returns {Promise<void>}
   */
  async up(db) {
    const result = await db
      .collection('agencies')
      .updateMany(
        { timezone: { $exists: false } },
        { $set: { timezone: DEFAULT_TIME_ZONE } },
      );
    console.log(
      `[agency-timezone] set '${DEFAULT_TIME_ZONE}' on ${result.modifiedCount} agenc(y/ies)`,
    );
  },

  /**
   * Removes the field only where it still holds the default — an agency an
   * operator has since moved to another zone keeps that choice, since old
   * code never read the field and cannot be confused by it.
   *
   * @param {import('mongodb').Db} db
   * @returns {Promise<void>}
   */
  async down(db) {
    const result = await db
      .collection('agencies')
      .updateMany(
        { timezone: DEFAULT_TIME_ZONE },
        { $unset: { timezone: '' } },
      );
    console.log(
      `[agency-timezone] removed the default from ${result.modifiedCount} agenc(y/ies)`,
    );
  },
};
