/**
 * PAC-162 — an employee profile for every existing user of every agency
 * with the HR module on.
 *
 * The same catch-up `EmployeeProfilesService.ensureProfilesForAgency` runs
 * after the SmartSuite import's Users step and in the demo seed — copied in
 * here, as every migration copies its logic in, so that what this did in a
 * year is what it does today.
 *
 * - A profile is `pending` for an active account **and** a pending invite
 *   (the person is joining): no hire date, nothing onboarded. An HR admin
 *   completes it from the People page. The migrated agency's people all
 *   start here — the legacy Users table has no hire date.
 * - A removed user (`deactivatedAt` set) gets a `terminated` profile dated
 *   the removal day on the agency's calendar, so a later reactivation finds
 *   a row to reopen.
 * - Platform admins are not an agency's people.
 * - Rows a dev database kept from the closed PAC-162 v1 build (PR #155)
 *   carry fields no code reads any more (`leavePolicyId`, `overrides`,
 *   `assignments`, …); they are unset. No shared database has such rows.
 * - Nothing is indexed here. `employeeProfiles` is a new collection and
 *   `autoIndex` builds its indexes — the unique `{ agencyId, userId }` among
 *   them — on the next boot; the existence check below is what keeps a
 *   retry from writing a second row.
 *
 * ## Idempotent
 *
 * Existence-guarded inserts and an `$unset` that matches nothing the second
 * time. A failed run is not recorded and retries from the top.
 *
 * ⚠ `agencyId` is an **ObjectId** on `users` and a **string** on
 * `employeeProfiles` (the HR policies' convention). Both forms are used
 * below on purpose.
 */

/** Copied from `ModuleKey.Hr`. */
const MODULE_KEY = 'hr';

/** Copied from `DEFAULT_AGENCY_TIME_ZONE`. */
const DEFAULT_TIME_ZONE = 'America/Chicago';

/** The v1 fields no reader has. */
const DEAD_FIELDS = [
  'leavePolicyId',
  'overrides',
  'assignments',
  'allocations',
  'scheduleTemplateId',
  'scheduleOverride',
  'comp',
  'managerId',
  'workAnniversary',
];

/** `YYYY-MM-DD` of an instant on the agency's calendar (`en-CA` formats ISO-style). */
function calendarDay(instant, timeZone) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(instant);
  } catch {
    return instant.toISOString().slice(0, 10);
  }
}

module.exports = {
  /**
   * @param {import('mongodb').Db} db
   * @returns {Promise<void>}
   */
  async up(db) {
    const now = new Date();
    const profiles = db.collection('employeeProfiles');

    const agencies = await db
      .collection('agencies')
      .find(
        { [`modules.${MODULE_KEY}.enabled`]: true },
        { projection: { _id: 1, timezone: 1 } },
      )
      .toArray();

    let created = 0;
    for (const agency of agencies) {
      const agencyId = agency._id.toString();
      const timeZone = agency.timezone || DEFAULT_TIME_ZONE;
      const users = await db
        .collection('users')
        .find(
          { agencyId: agency._id, isPlatformAdmin: { $ne: true } },
          { projection: { _id: 1, deactivatedAt: 1 } },
        )
        .toArray();
      if (users.length === 0) continue;

      const existing = await profiles
        .find({ agencyId }, { projection: { userId: 1 } })
        .toArray();
      const have = new Set(existing.map((row) => row.userId.toString()));

      const rows = users
        .filter((user) => !have.has(user._id.toString()))
        .map((user) => ({
          agencyId,
          userId: user._id,
          status: user.deactivatedAt ? 'terminated' : 'pending',
          hireDate: null,
          terminationDate: user.deactivatedAt
            ? calendarDay(user.deactivatedAt, timeZone)
            : null,
          dateOfBirth: null,
          showBirthday: true,
          onboarding: { completedAt: null, completedBy: null },
          createdBy: null,
          updatedBy: null,
          createdAt: now,
          updatedAt: now,
        }));
      if (rows.length) {
        await profiles.insertMany(rows);
        created += rows.length;
      }
    }

    const unset = await profiles.updateMany(
      { $or: DEAD_FIELDS.map((field) => ({ [field]: { $exists: true } })) },
      { $unset: Object.fromEntries(DEAD_FIELDS.map((field) => [field, ''])) },
    );

    console.log(
      `[employee-profiles] ${agencies.length} agency(ies), ${created} profile(s) created, ${unset.modifiedCount} v1 row(s) cleaned`,
    );
  },

  async down() {
    throw new Error(
      'employee_profiles cannot be rolled back: the profiles created here may since have been onboarded.',
    );
  },
};
