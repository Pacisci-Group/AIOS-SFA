/**
 * PAC-162 — a pending employee profile for every existing user of every
 * agency with the HR module on.
 *
 * The same catch-up `EmployeeProfilesService.ensureProfilesForAgency` runs
 * when a super admin switches HR on later, when the SmartSuite import
 * finishes its Users step, and in the demo seed — copied in here, as every
 * migration copies its logic in, so that what this did in a year is what it
 * does today.
 *
 * - A profile is `pending`: no hire date, no policy, no history. An HR admin
 *   activates it from HR → Onboardings. No notification is sent — this is a
 *   catch-up, not an invite; the Onboardings list and its counts are the
 *   catch-up surface.
 * - Platform admins are not an agency's people, and a deactivated user is
 *   not on the roster (a reactivation creates the profile then). A pending
 *   invite **is** included: the person is joining.
 * - Nothing is indexed here. `employeeProfiles` is a new collection, and
 *   `autoIndex` builds its indexes — the unique `{ agencyId, userId }`
 *   among them — on the next boot; a collection this migration created has
 *   no duplicates to trip it, and the existence check below is what keeps
 *   a retry from writing a second row.
 *
 * ## Idempotent
 *
 * Existence-guarded inserts; a re-run finds every row and writes nothing. A
 * failed run is not recorded and retries from the top.
 *
 * ⚠ `agencyId` is an **ObjectId** on `users` and a **string** on
 * `employeeProfiles` (the HR calendar's convention). Both forms are used
 * below on purpose.
 */

/** Copied from `ModuleKey.Hr`. */
const MODULE_KEY = 'hr';

module.exports = {
  /**
   * @param {import('mongodb').Db} db
   * @returns {Promise<void>}
   */
  async up(db) {
    const now = new Date();
    const profiles = db.collection('employeeProfiles');
    const events = db.collection('employeeProfileEvents');

    const agencies = await db
      .collection('agencies')
      .find(
        { [`modules.${MODULE_KEY}.enabled`]: true },
        { projection: { _id: 1 } },
      )
      .toArray();

    let created = 0;
    for (const agency of agencies) {
      const agencyId = agency._id.toString();
      const users = await db
        .collection('users')
        .find(
          {
            agencyId: agency._id,
            isPlatformAdmin: { $ne: true },
            deactivatedAt: null,
          },
          { projection: { _id: 1 } },
        )
        .toArray();
      if (users.length === 0) continue;

      const existing = await db
        .collection('employeeProfiles')
        .find({ agencyId }, { projection: { userId: 1 } })
        .toArray();
      const have = new Set(existing.map((row) => row.userId.toString()));

      for (const user of users) {
        if (have.has(user._id.toString())) continue;
        const { insertedId } = await profiles.insertOne({
          agencyId,
          userId: user._id,
          status: 'pending',
          hireDate: null,
          workAnniversary: null,
          terminationDate: null,
          dateOfBirth: null,
          showBirthday: true,
          leavePolicyId: null,
          overrides: {},
          scheduleTemplateId: null,
          scheduleOverride: null,
          allocations: {},
          assignments: [],
          comp: null,
          managerId: null,
          createdBy: null,
          updatedBy: null,
          createdAt: now,
          updatedAt: now,
        });
        await events.insertOne({
          agencyId,
          profileId: insertedId,
          userId: user._id,
          at: now,
          actorId: null,
          kind: 'created',
          changes: [
            {
              field: 'status',
              label: 'Status',
              kind: 'text',
              from: null,
              to: 'Pending onboarding',
            },
            {
              field: 'showBirthday',
              label: 'Show birthday on the calendar',
              kind: 'text',
              from: null,
              to: 'Yes',
            },
          ],
          reason: null,
          createdBy: null,
          updatedBy: null,
          createdAt: now,
          updatedAt: now,
        });
        created += 1;
      }
    }

    console.log(
      `[employee-profiles] ${created} pending profile(s) created across ` +
        `${agencies.length} agenc${agencies.length === 1 ? 'y' : 'ies'} with HR enabled`,
    );
  },

  /**
   * Removes only what `up` could have written and nobody has touched since:
   * rows still `pending` with no history. A profile an admin activated,
   * terminated or edited is data and stays, together with its events.
   *
   * @param {import('mongodb').Db} db
   * @returns {Promise<void>}
   */
  async down(db) {
    const untouched = await db
      .collection('employeeProfiles')
      .find(
        { status: 'pending', assignments: { $size: 0 }, hireDate: null },
        { projection: { _id: 1 } },
      )
      .toArray();
    const ids = untouched.map((row) => row._id);
    if (ids.length === 0) {
      console.log('[employee-profiles] nothing to remove');
      return;
    }
    // Only rows whose sole event is the `created` one this migration wrote.
    const edited = await db
      .collection('employeeProfileEvents')
      .distinct('profileId', { profileId: { $in: ids }, kind: { $ne: 'created' } });
    const editedKeys = new Set(edited.map((id) => id.toString()));
    const removable = ids.filter((id) => !editedKeys.has(id.toString()));

    await db
      .collection('employeeProfileEvents')
      .deleteMany({ profileId: { $in: removable } });
    const removed = await db
      .collection('employeeProfiles')
      .deleteMany({ _id: { $in: removable } });
    console.log(
      `[employee-profiles] removed ${removed.deletedCount} untouched pending profile(s); ` +
        `${ids.length - removable.length} left in place`,
    );
  },
};
