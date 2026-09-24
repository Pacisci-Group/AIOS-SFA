/**
 * PAC-101 — `households.propertyAddress` / `mailingAddress` become a typed
 * sub-schema, and `addressKey` is backfilled onto every household that has one.
 *
 * ## Why
 *
 * Both fields were `@Prop({ type: Object })` and **three writers each used
 * their own key names**: lead intake `street/city/state/zip`, the demo seed
 * `line1/…`, and the SmartSuite migration the vendor's
 * `location_address/location_city/…` passed through verbatim. So
 * `{"propertyAddress.city": …}` matched only some rows, and the city the
 * Clients list renders had to be resolved in application code *after* the
 * fetch — which a Mongo query cannot do. That is why the Location column was
 * unsearchable, and it is the "model the domain, never the source system's
 * field type" rule in `AGENTS.md` §11.
 *
 * ## Why it must run before the new code serves a write
 *
 * Mongoose's `strict` (default true) does not reject an unknown key — it
 * **drops it**. Reads of a legacy-keyed document still work (`.lean()` skips
 * hydration; `$init` keeps paths with no schema entry), but an update carrying
 * `location_city` reduces to `$set: {propertyAddress: {}}`: a 200 that erases
 * the address. `run-migrations.ts` applies this from `main.ts` before
 * `NestFactory.create()`, so a deploy migrates itself with no such window.
 *
 * ## `location_address2` is recovered, not dropped
 *
 * The read-time coercion never looked at it, so apartment and unit lines on
 * migrated households were invisible to every consumer. They land in `street2`.
 * They are deliberately **not** folded into `street`: `addressKey` is
 * `"<street>|<zip>"`, so `"123 main st apt 4|74101"` and `"123 main st|74101"`
 * would become different keys for the same building — and the whole point of
 * that index being non-unique is that one building yields several households.
 *
 * ## Idempotent
 *
 * A re-run finds documents already in the canonical shape: the coalesce
 * resolves to the value that is already there and the `$unset` is a no-op. Safe
 * to retry from the top, which is what a half-failed run leaves behind.
 *
 * ⚠ The normalizers are **copied in, not imported**. These files run against
 * the raw driver with no TypeScript build in the path — but more importantly an
 * applied migration is immutable (README rule 1) and must keep doing in a year
 * exactly what it did today, rather than following `address-key.ts` wherever
 * that goes next. Keep them in step *by intention*.
 */

/** How many documents to read and write per round trip. */
const BATCH = 500;

/** The two address fields, in the order they are reported. */
const FIELDS = ['propertyAddress', 'mailingAddress'];

/**
 * Every key each of the three writers used, per canonical field.
 * First non-blank wins, in this order.
 */
const SOURCES = {
  street: ['street', 'line1', 'location_address'],
  street2: ['street2', 'line2', 'location_address2'],
  city: ['city', 'location_city'],
  state: ['state', 'location_state'],
  zip: ['zip', 'location_zip'],
};

/** Trimmed string, or undefined when there is nothing usable. */
function text(value) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * A stored address in the canonical shape, or `null` when nothing survives.
 *
 * ⚠ Trimming happens here rather than being left to the schema:
 * `@Prop({ trim: true })` is a write-time setter and is **not** retroactive, so
 * an untrimmed corpus would keep its whitespace and produce `addressKey`
 * mismatches against values written later.
 */
function canonical(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const out = {};
  for (const [field, keys] of Object.entries(SOURCES)) {
    for (const key of keys) {
      const value = text(raw[key]);
      if (value !== undefined) {
        out[field] = value;
        break;
      }
    }
  }
  return Object.keys(out).length ? out : null;
}

/** `"<street>|<zip>"`, lowercased. Null unless **both** are present. */
function addressKeyOf(address) {
  if (!address) return null;
  const street = text(address.street);
  const zip = text(address.zip);
  return street && zip
    ? `${street.toLowerCase()}|${zip.toLowerCase()}`
    : null;
}

/** True when the stored object already carries no legacy key and needs no trim. */
function alreadyCanonical(raw, rewritten) {
  if (!raw || typeof raw !== 'object') return rewritten === null;
  if (rewritten === null) return Object.keys(raw).length === 0;
  const before = Object.keys(raw).sort().join(',');
  const after = Object.keys(rewritten).sort().join(',');
  if (before !== after) return false;
  return Object.keys(rewritten).every((key) => raw[key] === rewritten[key]);
}

