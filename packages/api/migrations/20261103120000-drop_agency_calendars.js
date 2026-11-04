/**
 * PAC-161 v3: holidays and the working week moved into HR policies
 * (`holidayPolicies`, `workWeekPolicies`), so the agency calendar is gone.
 *
 * `20261022120000-hr_module` step (d) created an `agencyCalendars` document
 * for every agency, and the v2 settings page wrote `agencyCalendarDays` rows.
 * Neither has a reader any more. That migration is immutable (applied to at
 * least one local database), so this one drops what it left behind — on a
 * fresh database the pair runs back to back and ends with neither collection.
 *
 * Nothing is carried over into a policy: no shared database ever held a
 * holiday row (the v2 page was never released), and the platform rule is
 * that no holiday is written without a person choosing it.
 *
 * Idempotent: a missing collection is skipped.
 */

const COLLECTIONS = ['agencyCalendars', 'agencyCalendarDays'];

module.exports = {
  /** @param {import('mongodb').Db} db */
  async up(db) {
    const present = new Set(
      (await db.listCollections({}, { nameOnly: true }).toArray()).map(
        (c) => c.name,
      ),
    );
    for (const name of COLLECTIONS) {
      if (!present.has(name)) continue;
      const count = await db.collection(name).estimatedDocumentCount();
      await db.collection(name).drop();
      console.log(`[drop-agency-calendars] dropped ${name} (${count} document(s))`);
    }
  },

  async down() {
    throw new Error(
      'drop_agency_calendars cannot be rolled back: the calendar code is gone, and the dropped rows are not kept.',
    );
  },
};
