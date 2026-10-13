/**
 * PAC-159 — business dates become instants bucketed at read time.
 *
 * ## Why
 *
 * `deals.soldDateYmd` and `quoteRecaps.quoteDateYmd` were `YYYYMMDD` integers
 * stored beside the real `soldDate` / `quoteDate` so the scorecards could run
 * an integer range instead of per-row timezone maths. They were written once,
 * on the calendar in force at the time, and never moved; the instants beside
 * them meanwhile sat at **UTC midnight** for every day-only entry (the Sold
 * form, every row the SmartSuite import wrote), which a US calendar reads as
 * the evening before. Every reader now cuts its window on the agency's
 * calendar once, in Node, and matches the instant — so the instants have to
 * mean what the integers meant, and the integers can go.
 *
 * ## What it does, in order
 *
 * 1. **Re-stamps every day-only business date** at that day's first instant
 *    in its agency's `timezone`. A day-only value is one at exact UTC midnight
 *    (`parseFormDate`'s and the import's signature). For a deal or recap the
 *    day is the stored **integer** when there is one — SmartSuite's own
 *    `sold_date_ymd` column was copied first, and it is what every scorecard
 *    has reported — and the UTC parts otherwise; a lead has no integer, so its
 *    `createdDate` uses the UTC parts, and a `lastActivityAt` that still equals
 *    the old `createdDate` (the import set both from one value) moves with it.
 *    The `sold` / `quoted` / `lead_created` activity rows mirror those dates
 *    and are re-stamped the same way. Rows not at UTC midnight are real
 *    instants (app-written quotes and leads) and are left alone.
 * 2. **Creates the `Date` indexes** the readers now use, named the way
 *    Mongoose names them (see `20260910123159-queue-sort-indexes.js`), so
 *    `autoIndex` agrees whichever runs first.
 * 3. **Drops every index whose key includes an integer field**, discovered by
 *    key pattern rather than by name — which indexes a collection carries
 *    differs per environment. Only after step 2, so there is never a window
 *    with no usable index.
 * 4. **`$unset`s both fields** on every document.
 *
 * ## Check before destroying (README rule 4)
 *
 * Before step 4 the migration counts the deals and recaps whose integer
 * disagrees with the UTC day of their instant and logs the count. Nothing is
 * refused — the integer is the value chosen in step 1, so no information is
 * lost — but the number is what to compare the dashboards against on the
 * rehearsal dump: those rows file on the integer's day, as they always did.
 *
 * ## Idempotent
 *
 * Step 1 matches nothing on a second run (a re-stamped value is no longer at
 * UTC midnight), except for an agency whose zone *is* UTC, where the rewrite
 * is the identity. `createIndex` with an identical definition, `dropIndex`
 * of an absent index and `$unset` of an absent field are all no-ops.
 *
 * ## Deploying to an existing database
 *
 * Stop the API **and the worker** first: old worker code reads the integers,
 * and the window between step 4 and the new build serving would leave its
 * exports empty. Rehearse on the local prod dump, never on production.
 *
 * ## No `down`
 *
 * The integers are reconstructible from the re-stamped instants, but the
 * instants are not reconstructible from the integers: a real app-written
 * instant and a re-stamped day-only one are indistinguishable afterwards. A
 * roll-back would be guessing, so `down` throws.
 *
 * ⚠ `zonedDayStart` is **copied in**, not imported — no TypeScript build is
 * in this path. Keep it in step with `performance/performance.range.ts` by
 * intention; the unit spec there is the contract.
 */

const DAY_MS = 86_400_000;

/** No zone is further than this from UTC: Pacific/Kiritimati is UTC+14. */
const MAX_AHEAD_OF_UTC_MS = 15 * 3_600_000;
/** …and Etc/GMT+12 / Baker Island is UTC−12. */
const MAX_BEHIND_UTC_MS = 13 * 3_600_000;

/** `{ year, month (1-12), day }` of an instant in `timeZone`. Copied from `zonedDate`. */
function zonedDate(at, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const get = (type) =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  return { year: get('year'), month: get('month'), day: get('day') };
}

function toYmd(date) {
  return date.year * 10_000 + date.month * 100 + date.day;
}

/** The `{year, month, day}` behind a `YYYYMMDD` integer. Copied from `fromYmd`. */
function fromYmd(ymd) {
  return {
    year: Math.floor(ymd / 10_000),
    month: Math.floor(ymd / 100) % 100,
    day: ymd % 100,
  };
}

