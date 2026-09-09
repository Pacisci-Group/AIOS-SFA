/**
 * PAC-91 §5/§6 — seed the `householdMembers` join collection from the two
 * places membership was stored before it.
 *
 * Membership is many-to-many (David, 2026-09-04: *a contact can belong to
 * several households, but is the primary contact of at most one*), and the old
 * schema held it in two half-shapes that nothing reconciled:
 *
 *   - `Household.memberContactIds` + `Household.primaryContactId`
 *   - `Contact.householdId`
 *
 * ── Why all three sources, and not the two the plan named ───────────────────
 * The plan says "one row per (household, contactId ∈ memberContactIds ∪
 * {primaryContactId})". Measured on the restored production dump that would
 * have lost 19 memberships: the household side yields 2,795 pairs, and 19
 * contacts carry a `householdId` naming a household that does not list them
 * back — the rows PAC-91 §8 kept because they had SmartSuite's single
 * `Household` link and no household-side link. Taking the union of all three is
 * the same lesson §8 already learned about `Primary Contact` vs
 * `Household Members` (266 primaries were not in their own member list): when
 * two sides disagree about a link, the answer is the union, because each side
 * is only ever *missing* links — neither invents them.
 *
 * Every source is counted separately in the log, which is the §6 reconciliation.
 *
 * ── Idempotency ─────────────────────────────────────────────────────────────
 * The `{agencyId, householdId, contactId}` unique index is created **first**
 * (this migration runs before any Mongoose model exists, so `autoIndex` has not
 * had a chance), then inserts run `ordered: false` and E11000s are counted as
 * "already there". A migration that fails halfway is not recorded and retries
 * from the top, so it has to tolerate finding its own partial work — which this
 * shape does without a read-back.
 *
 * Roles are copied from `Contact.roleInHousehold`, which the *next* migration
 * removes. The order is load-bearing: run this one second and every membership
 * loses its role silently.
 *
 * `createdBy` / `updatedBy` are left unset. A migration has no acting user and
 * `null` reads as "system" (AGENTS.md §11) — no placeholder id is minted.
 */

/** Insert batch size — big enough to be one round trip per ~2,000 rows. */
const BATCH_SIZE = 1000;

/** MongoDB duplicate-key error code. */
const DUPLICATE_KEY = 11000;

/**
 * Flush a batch, treating a duplicate as work already done.
 *
 * `ordered: false` is what makes that true: an ordered bulk insert stops at the
 * first duplicate and abandons the rest of the batch, so a retry after a partial
 * run would never get past the first row it had already written.
 */
async function insertIgnoringDuplicates(collection, docs) {
  if (!docs.length) return { inserted: 0, duplicates: 0 };
  try {
    const result = await collection.insertMany(docs, { ordered: false });
    return { inserted: result.insertedCount, duplicates: 0 };
  } catch (error) {
    const writeErrors = error?.writeErrors ?? [];
    const foreign = writeErrors.filter((e) => e.err?.code !== DUPLICATE_KEY);
    if (!writeErrors.length || foreign.length) throw error;
    return {
      inserted: error.result?.insertedCount ?? 0,
      duplicates: writeErrors.length,
    };
  }
}

