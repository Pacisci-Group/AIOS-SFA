/**
 * PAC-91 §1–§4, §9 — a contact holds **one** email and **one** phone, the
 * denormalised copies on `leads` and `households` go, and every contact gets
 * the identity keys the §9 uniqueness rule is built from.
 *
 * The schema mirrored SmartSuite's *field type* (`string[]` emails, `phone[]`
 * phones) instead of the domain. Legacy always read and wrote one of each,
 * every consumer in this repo read `[0]`, and the 2026-09-04 production export
 * has zero contacts with a second value. The arrays only ever grew because lead
 * intake `$addToSet`-ed a conflicting submission onto them.
 *
 * What this does, in one pass over `contacts` plus two `updateMany`s:
 *
 * 1. `contacts.emails` / `.phones` → `contacts.email` / `.phone`, taking the
 *    first non-blank value and **normalising** it. Rows with a second value are
 *    counted and logged rather than silently truncated.
 * 2. `contacts.nameKey` / `.dobKey` stamped on every row, so the identity
 *    indexes have something to index. (The indexes themselves are built by the
 *    *next* migration, which runs after `merge-duplicate-contacts.ts` and
 *    refuses to build over duplicates.)
 * 3. `leads.emails` / `.phones` unset — the lead reads its primary contact now.
 * 4. `households.primaryContactName` / `.primaryEmails` / `.primaryPhones`
 *    unset — the household reads `primaryContactId`.
 *
 * ⚠ **Why normalise here.** Contact matching, `ContactIdentityService` and the
 * merge script all compare *normalised* values, and every writer now stores
 * them normalised. Migrated rows hold raw SmartSuite strings — `(918) 808-2556`
 * — so leaving them raw would make every migrated contact invisible to all
 * three, and the identity indexes would enforce nothing for the 3,000 rows that
 * need them most.
 *
 * ⚠ **Why the normalisers are copied in below rather than imported.** These are
 * `.js` files run by migrate-mongo against the raw driver, with no TypeScript
 * build in the path — but more importantly, an applied migration is immutable
 * (README rule 1). It has to keep doing in a year exactly what it did today,
 * which means carrying its own copy of the rules rather than following
 * `intake.normalize.ts` wherever that goes next. Keep them in step *by
 * intention*, not by reference.
 *
 * Idempotent: it reads from the scalar when the array is already gone, and
 * `$unset` on a missing field is a no-op. Safe to retry from the top after a
 * failure part-way, which is what the changelog leaves you with.
 */

/** How many contacts to read and write per round trip. */
const BATCH = 500;

// ── The normalisers, mirroring `leads/intake/intake.normalize.ts` ────────────
// See the docblock: copied deliberately, not imported.

/** Lowercased + trimmed, or null when there is nothing usable. */
function normalizeEmail(raw) {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().toLowerCase();
  return value ? value : null;
}

/** Digits only — `(555) 123-4567`, `555.123.4567` and `+1 555…` all collapse. */
function normalizePhone(raw) {
  if (typeof raw !== 'string') return null;
  const digits = raw.replace(/\D/g, '');
  return digits ? digits : null;
}

/** Collapses internal whitespace and trims. */
function normalizeName(raw) {
  return typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
}

/** `"<first> <last>"` lowercased; null unless both halves are present. */
function nameKeyOf(firstName, lastName) {
  const first = normalizeName(firstName).toLowerCase();
  const last = normalizeName(lastName).toLowerCase();
  return first && last ? `${first} ${last}` : null;
}

