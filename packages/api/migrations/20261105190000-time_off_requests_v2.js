/**
 * PAC-165 — the existing `timeOffRequests` rows become read-only imported
 * history, in the shape the request lifecycle now uses.
 *
 * Until this ticket the collection held only what the SmartSuite import (and
 * the demo seed) wrote: `title`, `startDate` / `endDate` instants,
 * `requestType`, `hoursRequested`, `status`, `type`, `decision`,
 * `producerId`. PAC-165 gives the collection a real model — a policy, a
 * per-date hours list, a lifecycle `status`, a timeline — and none of the
 * old rows can enter it: they have no policy, no per-date hours, and on the
 * real agency every one of them is still `Submitted` months after its dates.
 *
 * Decided 2026-11-05 (Asad): they are **history, not work**. So this does
 * not map the SmartSuite statuses onto the new ones. It:
 *
 * - stamps each row `source: 'legacy'`;
 * - moves the SmartSuite labels under `legacy.*` (`status`, `type`,
 *   `requestType`, `decision`, `title`) — display only. The row is left with
 *   **no lifecycle `status` at all**, which is what guarantees no query for
 *   "Submitted" requests — the To review list, the overlap check, the policy
 *   archive guard — can ever match one;
 * - renames `producerId` → `employeeId` (whose time off it is; the person is
 *   not always a producer) and `hoursRequested` → `totalHours`;
 * - replaces the `startDate` / `endDate` instants with the calendar days
 *   `firstDay` / `lastDay`. A leave day names a day. SmartSuite's date-only
 *   fields were imported at UTC midnight, so for those the UTC calendar day
 *   *is* the day that was typed; an instant with a time of day (demo rows)
 *   is read on the agency's calendar instead;
 * - gives each row one `imported` timeline entry dated when it was imported;
 * - drops the two single-field indexes the old schema declared (`status_1`,
 *   `producerId_1`). The new compound indexes are `autoIndex`'s to build.
 *
 * Nothing is written to `leaveLedger`, no `TOR-` reference is minted and no
 * policy is guessed: an imported row is in no balance.
 *
 * The SmartSuite import (`migrateTimeOffRequests`) writes this same shape, so
 * a database imported after this ticket matches one migrated by it.
 *
 * ## Idempotent
 *
 * Only rows without `source` are touched, and each update repeats that
 * condition, so a retry after a partial failure converts what is left and a
 * second run matches nothing. The index drops are existence-checked.
 */

/** Copied from `DEFAULT_AGENCY_TIME_ZONE`. */
const DEFAULT_TIME_ZONE = 'America/Chicago';

/** Copied from `TIME_OFF_REQUEST_TYPES` → `TimeOffDayMode`. */
const DAY_MODE_BY_LEGACY_TYPE = {
  'Full Day(s)': 'full',
  'Partial Day (Hours)': 'partial',
};

/** The single-field indexes the pre-PAC-165 schema declared. */
const STALE_INDEXES = ['status_1', 'producerId_1'];

const BATCH = 500;

/** `YYYY-MM-DD` of an instant on the agency's calendar (`en-CA` formats ISO-style). */
function calendarDay(instant, timeZone) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(instant);
  } catch {
    return instant.toISOString().slice(0, 10);
  }
}

/** The calendar day a stored start / end instant names, or null. */
function leaveDay(value, timeZone) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null;
  const iso = value.toISOString();
  // A date-only SmartSuite field, imported at UTC midnight.
  if (iso.endsWith('T00:00:00.000Z')) return iso.slice(0, 10);
  return calendarDay(value, timeZone);
}

/** A non-empty trimmed string, or null — the import wrote `''` for a blank select. */
function label(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Legacy hours are copied raw; anything that is not a sane number reads as zero. */
function hours(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value * 100) / 100
    : 0;
}

module.exports = {
  /**
   * @param {import('mongodb').Db} db
   * @returns {Promise<void>}
   */
  async up(db) {
    const requests = db.collection('timeOffRequests');
    const now = new Date();

    const agencies = await db
      .collection('agencies')
      .find({}, { projection: { _id: 1, timezone: 1 } })
      .toArray();
    // `agencyId` is a string on a tenant record.
    const zones = new Map(
      agencies.map((agency) => [
        agency._id.toString(),
        agency.timezone || DEFAULT_TIME_ZONE,
      ]),
    );

    let converted = 0;
    let batch = [];
    const flush = async () => {
      if (batch.length === 0) return;
      const result = await requests.bulkWrite(batch, { ordered: false });
      converted += result.modifiedCount;
      batch = [];
    };

    const cursor = requests.find({ source: { $exists: false } });
    for await (const row of cursor) {
      const timeZone = zones.get(String(row.agencyId)) || DEFAULT_TIME_ZONE;
      const firstDay =
        leaveDay(row.startDate, timeZone) ?? leaveDay(row.endDate, timeZone);
      const lastDay = leaveDay(row.endDate, timeZone) ?? firstDay;
      const requestType = label(row.requestType);

      batch.push({
        updateOne: {
          filter: { _id: row._id, source: { $exists: false } },
          update: {
            $set: {
              source: 'legacy',
              reference: null,
              employeeId: row.producerId ?? null,
              initiatorId: null,
              policyId: null,
              firstDay,
              lastDay,
              dayMode: DAY_MODE_BY_LEGACY_TYPE[requestType] ?? null,
              days: [],
              totalHours: hours(row.hoursRequested),
              note: null,
              submittedAt: null,
              decidedAt: null,
              decidedBy: null,
              autoApproved: false,
              timeline: [
                {
                  at: row.createdAt instanceof Date ? row.createdAt : now,
                  actorId: null,
                  action: 'imported',
                  fromStatus: null,
                  toStatus: null,
                  note: null,
                  warnings: [],
                },
              ],
              legacy: {
                status: label(row.status),
                type: label(row.type),
                requestType,
                decision: label(row.decision),
                title: label(row.title),
              },
              deletedAt: null,
              deletedBy: null,
            },
            $unset: {
              status: '',
              type: '',
              requestType: '',
              decision: '',
              title: '',
              startDate: '',
              endDate: '',
              hoursRequested: '',
              producerId: '',
            },
          },
        },
      });
      if (batch.length >= BATCH) await flush();
    }
    await flush();

    const dropped = [];
    for (const name of STALE_INDEXES) {
      if (await requests.indexExists(name)) {
        await requests.dropIndex(name);
        dropped.push(name);
      }
    }

    console.log(
      `[time-off-requests-v2] ${converted} row(s) marked imported; index(es) dropped: ${dropped.length ? dropped.join(', ') : 'none'}`,
    );
  },

  async down() {
    throw new Error(
      'time_off_requests_v2 cannot be rolled back: requests made since use the new shape, and the old single-field status no longer exists to restore.',
    );
  },
};
