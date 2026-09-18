/**
 * Hand Ashley Medina's book of work to Mike Iles.
 *
 * Ashley has left the agency (her user is already `isActive: false`). Her
 * outstanding work and her client book stay pointed at her account until
 * something moves them, which leaves the work invisible to the person now
 * responsible for it: a `csr` is `own`-scoped, so a ticket assigned to a
 * departed rep is on nobody's plate.
 *
 * ## Assignment vs attribution — the distinction this migration turns on
 *
 * A user id on a record means one of two very different things, and the schema
 * does not label which:
 *
 *   - **Assignment** — somebody is *expected to act*. That is what moves here.
 *   - **Attribution** — a historical fact about who did something.
 *
 * This touches assignment only. It never writes `createdByUserId`,
 * `createdByName`, `onboarding.completedBy`, `renewal.completedBy`,
 * `timeline[].author`, `deals.producerId`, `leads.producerId` or
 * `quoteRecaps.producerId`. Rewriting those would not reassign anything — it
 * would delete the agency's record of what happened and silently restate
 * historical performance numbers. Same rule `UserWorkReleaseService` documents
 * (`src/users/user-work-release.service.ts`); this is its "give it to someone
 * specific" counterpart, where that one only releases work back to the queue.
 *
 * `branchId` is deliberately untouched too: a ticket's branch belongs to the
 * client, not to the rep working it, and moving it would change which
 * branch-scoped users can see the record.
 *
 * ## What moves, and why each one is needed
 *
 * | Collection       | Field                            | Why |
 * |------------------|----------------------------------|-----|
 * | `serviceTickets` | `assignedUserId` + `assignedRep` | The assignment itself. |
 * | `onboardings`    | `assignedCsrId`                  | Mints the *next* call's ticket in a chain. |
 * | `renewalCycles`  | `assignedCsrId`                  | Mints future renewal call tickets. |
 * | `households`     | `assignedCrmId`                  | Seeds `assignedCsrId` on every future renewal cycle. |
 * | `deals`          | `assignedCrmId`                  | The household mirror kept by `CrmAssignmentService`. |
 * | `crmRotations`   | `crmId` / `activeForProducer`    | The round-robin pool that hands out new work. |
 *
 * The four middle rows are not optional extras. Ticket rows alone would undo
 * themselves: completing an onboarding call creates the next ticket from
 * `onboardings.assignedCsrId`, and renewal calls materialize from
 * `renewalCycles.assignedCsrId`, so new work would keep landing on the departed
 * account. (Existing tickets are safe — both `ensureStepTicket` and
 * `ensureRenewalTicket` return early when the ticket already exists, so neither
 * overwrites an assignment that is already stored.)
 *
 * ## The rotation subtlety
 *
 * The round-robin pool is `{agencyId, producerId, activeForProducer: true}`,
 * one row per slot, and `CrmAssignmentService` reads `crmId` off each. Blindly
 * rewriting `crmId` would give Mike **two** slots in any producer's pool where
 * he already has one, quietly doubling his share of every future sold deal. So
 * a row is taken over only where Mike has no active slot for that producer;
 * where he does, Ashley's row is switched off instead. `activeForProducer` is
 * never turned *on* — that would add Mike to pools nobody put him in.
 *
 * ## Both ticket collections
 *
 * A database that has not yet run `consolidate-service-tickets.ts` still keeps
 * the CRM-shaped rows in `service_tickets` while `serviceTickets` holds the old
 * SmartSuite import mirror. Whichever of the two exists is updated, so this is
 * correct either side of that consolidation and a no-op on the collection that
 * holds no assignments.
 *
 * ## Safety
 *
 * - **Missing users are a no-op, not a failure.** This runs on every database —
 *   local, CI, staging, production — and neither account exists in most of
 *   them. A migration that threw there would exit non-zero at API startup and
 *   crash-loop the container (see DEPLOYMENT.md, "Schema migrations").
 * - **Idempotent.** Every filter matches on the *old* assignee, so a completed
 *   run matches nothing on a retry. The audit document is merged with
 *   `$addToSet`, so a run that failed halfway and retried from the top ends up
 *   recording the union of both passes rather than losing the first.
 * - **Reversible, exactly.** `down` cannot simply move Mike's tickets back —
 *   that would sweep up the ones that were always his. So `up` records the
 *   precise `_id`s it touched, plus each ticket's previous `assignedRep`, in
 *   `migrations_reassignment_audit`, and `down` reverts only those.
 */