module.exports = {
  /**
   * @param {import('mongodb').Db} db
   * @returns {Promise<void>}
   */
  async up(db) {
    const members = db.collection('householdMembers');
    const households = db.collection('households');
    const contacts = db.collection('contacts');

    // Before any insert: the unique index is this migration's idempotency, not
    // a nicety to add afterwards.
    await members.createIndex(
      { agencyId: 1, householdId: 1, contactId: 1 },
      { unique: true, name: 'agencyId_1_householdId_1_contactId_1' },
    );
    await members.createIndex(
      { agencyId: 1, contactId: 1 },
      { name: 'agencyId_1_contactId_1' },
    );

    /**
     * contact `_id` (string) -> its stored role, for the membership's `role`.
     *
     * Blanks are skipped rather than copied. The importer writes
     * `normalizeContactRole(...)`, which answers `''` when the SmartSuite row
     * had no role — 286 contacts on the production dump — and a stored empty
     * string is a third state readers would have to know about on top of "a
     * role" and "no role". Absent is the honest one: the membership simply does
     * not record a role.
     */
    const roleByContact = new Map();
    await contacts
      .find(
        { roleInHousehold: { $type: 'string' } },
        { projection: { roleInHousehold: 1 } },
      )
      .forEach((contact) => {
        const role = contact.roleInHousehold.trim();
        if (role) roleByContact.set(String(contact._id), role);
      });

    /** `<householdId>|<contactId>` already queued this run. */
    const seen = new Set();
    const counts = {
      primary: 0,
      memberList: 0,
      contactSide: 0,
      inserted: 0,
      duplicates: 0,
      danglingHousehold: 0,
    };
    let batch = [];

    const flush = async () => {
      const result = await insertIgnoringDuplicates(members, batch);
      counts.inserted += result.inserted;
      counts.duplicates += result.duplicates;
      batch = [];
    };

    const queue = async (household, contactId, source) => {
      const key = `${String(household._id)}|${String(contactId)}`;
      if (seen.has(key)) return;
      seen.add(key);
      counts[source]++;
      batch.push({
        agencyId: household.agencyId,
        branchId: household.branchId,
        householdId: household._id,
        contactId,
        ...(roleByContact.has(String(contactId))
          ? { role: roleByContact.get(String(contactId)) }
          : {}),
        // The household's own creation date, not the migration's clock:
        // "joined the day we imported them" is a date nobody can act on.
        addedAt: household.createdAt ?? new Date(),
        endedAt: null,
        source: household.legacySmartSuiteId ? 'smartsuite' : 'intake',
        createdBy: null,
        updatedBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      if (batch.length >= BATCH_SIZE) await flush();
    };

    // ── Household side: primary + member list ────────────────────────────────
    const householdById = new Map();
    const cursor = households.find(
      {},
      {
        projection: {
          agencyId: 1,
          branchId: 1,
          createdAt: 1,
          legacySmartSuiteId: 1,
          primaryContactId: 1,
          memberContactIds: 1,
        },
      },
    );
    for await (const household of cursor) {
      householdById.set(String(household._id), household);
      if (household.primaryContactId) {
        await queue(household, household.primaryContactId, 'primary');
      }
      for (const contactId of household.memberContactIds ?? []) {
        await queue(household, contactId, 'memberList');
      }
    }

    // ── Contact side: the links only `Contact.householdId` ever knew about ───
    const contactCursor = contacts.find(
      { householdId: { $type: 'objectId' } },
      { projection: { householdId: 1 } },
    );
    for await (const contact of contactCursor) {
      const household = householdById.get(String(contact.householdId));
      if (!household) {
        // A contact pointing at a household that no longer exists. Counted, not
        // written: a membership of nothing is worse than no membership.
        counts.danglingHousehold++;
        continue;
      }
      await queue(household, contact._id, 'contactSide');
    }

    await flush();

    console.log(
      `[PAC-91] householdMembers seeded: ${counts.inserted} inserted, ` +
        `${counts.duplicates} already present. Sources — ` +
        `${counts.primary} primary contacts, ${counts.memberList} member-list ` +
        `entries, ${counts.contactSide} from Contact.householdId alone` +
        (counts.danglingHousehold
          ? `; ${counts.danglingHousehold} contact(s) named a household that no longer exists (skipped)`
          : ''),
    );
  },

  /**
   * @param {import('mongodb').Db} db
   * @returns {Promise<void>}
   */
  async down(db) {
    // Reversible: the collection is derived entirely from data the next
    // migration has not yet removed, so dropping it loses nothing that cannot
    // be rebuilt by running `up` again. (Once `drop-contact-household-fields`
    // has run, rolling *this* back is only meaningful together with that one —
    // which is why that migration's own `down` throws.)
    await db.collection('householdMembers').drop().catch((error) => {
      // `ns not found` — nothing to drop, which is the state `down` wants.
      if (error?.codeName !== 'NamespaceNotFound') throw error;
    });
  },
};