/** The calendar day a UTC-midnight instant names. */
function utcDay(date) {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

/**
 * The UTC instant at which `date` begins in `timeZone`. Copied verbatim from
 * `zonedDayStart` in `performance/performance.range.ts` — a binary search,
 * exact for half-hour zones and for a DST change that falls on midnight.
 */
function zonedDayStart(date, timeZone) {
  const ymd = toYmd(date);
  const midnightUtc = Date.UTC(date.year, date.month - 1, date.day);
  let lo = midnightUtc - MAX_AHEAD_OF_UTC_MS;
  let hi = midnightUtc + MAX_BEHIND_UTC_MS;
  while (hi - lo > 1) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (toYmd(zonedDate(new Date(mid), timeZone)) >= ymd) {
      hi = mid;
    } else {
      lo = mid;
    }
  }
  return new Date(hi);
}

/** A `YYYYMMDD` integer is plausible when it names a real calendar day. */
function isPlausibleYmd(value) {
  if (!Number.isInteger(value)) return false;
  const { year, month, day } = fromYmd(value);
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1) {
    return false;
  }
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCMonth() + 1 === month && probe.getUTCDate() === day;
}

/** Exactly UTC midnight — a day-only value, as the old writers stored it. */
const AT_UTC_MIDNIGHT = (field) => ({
  [field]: { $type: 'date' },
  $expr: { $eq: [{ $mod: [{ $toLong: `$${field}` }, DAY_MS] }, 0] },
});

/** Mongoose's default index name: `field_direction`, joined with `_`. */
function indexName(keys) {
  return Object.entries(keys)
    .map(([field, direction]) => `${field}_${direction}`)
    .join('_');
}

const NEW_INDEXES = {
  deals: [
    { agencyId: 1, soldDate: -1 },
    { agencyId: 1, businessType: 1, soldDate: -1 },
    { agencyId: 1, quoteRecapId: 1 },
  ],
  quoteRecaps: [{ agencyId: 1, quoteDate: -1 }],
};

const OLD_FIELDS = {
  deals: 'soldDateYmd',
  quoteRecaps: 'quoteDateYmd',
};

/** Activity rows whose `occurredAt` mirrors a business date. */
const MIRRORED_ACTIVITY_TYPES = ['sold', 'quoted', 'lead_created'];

const BATCH = 1000;

async function flush(collection, writes) {
  if (!writes.length) return 0;
  const result = await collection.bulkWrite(writes.splice(0), {
    ordered: false,
  });
  return result.modifiedCount;
}

/**
 * Re-stamp `field` on every day-only row of `collection` for one agency.
 * `dayOf(row)` names the calendar day to anchor; `extra(row, instant)` may add
 * more `$set` fields. Returns `{ moved, disagreed }`.
 */
async function restamp(db, name, agencyId, timeZone, field, dayOf, extra) {
  const collection = db.collection(name);
  const cursor = collection.find(
    { agencyId, ...AT_UTC_MIDNIGHT(field) },
    { projection: { [field]: 1, soldDateYmd: 1, quoteDateYmd: 1, lastActivityAt: 1, createdDate: 1 } },
  );

  const writes = [];
  let moved = 0;
  let disagreed = 0;
  for await (const row of cursor) {
    const stored = row[field];
    const day = dayOf(row);
    if (toYmd(day) !== toYmd(utcDay(stored))) disagreed += 1;
    const instant = zonedDayStart(day, timeZone);
    writes.push({
      updateOne: {
        filter: { _id: row._id, [field]: stored },
        update: { $set: { [field]: instant, ...(extra ? extra(row, instant) : {}) } },
      },
    });
    if (writes.length >= BATCH) moved += await flush(collection, writes);
  }
  moved += await flush(collection, writes);
  return { moved, disagreed };
}

