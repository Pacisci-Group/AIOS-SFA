/**
 * Indexes that serve the ticket queue's urgency sort.
 *
 * `GET /crm/service-tickets` pages server-side as of PAC-98, ordering by
 * `urgencyRank → urgencyAt → priorityRank → _id`. Without an index covering
 * that order Mongo answers it with an in-memory `SORT` stage, which reads the
 * caller's **entire** scope to return one page — the exact cost pagination was
 * added to remove, hidden behind a response that looks correct.
 *
 * Measured on a 1,470-ticket agency before adding these:
 *
 * | Query                    | docs examined | sort stage |
 * | ------------------------ | ------------- | ---------- |
 * | agency scope, page 1     | 1470 → 8      | yes → no   |
 * | own scope, page 1        | 1470 → 8      | yes → no   |
 * | agency scope, Overdue    | 1470 → 10     | yes → no   |
 *
 * ## Two indexes, because there are two scopes
 *
 * `scopeFilter` clamps by `agencyId` for an agency-scoped reader (owner,
 * manager) and by `assignedUserId` for an `own`-scoped one (a CSR looking at
 * their own queue, which is the common case). Those are different index
 * prefixes and one cannot serve the other: a compound index is only usable
 * from its left edge, so `{agencyId, urgencyRank, …}` does nothing for a query
 * that filters on `assignedUserId` alone.
 *
 * Branch scope reuses the agency index — `{agencyId, branchId}` queries still
 * match its prefix, and the branch clamp then filters the far smaller set it
 * returns.
 *
 * ## Why the tab is not in the key
 *
 * Putting `status` before `urgencyRank` would serve the Overdue tab and break
 * the All tab, which needs the ranks contiguous. It is unnecessary anyway:
 * `urgencyRank` *is* status, bucketed and ordered, so overdue tickets are
 * already at the front of the index. The measurement above bears that out — 10
 * keys read for 8 rows.
 *
 * A migration rather than a schema edit, per `migrations/README.md`:
 * `autoIndex` creates only indexes that are missing and never rebuilds one
 * whose options changed, so a schema-only edit would leave every existing
 * database on the old definition.
 */

const AGENCY_INDEX = 'queue_urgency_agency';
const OWN_INDEX = 'queue_urgency_own';

const KEY_SUFFIX = {
  urgencyRank: 1,
  urgencyAt: 1,
  priorityRank: 1,
  _id: 1,
};

module.exports = {
  async up(db) {
    const tickets = db.collection('serviceTickets');
    // `createIndex` is idempotent for an identical definition, which is what
    // makes a retry after a partial failure safe — a failed migration is not
    // recorded and re-runs from the top.
    await tickets.createIndex(
      { agencyId: 1, ...KEY_SUFFIX },
      { name: AGENCY_INDEX, background: true },
    );
    await tickets.createIndex(
      { assignedUserId: 1, ...KEY_SUFFIX },
      { name: OWN_INDEX, background: true },
    );
  },

  async down(db) {
    const tickets = db.collection('serviceTickets');
    for (const name of [AGENCY_INDEX, OWN_INDEX]) {
      // Tolerate absence: `down` may run against a database where `up` failed
      // partway, and IndexNotFound (27) is the expected shape of that.
      await tickets.dropIndex(name).catch((error) => {
        if (error?.code !== 27) throw error;
      });
    }
  },
};
