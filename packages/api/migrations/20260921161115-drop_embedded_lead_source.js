/**
 * PAC-135 — drop the embedded `leadSource: { code, label }` from `leads` and
 * `deals`. The follow-up `20260921133113-lead_sources_backfill` promised.
 *
 * ## Why
 *
 * That migration pointed every lead and deal at a `leadSources` row
 * (`leadSourceId`) and deliberately left the old embedded copy in place. Nothing
 * has read or written it since; this removes it, and the schema props with it.
 *
 * ## It ships in the same release as the backfill, on purpose
 *
 * The original plan was to wait a release. Both now reach production together:
 * migrations apply in filename order at startup, so the backfill runs, then
 * this — and the check below is what makes that safe rather than hopeful. It
 * refuses to drop anything unless the backfill demonstrably finished.
 *
 * ## Check before destroying (README rule 4)
 *
 * A record whose embedded label names a real source but which has **no**
 * `leadSourceId` is one the backfill missed, and the embedded copy is then the
 * only record of where that lead came from. If even one exists, this throws and
 * changes nothing. `Unknown`, `Test` and an empty label are not sources — they
 * never got an id, by design — so they do not count.
 *
 * ⚠ If this throws on a database where the backfill ran long ago, the likely
 * cause is a lead whose source a user **cleared** afterwards: that unsets
 * `leadSourceId` and leaves the stale embedded label behind. That is a decision,
 * not a missed record — confirm it, `$unset` `leadSource` on those rows by hand,
 * and the next boot proceeds. It cannot happen when both migrations apply in
 * one boot, which is how this ships.
 *
 * ## What is actually lost
 *
 * Only the raw SmartSuite **code** (`WCO7l`, `Mail`, …). The label is the
 * `leadSources` row's name, reachable through `leadSourceId`. Nothing has read
 * the code since PAC-135 — and it was never a usable key: the same source sat
 * under a different code on every SmartSuite table.
 *
 * ## Rolling back still works
 *
 * `down` rebuilds `{ code: null, label: <the row's name> }` from
 * `leadSourceId` — an **equivalent**, not an identity, for the reason above.
 * `20260921133113`'s own `down` then runs as written, so the pair can still be
 * unwound in order. A record with no `leadSourceId` gets nothing back, which is
 * what it meant: the old code rendered a missing source as "Unknown".
 *
 * ## Idempotent
 *
 * `$unset` of an absent field is a no-op, and the check passes trivially once
 * the field is gone. Safe to retry from the top.
 *
 * ⚠ The placeholder rule is **copied in, not imported** — see the note on the
 * backfill migration. Keep it in step with `isLeadSourcePlaceholder` by
 * intention.
 */

/** Collections that carried the embedded `leadSource`. */
const COLLECTIONS = ['leads', 'deals'];

/** Copied from `leadSourceSlug` (`@sfa/shared`). */
function slugOf(name) {
  return String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Copied from `isLeadSourcePlaceholder` (`@sfa/shared`). */
function isPlaceholder(label) {
  const slug = slugOf(label);
  return slug === '' || slug === 'unknown' || slug === 'test';
}

module.exports = {
  /**
   * @param {import('mongodb').Db} db
   * @returns {Promise<void>}
   */
  async up(db) {
    // 1. Refuse to destroy the only copy of anything.
    const stranded = [];
    for (const name of COLLECTIONS) {
      const groups = await db
        .collection(name)
        .aggregate([
          {
            $match: {
              leadSourceId: { $exists: false },
              'leadSource.label': { $type: 'string' },
            },
          },
          { $group: { _id: '$leadSource.label', count: { $sum: 1 } } },
        ])
        .toArray();
      for (const group of groups) {
        if (!isPlaceholder(group._id)) {
          stranded.push(`${name}: "${group._id}" ×${group.count}`);
        }
      }
    }

    if (stranded.length > 0) {
      throw new Error(
        'drop_embedded_lead_source: refusing to drop `leadSource` — these records ' +
          'name a real lead source but have no `leadSourceId`, so the embedded copy ' +
          `is the only record of it:\n  ${stranded.join('\n  ')}\n` +
          'Either the `lead_sources_backfill` migration missed them, or a user ' +
          'cleared the source after it ran. See this file\'s header. Nothing was changed.',
      );
    }

    // 2. Drop it.
    for (const name of COLLECTIONS) {
      const result = await db
        .collection(name)
        .updateMany(
          { leadSource: { $exists: true } },
          { $unset: { leadSource: '' } },
        );
      console.log(
        `[drop-embedded-lead-source] ${name}: removed from ${result.modifiedCount} record(s)`,
      );
    }
  },

  /**
   * Rebuild the embedded shape from `leadSourceId`. An equivalent, not an
   * identity: the original SmartSuite `code` is gone — see the header.
   *
   * @param {import('mongodb').Db} db
   * @returns {Promise<void>}
   */
  async down(db) {
    const rows = await db
      .collection('leadSources')
      .find({}, { projection: { name: 1 } })
      .toArray();

    let restored = 0;
    for (const name of COLLECTIONS) {
      const collection = db.collection(name);
      for (const row of rows) {
        const result = await collection.updateMany(
          { leadSourceId: row._id, leadSource: { $exists: false } },
          { $set: { leadSource: { code: null, label: row.name } } },
        );
        restored += result.modifiedCount;
      }
    }
    console.log(
      `[drop-embedded-lead-source] restored an equivalent on ${restored} record(s)`,
    );
  },
};