const { ObjectId } = require('mongodb');

const FROM_EMAIL = 'ashleymedina2@allstate.com';
const TO_EMAIL = 'jamesiles@allstate.com';

/** Where `up` records exactly what it changed, so `down` can be precise. */
const AUDIT_COLLECTION = 'migrations_reassignment_audit';
const AUDIT_ID = 'reassign-ashley-medina-to-mike-iles';

const LOG = '[reassign-ashley-medina]';

/**
 * Ends a ticket's life. Tickets in these states still move — the whole book is
 * changing hands — but they get no timeline note, because they are history and
 * nothing is going to happen on them.
 *
 * Mirrors `SERVICE_TICKET_TERMINAL_STATUSES` in
 * `packages/shared/src/service/service-ticket.ts`. Duplicated rather than
 * imported because a migration is a frozen historical record and is CommonJS,
 * while that is TypeScript compiled into the webpack bundle.
 */
const TERMINAL_STATUSES = ['resolved', 'closed'];

/** Simple `assignedCsrId`/`assignedCrmId` moves, in the order they are applied. */
const SIMPLE_MOVES = [
  { collection: 'onboardings', field: 'assignedCsrId' },
  { collection: 'renewalCycles', field: 'assignedCsrId' },
  { collection: 'households', field: 'assignedCrmId' },
  { collection: 'deals', field: 'assignedCrmId' },
];

/** `userDisplayName` in `src/crm/service-tickets.service.ts`, kept in step. */
function displayName(user) {
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return name || user.email || 'System';
}

async function exists(db, name) {
  const found = await db.listCollections({ name }).toArray();
  return found.length > 0;
}

/** Which ticket collections this database actually has — see the header. */
async function ticketCollections(db) {
  const names = ['serviceTickets', 'service_tickets'];
  const present = [];
  for (const name of names) {
    if (await exists(db, name)) present.push(name);
  }
  return present;
}