/** `YYYY-MM-DD` in UTC — never the local date, which is a day off for half the book. */
function dobKeyOf(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

/** First non-blank string in an array, or the scalar it has already become. */
function firstValue(arrayValue, scalarValue) {
  if (Array.isArray(arrayValue)) {
    const found = arrayValue.find(
      (v) => typeof v === 'string' && v.trim() !== '',
    );
    if (found !== undefined) return found;
  }
  return typeof scalarValue === 'string' ? scalarValue : null;
}

module.exports = {
  /**
   * @param {import('mongodb').Db} db
   * @returns {Promise<void>}
   */
  async up(db) {
    const contacts = db.collection('contacts');

    let scanned = 0;
    let written = 0;
    let multiEmail = 0;
    let multiPhone = 0;

    const cursor = contacts.find(
      {},
      {
        projection: {
          emails: 1,
          phones: 1,
          email: 1,
          phone: 1,
          firstName: 1,
          lastName: 1,
          dateOfBirth: 1,
          nameKey: 1,
          dobKey: 1,
        },
      },
    );

    let ops = [];
    const flush = async () => {
      if (!ops.length) return;
      // `ordered: false` so one bad document cannot stop the rest of the batch.
      const result = await contacts.bulkWrite(ops, { ordered: false });
      written += result.modifiedCount ?? 0;
      ops = [];
    };

    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      scanned++;

      if (Array.isArray(doc.emails) && doc.emails.length > 1) multiEmail++;
      if (Array.isArray(doc.phones) && doc.phones.length > 1) multiPhone++;

      const email = normalizeEmail(firstValue(doc.emails, doc.email));
      const phone = normalizePhone(firstValue(doc.phones, doc.phone));
      const nameKey = nameKeyOf(doc.firstName, doc.lastName);
      const dobKey = dobKeyOf(doc.dateOfBirth);

      const $set = {};
      const $unset = { emails: '', phones: '' };
      // A field whose derived value is null is *removed*, not stored as null:
      // the partial indexes filter on `$type: 'string'`, so a null would be a
      // fourth state for every filter and query to reason about.
      for (const [field, value] of [
        ['email', email],
        ['phone', phone],
        ['nameKey', nameKey],
        ['dobKey', dobKey],
      ]) {
        if (value === null) $unset[field] = '';
        else $set[field] = value;
      }

      ops.push({
        updateOne: {
          filter: { _id: doc._id },
          update: Object.keys($set).length ? { $set, $unset } : { $unset },
        },
      });

      if (ops.length >= BATCH) await flush();
    }
    await flush();

    console.log(
      `[PAC-91] contacts: ${scanned} scanned, ${written} written ` +
        `(${multiEmail} had >1 email, ${multiPhone} had >1 phone — first kept)`,
    );

    // The denormalised copies. `$unset` matches only documents that still have
    // the field, so a re-run reports 0 rather than rewriting the collection.
    const leads = await db
      .collection('leads')
      .updateMany(
        { $or: [{ emails: { $exists: true } }, { phones: { $exists: true } }] },
        { $unset: { emails: '', phones: '' } },
      );
    console.log(
      `[PAC-91] leads: dropped the email/phone copy on ${leads.modifiedCount}`,
    );

    const households = await db.collection('households').updateMany(
      {
        $or: [
          { primaryContactName: { $exists: true } },
          { primaryEmails: { $exists: true } },
          { primaryPhones: { $exists: true } },
        ],
      },
      {
        $unset: {
          primaryContactName: '',
          primaryEmails: '',
          primaryPhones: '',
        },
      },
    );
    console.log(
      `[PAC-91] households: dropped the primary-contact copy on ${households.modifiedCount}`,
    );
  },

  /**
   * @returns {Promise<never>}
   */
  async down() {
    /*
     * Irreversible in the only sense that matters. Wrapping a scalar back into
     * a one-element array is trivial; restoring what was *dropped* is not — the
     * second email of any row that had one, the household copies, and the lead
     * copies are gone, and there is nowhere left to read them from. A `down`
     * that rebuilt the arrays would report success while silently returning
     * less data than it took.
     */
    throw new Error(
      'Irreversible: PAC-91 dropped the denormalised email/phone copies on ' +
        'leads and households, and any second value a contact carried. ' +
        'Restore from a backup rather than rolling this back.',
    );
  },
};
