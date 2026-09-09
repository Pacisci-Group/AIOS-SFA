/**
 * PAC-91 §5 — remove the fields the `householdMembers` join collection
 * replaces, once every reader and writer has moved off them.
 *
 * Dropped here:
 *
 * | Field | Why it cannot survive many-to-many |
 * |---|---|
 * | `Contact.householdId` | One link per person. A second household overwrote the first. |
 * | `Contact.legacyHouseholdId` | The same, on the migration side (§6). |
 * | `Contact.isPrimary` | "Primary **of what?**" — duplicates `Household.primaryContactId`, and legacy intake stamped it on every contact it created. |
 * | `Contact.roleInHousehold` | Role is per membership: "Named Insured" at home, "Driver" elsewhere. |
 * | `Household.memberContactIds` | The other half of the same link, with nowhere to put `role` or `endedAt` — and ending a membership by `$pull` is precisely the loss §5 describes. |
 *
 * ── Why last, and why its own migration ─────────────────────────────────────
 * The seed migration before it reads all five. Running them in one file would
 * mean one failure leaving a database with neither shape — and a re-run, which
 * a failed migration always gets, finding nothing to seed from. Splitting them
 * makes the halfway state "memberships exist, old fields still there", which
 * every reader in this release already tolerates because it reads only the
 * memberships.
 *
 * That same property is what lets the primary-contact index migration *after*
 * this one fail loudly on a database with double primaries without holding up
 * the data change: the shape lands, only the enforcement waits.
 *
 * ── `down` throws ───────────────────────────────────────────────────────────
 * `householdMembers` can rebuild `memberContactIds` and a single `householdId`
 * for a one-household contact, but not `roleInHousehold` for a multi-household
 * one (there are several roles and one field), not `legacyHouseholdId` (the
 * SmartSuite string is gone), and not `isPrimary` as legacy wrote it. A `down`
 * that restored three of five fields and silently invented the other two is
 * worse than no rollback: restore from a snapshot instead.
 */

/** `$unset` in batches, so a 3,000-document collection is one pass, not 3,000. */
const CONTACT_FIELDS = {
  householdId: '',
  legacyHouseholdId: '',
  isPrimary: '',
  roleInHousehold: '',
};

const HOUSEHOLD_FIELDS = {
  memberContactIds: '',
};

/** Documents still carrying any of the given fields. */
function anyFieldExists(fields) {
  return { $or: Object.keys(fields).map((field) => ({ [field]: { $exists: true } })) };
}

module.exports = {
  /**
   * @param {import('mongodb').Db} db
   * @returns {Promise<void>}
   */
  async up(db) {
    const members = await db.collection('householdMembers').countDocuments();
    if (members === 0) {
      const households = await db.collection('households').countDocuments();
      // An empty join collection on a database that *has* households means the
      // seed did not run — dropping the source fields now would destroy the
      // only copy of the link. On a genuinely empty database both are zero and
      // there is nothing to protect.
      if (households > 0) {
        throw new Error(
          'householdMembers is empty but households exist — the seed migration ' +
            'has not run. Refusing to drop the fields it seeds from. See PAC-91 §5.',
        );
      }
    }

    const contacts = await db
      .collection('contacts')
      .updateMany(anyFieldExists(CONTACT_FIELDS), { $unset: CONTACT_FIELDS });
    const households = await db
      .collection('households')
      .updateMany(anyFieldExists(HOUSEHOLD_FIELDS), {
        $unset: HOUSEHOLD_FIELDS,
      });

    /*
     * The indexes over the fields just dropped.
     *
     * `autoIndex` never *removes* an index whose schema declaration is gone —
     * it only creates missing ones — so without this they sit there costing a
     * write on every contact insert, forever, to index a field that no document
     * has. Dropped by name and tolerant of a missing one, so a re-run after a
     * partial failure still completes.
     *
     * `legacyHouseholdId_1` is here for the same reason and is easy to miss:
     * it comes from the `index: true` on the `@Prop`, not from an explicit
     * `schema.index(...)` call, so it does not show up when you grep the schema
     * for index declarations. The rehearsal is what caught it.
     */
    for (const name of [
      'agencyId_1_householdId_1',
      'householdId_1',
      'legacyHouseholdId_1',
    ]) {
      await db
        .collection('contacts')
        .dropIndex(name)
        .catch((error) => {
          if (error?.codeName !== 'IndexNotFound') throw error;
        });
    }

    console.log(
      `[PAC-91] dropped the pre-membership link fields: ` +
        `${contacts.modifiedCount} contact(s), ` +
        `${households.modifiedCount} household(s) — ` +
        `membership now lives in householdMembers (${members} row(s)).`,
    );
  },

  /**
   * @param {import('mongodb').Db} db
   * @returns {Promise<void>}
   */
  async down() {
    throw new Error(
      'Irreversible: householdMembers cannot rebuild roleInHousehold for a ' +
        'multi-household contact (several roles, one field), legacyHouseholdId ' +
        '(the SmartSuite string is gone), or isPrimary as legacy wrote it. ' +
        'Restore from a snapshot.',
    );
  },
};
