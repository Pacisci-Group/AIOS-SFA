import { formatHouseholdRef, parseHouseholdRef } from '@sfa/shared';
import { AnyBulkWriteOperation, ClientSession, Model, Types } from 'mongoose';
import { SequenceService } from '../common/mongo/sequence.service';
import { Household } from './schemas/household.schema';

/**
 * The counter key for one agency's household numbering.
 *
 * Scoped per agency, not globally: `HH-2614` is the number *this* agency has
 * been saying out loud for years, and a shared sequence would both renumber them
 * and leak one tenant's volume to the next.
 */
export function householdCounterKey(agencyId: string): string {
  return `household:${agencyId}`;
}

/**
 * The next `HH-…` reference for an agency.
 *
 * Pass the session whenever the household insert is itself transactional, so a
 * rolled-back intake rolls the number back too — see {@link SequenceService}.
 */
export async function allocateHouseholdRef(
  sequences: SequenceService,
  agencyId: string,
  session?: ClientSession | null,
): Promise<string> {
  const seq = await sequences.next(householdCounterKey(agencyId), session);
  return formatHouseholdRef(seq);
}

export interface HouseholdRefReconciliation {
  alreadyNumbered: number;
  /** Highest reference found in the agency's existing data. */
  seededTo: number;
  allocated: number;
}

/**
 * Bring an agency's household numbering into a consistent state: seed the
 * counter from what is already stored, then number whatever is left.
 *
 * Shared by the backfill script and the demo seed rather than reimplemented in
 * each, because the ordering is the part that matters and it is easy to get
 * wrong. The counter **must** be seeded before anything is allocated — starting
 * from zero would hand `HH-1` to a household while a migrated one already holds
 * it, which the unique index rejects outright.
 *
 * Idempotent. Re-running allocates nothing, because every household already has
 * a reference, and `$max` never lowers the counter.
 */
export async function reconcileHouseholdRefs(
  householdModel: Model<Household>,
  sequences: SequenceService,
  agencyId: string,
): Promise<HouseholdRefReconciliation> {
  // Read the stored references rather than trusting the counter: on a database
  // seeded or migrated before the counter existed there is no counter to trust,
  // and this is the only record of where the series had reached.
  const numbered = await householdModel
    .find(
      { agencyId, householdRef: { $type: 'string' } },
      { householdRef: 1, _id: 0 },
    )
    .lean<Array<{ householdRef: string }>>();

  let seededTo = 0;
  for (const row of numbered) {
    const seq = parseHouseholdRef(row.householdRef);
    if (seq !== null && seq > seededTo) seededTo = seq;
  }

  const key = householdCounterKey(agencyId);
  await sequences.ensureAtLeast(key, seededTo);

  // Creation order, so a re-run after a partial failure resumes where it
  // stopped instead of reshuffling the numbers it already handed out.
  const pending = await householdModel
    .find({ agencyId, householdRef: { $in: [null, undefined] } }, { _id: 1 })
    .sort({ _id: 1 })
    .lean<Array<{ _id: Types.ObjectId }>>();

  if (!pending.length) {
    return { alreadyNumbered: numbered.length, seededTo, allocated: 0 };
  }

  const writes: AnyBulkWriteOperation<Household>[] = [];
  for (const household of pending) {
    // One allocation per household rather than reserving a block: a block would
    // be lost wholesale if the bulk write failed, and at these volumes the extra
    // round trips cost far less than reconciling that would.
    const seq = await sequences.next(key);
    writes.push({
      updateOne: {
        filter: { _id: household._id },
        update: { $set: { householdRef: formatHouseholdRef(seq) } },
      },
    });
  }

  const result = await householdModel.bulkWrite(writes);
  return {
    alreadyNumbered: numbered.length,
    seededTo,
    allocated: result.modifiedCount ?? 0,
  };
}