module.exports = {
  /**
   * @param {import('mongodb').Db} db
   * @returns {Promise<void>}
   */
  async up(db) {
    const users = db.collection('users');
    const [from, to] = await Promise.all([
      users.findOne({ email: FROM_EMAIL }),
      users.findOne({ email: TO_EMAIL }),
    ]);

    if (!from || !to) {
      const missing = [!from && FROM_EMAIL, !to && TO_EMAIL]
        .filter(Boolean)
        .join(', ');
      console.log(
        `${LOG} skipped: no user for ${missing}. Expected on any database that ` +
          'is not the live agency tenant.',
      );
      return;
    }

    // Guard, not a skip. Both accounts existing but in different tenants means
    // the emails no longer identify who this migration was written for, and
    // moving client work across a tenant boundary is not something to do on a
    // guess.
    if (String(from.agencyId) !== String(to.agencyId)) {
      throw new Error(
        `${LOG} ${FROM_EMAIL} (agency ${from.agencyId}) and ${TO_EMAIL} ` +
          `(agency ${to.agencyId}) are in different agencies. Refusing to move ` +
          'client work across tenants.',
      );
    }

    const agencyId = from.agencyId;
    const toName = displayName(to);
    const audit = {
      fromUserId: from._id,
      toUserId: to._id,
      fromName: displayName(from),
      toName,
      tickets: [],
      noted: [],
      rotationsTakenOver: [],
      rotationsDeactivated: [],
    };
    for (const move of SIMPLE_MOVES) audit[move.collection] = [];

    // ── Tickets ──────────────────────────────────────────────────────────────
    for (const name of await ticketCollections(db)) {
      const tickets = db.collection(name);
      const mine = await tickets
        .find(
          { agencyId, assignedUserId: from._id },
          { projection: { _id: 1, status: 1, assignedRep: 1 } },
        )
        .toArray();
      if (!mine.length) continue;

      // Captured BEFORE the update. Afterwards these are indistinguishable from
      // the tickets Mike already had, so a note filtered on the new assignee
      // would stamp his own pre-existing tickets too.
      const openIds = mine
        .filter((t) => !TERMINAL_STATUSES.includes(t.status))
        .map((t) => t._id);

      await tickets.updateMany(
        { _id: { $in: mine.map((t) => t._id) } },
        { $set: { assignedUserId: to._id, assignedRep: toName } },
      );

      if (openIds.length) {
        await tickets.updateMany(
          { _id: { $in: openIds } },
          {
            $push: {
              timeline: {
                _id: new ObjectId(),
                type: 'system',
                content: `Reassigned from ${audit.fromName} to ${toName}.`,
                at: new Date(),
              },
            },
          },
        );
      }

      // The previous `assignedRep` is recorded per ticket because it varies —
      // `assignedUserId` does not, since it is the filter.
      audit.tickets.push(
        ...mine.map((t) => ({ c: name, i: t._id, r: t.assignedRep ?? null })),
      );
      audit.noted.push(...openIds.map((id) => ({ c: name, i: id })));
      console.log(
        `${LOG} ${name}: ${mine.length} moved (${openIds.length} still open, noted).`,
      );
    }

    // ── The records that mint future work ───────────────────────────────────
    for (const { collection, field } of SIMPLE_MOVES) {
      if (!(await exists(db, collection))) continue;
      const coll = db.collection(collection);
      const ids = (
        await coll
          .find({ agencyId, [field]: from._id }, { projection: { _id: 1 } })
          .toArray()
      ).map((d) => d._id);
      if (!ids.length) continue;

      await coll.updateMany({ _id: { $in: ids } }, { $set: { [field]: to._id } });
      audit[collection] = ids;
      console.log(`${LOG} ${collection}: ${ids.length} moved (${field}).`);
    }

    // ── Round-robin rotation ────────────────────────────────────────────────
    if (await exists(db, 'crmRotations')) {
      const rotations = db.collection('crmRotations');
      const mine = await rotations.find({ agencyId, crmId: from._id }).toArray();

      for (const row of mine) {
        const clash = await rotations.countDocuments({
          agencyId,
          producerId: row.producerId,
          crmId: to._id,
          activeForProducer: true,
        });
        if (clash > 0) {
          // Only worth recording if it is actually on — flipping an already-off
          // row changes nothing, and `down` must not switch it back on.
          if (row.activeForProducer) audit.rotationsDeactivated.push(row._id);
        } else {
          audit.rotationsTakenOver.push(row._id);
        }
      }

      if (audit.rotationsTakenOver.length) {
        // `activeForProducer` is carried over as-is, never turned on.
        await rotations.updateMany(
          { _id: { $in: audit.rotationsTakenOver } },
          { $set: { crmId: to._id } },
        );
      }
      if (audit.rotationsDeactivated.length) {
        await rotations.updateMany(
          { _id: { $in: audit.rotationsDeactivated } },
          { $set: { activeForProducer: false } },
        );
      }
      console.log(
        `${LOG} crmRotations: ${audit.rotationsTakenOver.length} taken over, ` +
          `${audit.rotationsDeactivated.length} switched off as duplicates.`,
      );
    }

    // ── Record what happened ────────────────────────────────────────────────
    //
    // `$addToSet` rather than `$set`: a run that failed partway is not written
    // to the changelog and retries from the top, and the retry only sees what
    // is left. Merging keeps the union of both passes so `down` stays complete.
    await db.collection(AUDIT_COLLECTION).updateOne(
      { _id: AUDIT_ID },
      {
        $setOnInsert: {
          fromUserId: audit.fromUserId,
          toUserId: audit.toUserId,
          fromName: audit.fromName,
          toName: audit.toName,
          appliedAt: new Date(),
        },
        $addToSet: {
          tickets: { $each: audit.tickets },
          noted: { $each: audit.noted },
          rotationsTakenOver: { $each: audit.rotationsTakenOver },
          rotationsDeactivated: { $each: audit.rotationsDeactivated },
          ...Object.fromEntries(
            SIMPLE_MOVES.map(({ collection }) => [
              collection,
              { $each: audit[collection] },
            ]),
          ),
        },
      },
      { upsert: true },
    );

    const moved =
      audit.tickets.length +
      SIMPLE_MOVES.reduce((n, m) => n + audit[m.collection].length, 0) +
      audit.rotationsTakenOver.length;
    console.log(
      `${LOG} done — ${moved} record(s) moved from ${audit.fromName} to ${toName}.`,
    );
  },

  /**
   * @param {import('mongodb').Db} db
   * @returns {Promise<void>}
   */
  async down(db) {
    const audit = await db
      .collection(AUDIT_COLLECTION)
      .findOne({ _id: AUDIT_ID });

    if (!audit) {
      // `up` no-opped here (neither account on this database), so there is
      // nothing to undo and that is not an error.
      console.log(`${LOG} nothing recorded — no rollback needed.`);
      return;
    }

    const { fromUserId, fromName, toName } = audit;

    // Tickets, one previous `assignedRep` at a time. Grouped by value so a book
    // of thousands is a handful of updates rather than one per ticket.
    const byRep = new Map();
    for (const { c, i, r } of audit.tickets ?? []) {
      const key = `${c} ${r ?? ''}`;
      if (!byRep.has(key)) byRep.set(key, { collection: c, rep: r ?? '', ids: [] });
      byRep.get(key).ids.push(i);
    }
    for (const { collection, rep, ids } of byRep.values()) {
      await db
        .collection(collection)
        .updateMany(
          { _id: { $in: ids } },
          { $set: { assignedUserId: fromUserId, assignedRep: rep } },
        );
    }

    // The note `up` pushed, matched on its exact text.
    const noteContent = `Reassigned from ${fromName} to ${toName}.`;
    const notedByCollection = new Map();
    for (const { c, i } of audit.noted ?? []) {
      if (!notedByCollection.has(c)) notedByCollection.set(c, []);
      notedByCollection.get(c).push(i);
    }
    for (const [collection, ids] of notedByCollection) {
      await db
        .collection(collection)
        .updateMany(
          { _id: { $in: ids } },
          { $pull: { timeline: { type: 'system', content: noteContent } } },
        );
    }

    for (const { collection, field } of SIMPLE_MOVES) {
      const ids = audit[collection] ?? [];
      if (!ids.length) continue;
      await db
        .collection(collection)
        .updateMany({ _id: { $in: ids } }, { $set: { [field]: fromUserId } });
    }

    if (audit.rotationsTakenOver?.length) {
      await db
        .collection('crmRotations')
        .updateMany(
          { _id: { $in: audit.rotationsTakenOver } },
          { $set: { crmId: fromUserId } },
        );
    }
    if (audit.rotationsDeactivated?.length) {
      // Only rows `up` actually switched off are switched back on.
      await db
        .collection('crmRotations')
        .updateMany(
          { _id: { $in: audit.rotationsDeactivated } },
          { $set: { activeForProducer: true } },
        );
    }

    await db.collection(AUDIT_COLLECTION).deleteOne({ _id: AUDIT_ID });
    console.log(`${LOG} rolled back to ${fromName}.`);
  },
};
