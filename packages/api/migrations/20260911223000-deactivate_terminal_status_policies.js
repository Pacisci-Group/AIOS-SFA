/**
 * Bring `Policy.active` in line with a terminal `policyStatus`.
 *
 * ## What was wrong
 *
 * `policyStatus` is the human-facing label; `active` is the flag every count,
 * total and renewal scan actually reads. Nothing kept them in step:
 * `PATCH /policies/:id` set the label and left the flag alone, so a policy could
 * read "Cancelled" on the household card while still counting towards the
 * household's active-policy total and being scheduled for renewal outreach —
 * calls to a client about a policy they no longer hold.
 *
 * `PoliciesService.applyUpdate` now moves the flag with the status
 * (`policyActiveForStatus`), but that only fixes edits made from here on. This
 * is the one pass over what is already stored.
 *
 * ## What this does
 *
 * Deactivates every policy whose status is terminal — `Cancelled`, `Lapsed`,
 * `Cancel Rewrite`, `Company Transfer`, or the SmartSuite codes for the first
 * two — and nothing else.
 *
 * ## ⚠ Deliberately one-directional
 *
 * The mirror-image inconsistency also exists and is **left alone**: policies
 * whose status reads `Active` while `active` is false (180 of them in the
 * development database, and the count will differ in production). Flipping
 * those on would add them back to the active book and start renewal outreach to
 * real clients, on the strength of a label nobody has verified — several are
 * likely retired policies whose status was simply never updated. That is a
 * data-quality question for the agency, not a guess for a migration. Deactivating
 * a policy the agency has already marked terminal can only ever *narrow* the
 * active book, which is why this direction is safe and that one is not.
 *
 * Idempotent: it only matches rows that are still `active: true`, so a re-run
 * after a partial failure matches nothing it already fixed.
 */

/**
 * Every stored spelling of a terminal status.
 *
 * Labels plus the two documented SmartSuite codes (`hLpfg` = Cancelled,
 * `uUVZd` = Lapsed). The codes matter: the import left thousands of rows holding
 * one rather than a word, and matching only labels would miss exactly the
 * migrated policies this is for.
 *
 * The uncatalogued codes `1943j` / `4krtk` are **not** here. Nobody has checked
 * what they mean at source, and retiring a policy on a guess is the error this
 * migration exists to avoid making in the other direction.
 */
const TERMINAL_STATUSES = [
  'Cancelled',
  'Lapsed',
  'Cancel Rewrite',
  'Company Transfer',
  'hLpfg',
  'uUVZd',
];

/** Case-insensitive exact match on a trimmed status, as a Mongo `$in`. */
function statusPatterns() {
  return TERMINAL_STATUSES.map(
    (status) =>
      new RegExp(`^\\s*${status.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i'),
  );
}

module.exports = {
  /**
   * @param {import('mongodb').Db} db
   * @returns {Promise<void>}
   */
  async up(db) {
    const filter = {
      active: true,
      policyStatus: { $in: statusPatterns() },
    };

    const affected = await db.collection('policies').countDocuments(filter);
    if (!affected) {
      console.log(
        '[deactivate-terminal-status-policies] nothing to do — no active policy holds a terminal status.',
      );
      return;
    }

    const result = await db
      .collection('policies')
      .updateMany(filter, { $set: { active: false } });

    console.log(
      `[deactivate-terminal-status-policies] deactivated ${result.modifiedCount} of ${affected} policies ` +
        'whose status was already terminal. They no longer count towards their household’s active ' +
        'total and will not be scheduled for renewal outreach.',
    );
  },

  /**
   * @returns {Promise<void>}
   */
  async down() {
    /*
     * Deliberately a no-op, and this is the honest answer rather than a missing
     * one.
     *
     * `up` collapses information: after it runs, a policy that was wrongly
     * `active: true` with a `Cancelled` status is indistinguishable from one
     * that was always correctly inactive. Reactivating everything with a
     * terminal status would therefore not restore the previous state — it would
     * invent a new, worse one, putting cancelled policies back into the active
     * book and into renewal outreach.
     *
     * Rolling the code back without rolling this back is safe: the flag simply
     * stays correct while `PATCH` goes back to ignoring it.
     */
    console.log(
      '[deactivate-terminal-status-policies] down() is intentionally a no-op — see the note in this file.',
    );
  },
};
