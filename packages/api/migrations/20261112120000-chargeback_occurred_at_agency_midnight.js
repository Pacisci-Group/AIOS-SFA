/**
 * PAC-173 review — a chargeback's `occurredAt` is a business date.
 *
 * It is the day the clawback window was judged on: the replacement's sold
 * date for a Cancel Rewrite, the carrier's cancellation date for a
 * cancellation (PAC-173 PR 6). Both writers stored it at **UTC midnight** of
 * the day typed, which a US agency's calendar reads as the evening before —
 * so a monthly report bucketing chargebacks by `occurredAt` would put one
 * dated the 1st into the previous month. The writers now store the agency's
 * own midnight (`businessDateInstant`, PAC-159); this moves the rows already
 * written there too.
 *
 * Only rows written by the app (`reason` `cancel_rewrite` or `cancellation`)
 * and sitting at exactly UTC midnight are moved: a day-only value is the only
 * thing either writer ever stored, so a row not at UTC midnight is already an
 * agency instant and is left alone. Idempotent on that same test — a moved row
 * is no longer at UTC midnight (in every zone west of UTC, which is every zone
 * an agency is in; a UTC agency's rows do not need moving and are no-ops).
 *
 * Not reversible: a moved instant is indistinguishable from one written
 * correctly, so `down` throws, as `business_dates_agency_midnight` does.
 *
 * ⚠ `zonedDayStart` and its helpers are **copied in**, not imported — no
 * TypeScript build is in this path. Copied from
 * `20261012120000-business_dates_agency_midnight.js`.
 */

const DAY_MS = 86_400_000;

/** No zone is further than this from UTC: Pacific/Kiritimati is UTC+14. */
const MAX_AHEAD_OF_UTC_MS = 15 * 3_600_000;
/** …and Etc/GMT+12 / Baker Island is UTC−12. */
const MAX_BEHIND_UTC_MS = 13 * 3_600_000;

/** The reasons the app writes; a carrier-report or manual row is not ours to move. */
const APP_REASONS = ['cancel_rewrite', 'cancellation'];

/** `{ year, month (1-12), day }` of an instant in `timeZone`. */
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

/** The calendar day a UTC-midnight instant names. */
function utcDay(date) {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

/** The UTC instant at which `date` begins in `timeZone` — a binary search. */
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
    const chargebacks = db.collection('chargebacks');
    let moved = 0;

    for (const agency of agencies) {
      const timeZone = agency.timezone;
      if (typeof timeZone !== 'string' || !timeZone) {
        // `agency_timezone_backfill` guarantees the field; a row without it is
        // a mistake worth stopping on rather than silently filing in UTC.
        throw new Error(
          `chargeback_occurred_at_agency_midnight: agency ${String(agency._id)} (${agency.slug ?? '?'}) has no timezone.`,
        );
      }
      const agencyId = String(agency._id);
      const rows = await chargebacks
        .find(
          {
            agencyId,
            reason: { $in: APP_REASONS },
            occurredAt: { $type: 'date' },
            $expr: { $eq: [{ $mod: [{ $toLong: '$occurredAt' }, DAY_MS] }, 0] },
          },
          { projection: { occurredAt: 1 } },
        )
        .toArray();
      const writes = [];
      for (const row of rows) {
        const instant = zonedDayStart(utcDay(row.occurredAt), timeZone);
        if (instant.getTime() === row.occurredAt.getTime()) continue;
        writes.push({
          updateOne: {
            filter: { _id: row._id, occurredAt: row.occurredAt },
            update: { $set: { occurredAt: instant } },
          },
        });
      }
      if (writes.length) {
        const result = await chargebacks.bulkWrite(writes, { ordered: false });
        moved += result.modifiedCount;
      }
    }
    console.log(
      `[PAC-173] chargeback occurredAt moved to agency midnight: ${moved} row(s).`,
    );
  },

  async down() {
    throw new Error(
      'chargeback_occurred_at_agency_midnight cannot be undone: a moved instant is indistinguishable from one written at agency midnight.',
    );
  },
};