module.exports = {
  /**
   * @param {import('mongodb').Db} db
   * @returns {Promise<void>}
   */
  async up(db) {
    const agencies = await db
      .collection('agencies')
      .find({}, { projection: { timezone: 1, slug: 1 } })
      .toArray();

    // ── 1. Re-stamp day-only business dates, per agency ────────────────────
    const totals = {};
    const bump = (key, by) => {
      totals[key] = (totals[key] ?? 0) + by;
    };

    for (const agency of agencies) {
      const timeZone = agency.timezone;
      if (typeof timeZone !== 'string' || !timeZone) {
        // `agency_timezone_backfill` guarantees the field; a row without it is
        // a mistake worth stopping on rather than silently filing in UTC.
        throw new Error(
          `business_dates_agency_midnight: agency ${String(agency._id)} (${agency.slug ?? '?'}) has no timezone.`,
        );
      }
      // `agencyId` is a string on every tenant collection (ObjectId only on `users`).
      const agencyId = String(agency._id);

      const deals = await restamp(
        db,
        'deals',
        agencyId,
        timeZone,
        'soldDate',
        (row) =>
          isPlausibleYmd(row.soldDateYmd)
            ? fromYmd(row.soldDateYmd)
            : utcDay(row.soldDate),
      );
      bump('deals', deals.moved);
      bump('dealsDisagreed', deals.disagreed);

      const recaps = await restamp(
        db,
        'quoteRecaps',
        agencyId,
        timeZone,
        'quoteDate',
        (row) =>
          isPlausibleYmd(row.quoteDateYmd)
            ? fromYmd(row.quoteDateYmd)
            : utcDay(row.quoteDate),
      );
      bump('quoteRecaps', recaps.moved);
      bump('quoteRecapsDisagreed', recaps.disagreed);

      const leads = await restamp(
        db,
        'leads',
        agencyId,
        timeZone,
        'createdDate',
        (row) => utcDay(row.createdDate),
        (row, instant) =>
          row.lastActivityAt instanceof Date &&
          row.lastActivityAt.getTime() === row.createdDate.getTime()
            ? { lastActivityAt: instant }
            : {},
      );
      bump('leads', leads.moved);

      // Activity rows: same rule, scoped to the types that mirror a business
      // date. Other types carry real instants and are not day-only.
      const activities = db.collection('activities');
      const cursor = activities.find(
        {
          agencyId,
          type: { $in: MIRRORED_ACTIVITY_TYPES },
          ...AT_UTC_MIDNIGHT('occurredAt'),
        },
        { projection: { occurredAt: 1 } },
      );
      const writes = [];
      let movedActivities = 0;
      for await (const row of cursor) {
        writes.push({
          updateOne: {
            filter: { _id: row._id, occurredAt: row.occurredAt },
            update: {
              $set: {
                occurredAt: zonedDayStart(utcDay(row.occurredAt), timeZone),
              },
            },
          },
        });
        if (writes.length >= BATCH) {
          movedActivities += await flush(activities, writes);
        }
      }
      movedActivities += await flush(activities, writes);
      bump('activities', movedActivities);

      console.log(
        `[business-dates] ${agency.slug ?? agencyId} (${timeZone}): ` +
          `deals ${deals.moved}, quoteRecaps ${recaps.moved}, leads ${leads.moved}, ` +
          `activities ${movedActivities} re-stamped at agency-local midnight`,
      );
    }

    if (totals.dealsDisagreed || totals.quoteRecapsDisagreed) {
      console.log(
        `[business-dates] ${totals.dealsDisagreed ?? 0} deal(s) and ` +
          `${totals.quoteRecapsDisagreed ?? 0} recap(s) carried an integer that ` +
          'named a different day than the UTC parts of their instant; the ' +
          'integer — the day every scorecard reported — won.',
      );
    }

    // Orphans: rows whose agency no longer exists cannot be anchored.
    for (const [name, field] of Object.entries({
      deals: 'soldDate',
      quoteRecaps: 'quoteDate',
      leads: 'createdDate',
    })) {
      const stranded = await db
        .collection(name)
        .countDocuments({
          agencyId: { $nin: agencies.map((agency) => String(agency._id)) },
          ...AT_UTC_MIDNIGHT(field),
        });
      if (stranded) {
        console.log(
          `[business-dates] ${name}: ${stranded} row(s) belong to no agency and keep their UTC-midnight ${field}.`,
        );
      }
    }

    // ── 2. The Date indexes the readers now use ────────────────────────────
    for (const [name, keySets] of Object.entries(NEW_INDEXES)) {
      const collection = db.collection(name);
      for (const keys of keySets) {
        await collection.createIndex(keys, {
          name: indexName(keys),
          background: true,
        });
      }
    }

    // ── 3. Drop every index that keys on an integer field ──────────────────
    for (const [name, field] of Object.entries(OLD_FIELDS)) {
      const collection = db.collection(name);
      const indexes = await collection.indexes().catch((error) => {
        // NamespaceNotFound (26): a fresh database with no such collection yet.
        if (error?.code === 26) return [];
        throw error;
      });
      for (const index of indexes) {
        if (Object.prototype.hasOwnProperty.call(index.key, field)) {
          await collection.dropIndex(index.name);
          console.log(`[business-dates] ${name}: dropped index ${index.name}`);
        }
      }
    }

    // ── 4. Remove the fields ───────────────────────────────────────────────
    for (const [name, field] of Object.entries(OLD_FIELDS)) {
      const result = await db
        .collection(name)
        .updateMany({ [field]: { $exists: true } }, { $unset: { [field]: '' } });
      console.log(
        `[business-dates] ${name}: removed ${field} from ${result.modifiedCount} record(s)`,
      );
    }
  },

  async down() {
    throw new Error(
      'business_dates_agency_midnight cannot be rolled back: a re-stamped ' +
        'day-only instant and a real one are indistinguishable afterwards, so ' +
        'the original UTC-midnight values cannot be reconstructed. Restore from ' +
        'the pre-deploy backup instead.',
    );
  },
};
