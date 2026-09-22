/**
 * PAC-135 — lead sources become a collection, and every lead and deal points at
 * a row in it (`leadSourceId`) instead of carrying its own `{ code, label }`.
 *
 * ## Why
 *
 * The embedded copy made a source un-renameable (every record held its own
 * label), keyed it on SmartSuite choice codes that differ per table (`Mail` on
 * 380 leads and `WCO7l` on 14 are the same source), and tied the pickers to a
 * hard-coded list that production had already outgrown — Web, Walk-In, Other and
 * Live Call Transfer are on real leads and in no dropdown.
 *
 * ## What it does
 *
 * 1. Upserts the platform rows (`agencyId: null`). The core seed creates the
 *    same rows for a fresh database; an existing one gets them here, because the
 *    records below cannot be pointed at rows that do not exist yet.
 * 2. Per agency, every distinct stored label that is not a platform source
 *    becomes that agency's **own** row — Waterstone, JYA, Stride and the rest of
 *    one agency's vendors. Matched by slug, so `Walk-In` and `walk in` are one.
 * 3. Sets `leadSourceId` on each lead and deal from its label.
 *
 * `Unknown`, `Test` and an empty label are not sources — the first is the
 * importer's placeholder, `Test` records are already `isTestRecord` — so those
 * records are left with no `leadSourceId`, which is what "No source" means.
 *
 * ## The embedded `leadSource` is deliberately left in place
 *
 * Nothing reads or writes it after this deploy. It stays for one release as the
 * safety net that makes `down` possible, and a follow-up migration drops it.
 *
 * ## Idempotent
 *
 * Rows are upserted on `{ agencyId, slug }` with `$setOnInsert` only, and records
 * are matched on `leadSourceId: { $exists: false }` — a re-run finds nothing left
 * to do. Safe to retry from the top, which is what a half-failed run leaves.
 *
 * ⚠ The platform list and the slug rule are **copied in, not imported**: no
 * TypeScript build is in this path, and an applied migration must keep doing in
 * a year what it did today rather than following `lead-source.ts` wherever that
 * goes next. Keep them in step *by intention*.
 */

/** Copied from `PLATFORM_LEAD_SOURCES` (`@sfa/shared`). */
const PLATFORM_LEAD_SOURCES = [
  'Mailer',
  'Book of Business',
  'Customer Referral',
  'Facebook',
  'Google',
  'Web',
  'Walk-In',
  'Other',
];

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

/** Find-or-create one row; returns its `_id`. */
async function upsertSource(sources, agencyId, name, displayOrder) {
  const slug = slugOf(name);
  const now = new Date();
  const onInsert = {
    agencyId,
    slug,
    name: String(name).trim(),
    active: true,
    createdAt: now,
    updatedAt: now,
  };
  if (displayOrder !== undefined) onInsert.displayOrder = displayOrder;

  const row = await sources.findOneAndUpdate(
    { agencyId, slug },
    { $setOnInsert: onInsert },
    { upsert: true, returnDocument: 'after', projection: { _id: 1 } },
  );
  // Driver 6 returns the document itself; driver 4/5 wrap it in `{ value }`.
  return (row && row.value ? row.value : row)._id;
}

module.exports = {
  /**
   * @param {import('mongodb').Db} db
   * @returns {Promise<void>}
   */
  async up(db) {
    const sources = db.collection('leadSources');

    // 1. Platform rows, keyed by slug for the lookups below.
    const platform = new Map();
    for (const [index, name] of PLATFORM_LEAD_SOURCES.entries()) {
      // Copied from `platformLeadSourceOrder`: `Other` is pinned last.
      const order = slugOf(name) === 'other' ? 1000 : index;
      platform.set(slugOf(name), await upsertSource(sources, null, name, order));
    }

    // 2 + 3. Per agency, per distinct label still waiting for an id.
    const pending = { $exists: false };
    const labelsByAgency = new Map();
    for (const name of COLLECTIONS) {
      const rows = await db
        .collection(name)
        .aggregate([
          { $match: { leadSourceId: pending, 'leadSource.label': { $type: 'string' } } },
          { $group: { _id: { agencyId: '$agencyId', label: '$leadSource.label' } } },
        ])
        .toArray();
      for (const { _id } of rows) {
        if (!_id.agencyId || isPlaceholder(_id.label)) continue;
        if (!labelsByAgency.has(_id.agencyId)) {
          labelsByAgency.set(_id.agencyId, new Set());
        }
        labelsByAgency.get(_id.agencyId).add(_id.label);
      }
    }

    let agencyRows = 0;
    const linked = { leads: 0, deals: 0 };
    for (const [agencyId, labels] of labelsByAgency) {
      for (const label of labels) {
        const slug = slugOf(label);
        let id = platform.get(slug);
        if (!id) {
          id = await upsertSource(sources, agencyId, label, undefined);
          agencyRows += 1;
        }
        for (const name of COLLECTIONS) {
          const result = await db.collection(name).updateMany(
            { agencyId, 'leadSource.label': label, leadSourceId: pending },
            { $set: { leadSourceId: id } },
          );
          linked[name] += result.modifiedCount;
        }
      }
    }

    console.log(
      `[lead-sources] ${platform.size} platform row(s), ${agencyRows} agency row(s) ensured; ` +
        `linked ${linked.leads} lead(s) and ${linked.deals} deal(s)`,
    );

    // What is left is expected — report it so the number is known, never fix it.
    for (const name of COLLECTIONS) {
      const unset = await db
        .collection(name)
        .countDocuments({ leadSourceId: pending });
      console.log(
        `[lead-sources] ${name}: ${unset} record(s) have no lead source (Unknown / Test / never set)`,
      );
    }
  },

  /**
   * Back to the embedded shape. An **equivalent**, not an identity: a record
   * created after `up` never had a `{ code, label }`, so it gets
   * `{ code: null, label: <the row's name> }` — which is what the old code
   * rendered and filtered on. The `leadSources` rows are left alone; they are
   * harmless to old code and dropping them would lose any curation.
   *
   * @param {import('mongodb').Db} db
   * @returns {Promise<void>}
   */
  async down(db) {
    const rows = await db
      .collection('leadSources')
      .find({}, { projection: { name: 1 } })
      .toArray();

    let reverted = 0;
    for (const name of COLLECTIONS) {
      const collection = db.collection(name);
      for (const row of rows) {
        await collection.updateMany(
          { leadSourceId: row._id, 'leadSource.label': { $exists: false } },
          { $set: { leadSource: { code: null, label: row.name } } },
        );
      }
      const result = await collection.updateMany(
        { leadSourceId: { $exists: true } },
        { $unset: { leadSourceId: '' } },
      );
      reverted += result.modifiedCount;
    }
    console.log(`[lead-sources] reverted ${reverted} record(s)`);
  },
};