module.exports = {
  /**
   * @param {import('mongodb').Db} db
   * @returns {Promise<void>}
   */
  async up(db) {
    const households = db.collection('households');

    let scanned = 0;
    let rewritten = 0;
    let keyed = 0;
    let recoveredUnitLines = 0;
    const unresolvable = [];

    const cursor = households.find(
      {},
      {
        projection: {
          propertyAddress: 1,
          mailingAddress: 1,
          addressKey: 1,
          householdRef: 1,
        },
      },
    );

    let ops = [];
    const flush = async () => {
      if (!ops.length) return;
      await households.bulkWrite(ops, { ordered: false });
      ops = [];
    };

    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      scanned += 1;

      const set = {};
      const unset = {};
      let changed = false;

      for (const field of FIELDS) {
        const raw = doc[field];
        if (raw === undefined || raw === null) continue;

        const next = canonical(raw);
        if (next && next.street2) recoveredUnitLines += 1;

        // ⚠ The whole sub-document is replaced, never patched key by key.
        // `$set: {propertyAddress: {...}}` drops the legacy keys by itself, and
        // combining it with `$unset: {'propertyAddress.line1': ''}` is a hard
        // error — Mongo refuses two operators that touch the same path
        // ("would create a conflict at 'propertyAddress'"). Whole-object
        // replacement is also what makes a re-run after a partial failure
        // trivially correct: there is no half-written state to reconcile.
        if (!alreadyCanonical(raw, next)) {
          changed = true;
          if (next) set[field] = next;
          else unset[field] = '';
        }

        if (field === 'propertyAddress' && !next) {
          unresolvable.push(doc.householdRef || String(doc._id));
        }
      }

      // `addressKey` after the rewrite, never before — `street` may not exist
      // yet on a document that has only ever held `location_address`.
      const address = set.propertyAddress ?? canonical(doc.propertyAddress);
      const key = addressKeyOf(address);
      if (key && key !== doc.addressKey) {
        set.addressKey = key;
        keyed += 1;
        changed = true;
      }

      if (!changed) continue;

      const update = {};
      if (Object.keys(set).length) update.$set = set;
      if (Object.keys(unset).length) update.$unset = unset;
      ops.push({ updateOne: { filter: { _id: doc._id }, update } });
      rewritten += 1;
      if (ops.length >= BATCH) await flush();
    }
    await flush();

    console.log(
      `[household-address] scanned ${scanned}, rewrote ${rewritten}, ` +
        `stamped ${keyed} addressKey, recovered ${recoveredUnitLines} unit lines`,
    );
    if (unresolvable.length) {
      // Reported, never deleted: a household whose stored address resolves to
      // nothing had nothing usable in it to begin with, and losing the record
      // over that would be worse than an empty address.
      console.warn(
        `[household-address] ${unresolvable.length} household(s) had a ` +
          `propertyAddress with no usable part: ${unresolvable
            .slice(0, 20)
            .join(', ')}${unresolvable.length > 20 ? ', …' : ''}`,
      );
    }
  },

  /**
   * Map every address back to the SmartSuite `location_*` shape.
   *
   * ⚠ An **equivalent**, not an identity. Which of the three writers produced a
   * given document is not recoverable once the keys are canonical, so mapping
   * everything to one legacy shape is the only reversible choice — and it is a
   * safe one, because the old `normalizeStoredAddress` read `location_*` as its
   * third alias, so every pre-PAC-101 reader still works afterwards. `street2`
   * round-trips through `location_address2`.
   *
   * `addressKey` is deliberately left alone: it is additive, its index is
   * partial and non-unique, and unsetting it would also clear the keys lead
   * intake had been writing since long before this migration.
   */
  async down(db) {
    const households = db.collection('households');
    const BACK = {
      street: 'location_address',
      street2: 'location_address2',
      city: 'location_city',
      state: 'location_state',
      zip: 'location_zip',
    };

    let reverted = 0;
    const cursor = households.find(
      {},
      { projection: { propertyAddress: 1, mailingAddress: 1 } },
    );

    let ops = [];
    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      const set = {};

      for (const field of FIELDS) {
        const raw = doc[field];
        if (!raw || typeof raw !== 'object') continue;
        const legacy = {};
        for (const [from, to] of Object.entries(BACK)) {
          const value = text(raw[from]);
          if (value !== undefined) legacy[to] = value;
        }
        if (Object.keys(legacy).length) set[field] = legacy;
      }

      if (!Object.keys(set).length) continue;
      ops.push({ updateOne: { filter: { _id: doc._id }, update: { $set: set } } });
      reverted += 1;
      if (ops.length >= BATCH) {
        await households.bulkWrite(ops, { ordered: false });
        ops = [];
      }
    }
    if (ops.length) await households.bulkWrite(ops, { ordered: false });

    console.log(`[household-address] reverted ${reverted} household(s)`);
  },
};
