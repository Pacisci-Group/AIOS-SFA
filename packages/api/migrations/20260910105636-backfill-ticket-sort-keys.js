/**
 * Seed the materialized sort keys on every existing ticket, and correct the
 * stored `status` of scheduled calls whose deadlines have already passed.
 *
 * `urgencyRank`, `urgencyAt` and `priorityRank` are new. Mongoose defaults fill
 * them in on documents it *writes*, not on the ones already in the collection,
 * so without this every migrated ticket sorts as though it were medium
 * priority, opened now, and merely open — which is to say the queue's order
 * would be wrong for every row that predates the deploy and right for every
 * row after it, with nothing on screen to distinguish the two.
 *
 * ## Why the status correction is here and not left to the sweep
 *
 * `SyncTicketStatusFn` converges on its own within one tick, so this is not
 * strictly required. It is here to make the deploy deterministic: without it
 * the first person to open the dashboard after release sees up to five minutes
 * of the same wrong "Needs Action Today" that PAC-102 is about, which is a poor
 * way to ship the fix for it.
 *
 * ## Idempotent
 *
 * Every stage recomputes from immutable inputs — `priority`, `openedAt`, the
 * step's own dates — so a retry after a partial failure lands on the same
 * values. That matters more than usual here: a failed migration is not
 * recorded and re-runs from the top (`migrations/README.md`).
 *
 * Raw `db` handle, no Mongoose model, per the same README: importing a schema
 * fires `autoIndex` and races the migration.
 *
 * ⚠ Mirrors `deriveStepStatus` and `step-status.query.ts`. If the precedence of
 * `overdue` over `open` ever changes, this file is already applied and
 * immutable — the fix is a new migration, not an edit here.
 */

const OVERDUE = 'overdue';
const OPEN = 'open';
const WAITING = 'waiting';

/** Mirrors `SERVICE_TICKET_URGENCY_RANK` in `@sfa/shared`. */
const URGENCY_RANK = {
  overdue: 0,
  open: 1,
  in_progress: 1,
  waiting: 2,
  waiting_on_client: 2,
  waiting_on_carrier: 2,
  resolved: 3,
  closed: 3,
};

/** Mirrors `SERVICE_TICKET_PRIORITY_RANK` in `@sfa/shared`. */
const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

module.exports = {
  async up(db) {
    const tickets = db.collection('serviceTickets');
    const now = new Date();

    /*
     * Stage 1 — advance statuses that the clock has already moved past.
     *
     * Runs before the ranks so stage 2 derives `urgencyRank` from the
     * corrected status in one pass, rather than writing a rank this migration
     * would then have to revisit.
     *
     * `overdue` before `open`, matching the derivation's precedence: a step
     * that is both available and past due is overdue, and doing these the
     * other way round would set it open for the next update to correct.
     *
     * The `$ne: null` guards mirror `step-status.query.ts` and are defensive
     * rather than load-bearing: Mongo's range operators are type-bracketed, so
     * `$lt: <Date>` never matches a null or missing field. See that file for
     * why they are kept regardless.
     */
    for (const step of ['onboarding', 'renewal']) {
      await tickets.updateMany(
        {
          statusOverriddenAt: null,
          status: { $ne: OVERDUE },
          [`${step}.completedAt`]: null,
          [`${step}.dueAt`]: { $ne: null, $lt: now },
        },
        { $set: { status: OVERDUE } },
      );
      await tickets.updateMany(
        {
          statusOverriddenAt: null,
          status: { $ne: OPEN },
          [`${step}.completedAt`]: null,
          [`${step}.availableAt`]: { $ne: null, $lte: now },
          $or: [
            { [`${step}.dueAt`]: null },
            { [`${step}.dueAt`]: { $gte: now } },
          ],
        },
        { $set: { status: OPEN } },
      );
      /*
       * And back the other way, which is the case the sweep does *not* cover.
       *
       * Every creation path leaves `status` on its `open` default, including
       * for a call scheduled days out — so the stored column has been wrong
       * for scheduled calls since the feature shipped, and only invisible
       * because reads re-derived it. `SyncTicketStatusFn` has no reason to
       * look for this (time never moves a call *back* to unopened; only a
       * re-plan does, and that goes through the save hook), so the correction
       * has to happen here, once.
       */
      await tickets.updateMany(
        {
          statusOverriddenAt: null,
          status: { $ne: WAITING },
          [`${step}.completedAt`]: null,
          [`${step}.availableAt`]: { $ne: null, $gt: now },
        },
        { $set: { status: WAITING } },
      );
    }

    // Stage 2 — ranks, one update per distinct value rather than a cursor over
    // the collection. Eight statuses and three priorities is eleven indexed
    // updates; walking documents would be one round trip per ticket.
    for (const [status, rank] of Object.entries(URGENCY_RANK)) {
      await tickets.updateMany(
        { status, urgencyRank: { $ne: rank } },
        { $set: { urgencyRank: rank } },
      );
    }
    for (const [priority, rank] of Object.entries(PRIORITY_RANK)) {
      await tickets.updateMany(
        { priority, priorityRank: { $ne: rank } },
        { $set: { priorityRank: rank } },
      );
    }
    // A ticket whose priority is absent or outside the vocabulary still needs a
    // sortable value, or it lands wherever BSON puts a missing field.
    await tickets.updateMany(
      { priorityRank: { $exists: false } },
      { $set: { priorityRank: PRIORITY_RANK.medium } },
    );

    /*
     * Stage 3 — `urgencyAt`: the onboarding call's due date, else `openedAt`.
     *
     * Deliberately ignores `renewal.dueAt`, mirroring `urgencyInstant` in the
     * web app. That asymmetry is probably a bug, but it is the order the queue
     * ships today and correcting it here would silently reorder every rep's
     * list as a side effect of a backfill. It gets its own change.
     */
    await tickets.updateMany({ 'onboarding.dueAt': { $ne: null } }, [
      { $set: { urgencyAt: '$onboarding.dueAt' } },
    ]);
    await tickets.updateMany(
      {
        $or: [
          { onboarding: null },
          { 'onboarding.dueAt': null },
          { 'onboarding.dueAt': { $exists: false } },
        ],
      },
      [{ $set: { urgencyAt: { $ifNull: ['$openedAt', '$createdAt'] } } }],
    );
  },

  /**
   * Drops the three fields. The statuses corrected in stage 1 are **not**
   * reverted: they were wrong before this ran and re-staling them would be
   * restoring a bug, not undoing a change. Rolling back the code alone is
   * enough — the old read path derives status and ignores these fields.
   */
  async down(db) {
    await db
      .collection('serviceTickets')
      .updateMany(
        {},
        { $unset: { urgencyRank: '', urgencyAt: '', priorityRank: '' } },
      );
  },
};
