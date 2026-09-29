/**
 * PAC-142 — a mailer campaign holds **several** vendor files.
 *
 * ## Why
 *
 * `mailerCampaigns.vendorFile` was one embedded file. A campaign now carries
 * `files: [...]` (same subdocument shape, each with its own `_id` so a client
 * can name one), plus two new fields the code reads on every campaign:
 *
 * - `newRowsFile` — the print CSV of only the rows the last commit *created*,
 *   written when an imported campaign is re-opened with more files. `null`
 *   until then.
 * - `firstImportedAt` — when the campaign first reached `imported`. This is
 *   the fact that locks its settings, allows Add records, refuses delete, and
 *   tells the commit to write `newRowsFile`. Stamped here from `finishedAt`
 *   for campaigns that had imported (or were later superseded); `finishedAt`
 *   itself cannot serve going forward because a failed run sets it too.
 *
 * ## Idempotent
 *
 * Filtered on `files: { $exists: false }`, so a retry from the top converts only
 * what the failed pass did not reach. The update re-checks the same filter, so
 * a document converted between the read and the write is left alone.
 *
 * ## Rolling back
 *
 * `down` moves `files[0]` back to `vendorFile` and drops the two new fields. It
 * refuses if any campaign has more than one file: there is no old shape for
 * that, and dropping files silently would lose the record of what was imported.
 */

const { ObjectId } = require('mongodb');

const COLLECTION = 'mailerCampaigns';

module.exports = {
  /**
   * @param {import('mongodb').Db} db
   * @returns {Promise<void>}
   */
  async up(db) {
    const campaigns = db.collection(COLLECTION);
    const cursor = campaigns.find(
      { files: { $exists: false } },
      {
        projection: {
          vendorFile: 1,
          status: 1,
          finishedAt: 1,
          updatedAt: 1,
          createdAt: 1,
        },
      },
    );

    let converted = 0;
    let withFile = 0;
    for await (const doc of cursor) {
      const files = doc.vendorFile
        ? [{ _id: new ObjectId(), ...doc.vendorFile }]
        : [];
      const hadImported =
        doc.status === 'imported' || doc.status === 'superseded';
      const firstImportedAt = hadImported
        ? (doc.finishedAt ?? doc.updatedAt ?? doc.createdAt ?? null)
        : null;

      const result = await campaigns.updateOne(
        { _id: doc._id, files: { $exists: false } },
        {
          $set: { files, newRowsFile: null, firstImportedAt },
          $unset: { vendorFile: '' },
        },
      );
      if (result.modifiedCount > 0) {
        converted += 1;
        if (files.length > 0) withFile += 1;
      }
    }

    console.log(
      `[campaign-files-array] converted ${converted} campaign(s) (${withFile} with a vendor file)`,
    );
  },

  /**
   * @param {import('mongodb').Db} db
   * @returns {Promise<void>}
   */
  async down(db) {
    const campaigns = db.collection(COLLECTION);

    const several = await campaigns.countDocuments({
      'files.1': { $exists: true },
    });
    if (several > 0) {
      throw new Error(
        `campaign_files_array: refusing to roll back — ${several} campaign(s) hold more than one file, ` +
          'and the old shape has room for exactly one. Nothing was changed.',
      );
    }

    const cursor = campaigns.find(
      { files: { $exists: true } },
      { projection: { files: 1 } },
    );
    let restored = 0;
    for await (const doc of cursor) {
      const first = Array.isArray(doc.files) ? doc.files[0] : undefined;
      let vendorFile = null;
      if (first) {
        const { _id: _dropped, ...rest } = first;
        void _dropped;
        vendorFile = rest;
      }
      await campaigns.updateOne(
        { _id: doc._id },
        {
          $set: { vendorFile },
          $unset: { files: '', newRowsFile: '', firstImportedAt: '' },
        },
      );
      restored += 1;
    }
    console.log(`[campaign-files-array] restored ${restored} campaign(s)`);
  },
};
