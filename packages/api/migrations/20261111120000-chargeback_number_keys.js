/**
 * PAC-182 review — every ledger row that names no policy carries
 * `policyNumberKey`.
 *
 * "A policy is charged back once" looks a number up among the chargebacks
 * that name no policy (a chargeback-report line or a manager's manual line
 * for a policy the app does not hold). It used to read **every** such row the
 * agency had and compare numbers in memory, inside the ledger lock; it now
 * reads only the rows carrying the numbers it is asked about, by the
 * `{ agencyId, policyId, policyNumberKey }` index (created by `autoIndex`).
 * The writers set the key; this fills it in on the rows written before.
 *
 * The key is the lookup's own rule — upper-case, letters and digits only —
 * with no minimum length: a report line's number is matched whatever its
 * length. A number with no letters or digits gets `''`, which no lookup asks
 * for (it could never match one anyway). Rows that name their policy are
 * found by `policyId` and are left alone.
 *
 * Until this has run, a keyless row is still read on every lookup (the query
 * also matches `null`), so it is a speed-up, never a correctness change.
 *
 * Idempotent: only policy-less rows without a string key are touched, so a
 * re-run finds nothing to do.
 *
 * ⚠ Copied in, not imported (`@sfa/shared` `policyNumberKey`): no TypeScript
 * build is in this path, and an applied migration must keep doing in a year
 * what it did today.
 */

/** Writes per round trip. */
const BATCH = 500;

function policyNumberKey(raw) {
  if (typeof raw !== 'string') return '';
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

module.exports = {
  /**
   * @param {import('mongodb').Db} db
   * @returns {Promise<void>}
   */
  async up(db) {
    const chargebacks = db.collection('chargebacks');
    const cursor = chargebacks.find(
      {
        policyId: null,
        policyNumberKey: { $not: { $type: 'string' } },
      },
      { projection: { policyNumber: 1 } },
    );

    let writes = [];
    let keyed = 0;
    for await (const row of cursor) {
      writes.push({
        updateOne: {
          filter: {
            _id: row._id,
            policyNumberKey: { $not: { $type: 'string' } },
          },
          update: {
            $set: { policyNumberKey: policyNumberKey(row.policyNumber) },
          },
        },
      });
      if (writes.length >= BATCH) {
        keyed += (await chargebacks.bulkWrite(writes, { ordered: false }))
          .modifiedCount;
        writes = [];
      }
    }
    if (writes.length) {
      keyed += (await chargebacks.bulkWrite(writes, { ordered: false }))
        .modifiedCount;
    }
    console.log(`chargeback_number_keys: keyed ${keyed} chargebacks`);
  },

  /**
   * Removes the key from policy-less rows. Harmless: the lookup reads a
   * keyless row whatever its number, so nothing is charged twice — the
   * writers simply key new rows again.
   *
   * @param {import('mongodb').Db} db
   * @returns {Promise<void>}
   */
  async down(db) {
    await db
      .collection('chargebacks')
      .updateMany(
        { policyId: null, policyNumberKey: { $exists: true } },
        { $unset: { policyNumberKey: '' } },
      );
  },
};
