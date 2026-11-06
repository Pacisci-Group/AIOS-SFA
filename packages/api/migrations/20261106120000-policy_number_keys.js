/**
 * PAC-180 — every policy that has a usable number carries `policyNumberKey`.
 *
 * `policyNumberKey` is the indexed, normalised policy number (upper-case,
 * letters and digits only) that every lookup by number reads: the Sold
 * wizard's duplicate check, the client search, and now the chargeback report
 * import, which matches each report line to a policy by it. The write paths
 * set it (`normalizePolicyNumber`), but the demo seed's sale policies were
 * written without it, and a lookup by number simply could not find them.
 *
 * This fills the key in wherever a policy has a number and no key, by the
 * writers' own rule: the key only when it is at least 4 characters
 * (`MIN_POLICY_NUMBER_KEY_LENGTH`). A shorter number (a migrated `01`) stays
 * keyless on purpose, exactly as a write would leave it.
 *
 * Idempotent: only policies without a string key are touched, so a re-run
 * finds nothing to do.
 *
 * ⚠ Copied in, not imported (`@sfa/shared` `policyNumberKey` /
 * `normalizePolicyNumber`): no TypeScript build is in this path, and an
 * applied migration must keep doing in a year what it did today.
 */

/** `MIN_POLICY_NUMBER_KEY_LENGTH` in `@sfa/shared` `domain/policy-number.ts`. */
const MIN_KEY_LENGTH = 4;

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
    const policies = db.collection('policies');
    const cursor = policies.find(
      {
        policyNumberKey: { $not: { $type: 'string' } },
        policyNumber: { $type: 'string', $ne: '' },
      },
      { projection: { policyNumber: 1 } },
    );

    let writes = [];
    let keyed = 0;
    for await (const policy of cursor) {
      const key = policyNumberKey(policy.policyNumber);
      if (key.length < MIN_KEY_LENGTH) continue;
      writes.push({
        updateOne: {
          filter: {
            _id: policy._id,
            policyNumberKey: { $not: { $type: 'string' } },
          },
          update: { $set: { policyNumberKey: key } },
        },
      });
      if (writes.length >= BATCH) {
        keyed += (await policies.bulkWrite(writes, { ordered: false }))
          .modifiedCount;
        writes = [];
      }
    }
    if (writes.length) {
      keyed += (await policies.bulkWrite(writes, { ordered: false }))
        .modifiedCount;
    }
    console.log(`policy_number_keys: keyed ${keyed} policies`);
  },

  /**
   * Nothing to undo safely: after this ran, a key on a policy cannot be told
   * apart from one a writer set, and removing writers' keys would break the
   * duplicate check. A key that should not be there is harmless.
   *
   * @returns {Promise<void>}
   */
  async down() {
    throw new Error(
      'policy_number_keys is not reversible: backfilled keys are indistinguishable from written ones.',
    );
  },
};
