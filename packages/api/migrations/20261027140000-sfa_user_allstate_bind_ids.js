/**
 * PAC-173 — put Smith Family Agency's Allstate Bind IDs on its users.
 *
 * Dash Reconciliation reads a policy's binder off the Allstate portal login
 * (the **Bind ID**, `SOK…`) stored on each user (`users.allstateBindId`).
 * New people enter theirs when invited; the people already here need theirs
 * written once, or every line they bound reads as a former employee's.
 *
 * ## Where the pairs come from
 *
 * Allstate's Dash "New Business Details" export for Jul–Sep 2026 (agent
 * 0B9049) prints each line's Bind ID beside a **Bind ID Name**. Every SOK
 * Bind ID the export names was cross-referenced against the agency's users by
 * full name; the ten that matched are below. The file cannot be read at
 * deploy time, so the result is copied in.
 *
 * - Mike Iles is listed by Allstate under his legal name, JAMES ILES (his
 *   email is jamesiles@…) — matched on the app's name, Mike Iles.
 * - SOKA73GT is named JUSTIN CARRASCO on 60 lines and SHAWNA ADAMS on one;
 *   it is Justin's (Shawna's own is SOKV4UCQ, named on 45 lines).
 * - Named in the export but with **no account** here, so not written (their
 *   lines read as former employees): SOK35W06 Brian Carter, SOK2IYDA Ashley
 *   Lewis, SOK35W02 Marco Perez, SOK35W0C Jacob Landrum, SOK63HB8 Ashlie
 *   Anderson.
 * - SOK logins the export never names (SOKEG0FL, SOKHK80A, SOKJ3KZX,
 *   SOKP1004, SOKQL10G, SOKY2S1D) cannot be tied to anyone and are left alone.
 *
 * ## Safe to run anywhere, and more than once
 *
 * Only the agency with slug `smith-family-agency` is touched; any other
 * database records this as applied and changes nothing. A user is matched on
 * exact first + last name (case-insensitive) within that agency, and written
 * only when the match is unique, the user has no Bind ID yet, and no one else
 * in the agency holds that Bind ID — anything else is logged and skipped,
 * never guessed or overwritten (the owner corrects it on the Users page). A
 * re-run finds the codes in place and changes nothing.
 *
 * Runs after `user_allstate_code_indexes`, which makes a Bind ID unique per
 * agency. `users.agencyId` is an **ObjectId**.
 *
 * ⚠ Copied in, not imported: no TypeScript build is in this path, and an
 * applied migration must keep doing in a year what it did today.
 */

const AGENCY_SLUG = 'smith-family-agency';

/** `[Bind ID, name as Dash prints it, firstName, lastName]` — from the Jul–Sep 2026 export. */
const BIND_IDS = [
  ['SOK5PE0T', 'JESSICA YATES', 'Jessica', 'Yates'],
  ['SOK4YQE5', 'SABRINA WEBB', 'Sabrina', 'Webb'],
  ['SOKA73GT', 'JUSTIN CARRASCO', 'Justin', 'Carrasco'],
  ['SOKHRI4U', 'ASHLEY MILLER', 'Ashley', 'Miller'],
  ['SOKV4UCQ', 'SHAWNA ADAMS', 'Shawna', 'Adams'],
  ['SOKHFIKF', 'YESSENIA CAMPOS', 'Yessenia', 'Campos'],
  ['SOK35W0E', 'DAVID HOWARD', 'David', 'Howard'],
  ['SOK29BWO', 'JAMES ILES', 'Mike', 'Iles'],
  ['SOKEWH1J', 'BRANDON SPENCER', 'Brandon', 'Spencer'],
  ['SOK35W0B', 'CHANDLER MONTGOMERY', 'Chandler', 'Montgomery'],
];

function exactName(value) {
  return new RegExp(
    `^\\s*${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`,
    'i',
  );
}

async function findAgency(db) {
  return db
    .collection('agencies')
    .findOne({ slug: AGENCY_SLUG }, { projection: { _id: 1 } });
}

module.exports = {
  /**
   * @param {import('mongodb').Db} db
   * @returns {Promise<void>}
   */
  async up(db) {
    const agency = await findAgency(db);
    if (!agency) {
      console.log(`[PAC-173] no agency "${AGENCY_SLUG}" here — nothing to do.`);
      return;
    }
    const users = db.collection('users');

    for (const [bindId, dashName, firstName, lastName] of BIND_IDS) {
      const label = `${bindId} (${dashName})`;
      const matches = await users
        .find(
          {
            agencyId: agency._id,
            isPlatformAdmin: { $ne: true },
            firstName: exactName(firstName),
            lastName: exactName(lastName),
          },
          { projection: { email: 1, allstateBindId: 1 } },
        )
        .toArray();
      if (matches.length !== 1) {
        console.log(
          `[PAC-173] skip ${label}: ${matches.length} users named ${firstName} ${lastName}.`,
        );
        continue;
      }
      const [user] = matches;
      if (user.allstateBindId === bindId) {
        console.log(`[PAC-173] ${label} already on ${user.email}.`);
        continue;
      }
      if (user.allstateBindId) {
        console.log(
          `[PAC-173] skip ${label}: ${user.email} already has Bind ID ${user.allstateBindId}.`,
        );
        continue;
      }
      const holder = await users.findOne(
        { agencyId: agency._id, allstateBindId: bindId },
        { projection: { email: 1 } },
      );
      if (holder) {
        console.log(
          `[PAC-173] skip ${label}: already held by ${holder.email}.`,
        );
        continue;
      }
      await users.updateOne(
        { _id: user._id, allstateBindId: { $exists: false } },
        { $set: { allstateBindId: bindId } },
      );
      console.log(`[PAC-173] ${label} → ${firstName} ${lastName} <${user.email}>`);
    }
  },

  /**
   * @param {import('mongodb').Db} db
   * @returns {Promise<void>}
   */
  async down(db) {
    // Removes exactly these codes from exactly these people — a Bind ID the
    // owner has since changed is left alone.
    const agency = await findAgency(db);
    if (!agency) return;
    for (const [bindId, , firstName, lastName] of BIND_IDS) {
      await db.collection('users').updateMany(
        {
          agencyId: agency._id,
          firstName: exactName(firstName),
          lastName: exactName(lastName),
          allstateBindId: bindId,
        },
        { $unset: { allstateBindId: 1 } },
      );
    }
  },
};
