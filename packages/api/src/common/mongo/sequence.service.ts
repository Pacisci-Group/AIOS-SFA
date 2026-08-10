import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import { Counter } from './schemas/counter.schema';

/**
 * Allocates gapless per-scope sequence numbers.
 *
 * `$inc` in a single `findOneAndUpdate` is one atomic server operation, so two
 * concurrent callers can never be handed the same number — the read and the
 * write cannot be interleaved the way `find` + `save` can.
 *
 * ## Pass the session
 *
 * Callers that allocate as part of a larger unit of work must pass their
 * `ClientSession`. Inside a transaction the increment rolls back with everything
 * else, so an intake that fails leaves **no gap** in the sequence. The cost is
 * that concurrent transactions touching one counter document conflict and get
 * retried by `withTransaction` — acceptable here, where an agency creates
 * households at human speed, and the alternative (allocating outside the
 * transaction) trades those retries for permanent holes in the numbering.
 */
@Injectable()
export class SequenceService {
  constructor(
    @InjectModel(Counter.name)
    private readonly counterModel: Model<Counter>,
  ) {}

  /**
   * The next number for `key`, starting at 1 for a counter that doesn't exist.
   */
  async next(key: string, session?: ClientSession | null): Promise<number> {
    const counter = await this.counterModel
      .findOneAndUpdate(
        { _id: key },
        { $inc: { seq: 1 } },
        { new: true, upsert: true, session: session ?? undefined },
      )
      .lean<{ seq: number } | null>();

    if (!counter) {
      // `new` + `upsert` always returns a document; this is unreachable short of
      // a driver contract change, and returning a silent 0 would collide.
      throw new Error(`Sequence "${key}" returned no counter document.`);
    }
    return counter.seq;
  }

  /**
   * Raise `key` to at least `value`, never lowering it.
   *
   * How an imported agency's counter is seeded: the migration writes the numbers
   * legacy already assigned, then lifts the counter above the highest of them so
   * the next allocation continues the series instead of colliding with it.
   *
   * `$max` rather than a read-then-write so re-running is idempotent and safe
   * against a concurrent allocation.
   */
  async ensureAtLeast(key: string, value: number): Promise<void> {
    if (!Number.isSafeInteger(value) || value < 1) return;
    await this.counterModel.updateOne(
      { _id: key },
      { $max: { seq: value } },
      { upsert: true },
    );
  }

  /**
   * Drop a counter so the next allocation starts from 1 again.
   *
   * Only safe where the caller re-derives the floor from stored data before
   * allocating — `reconcileHouseholdRefs` does exactly that, which is why the
   * demo seed's `--fresh` purge can reset the household counter without any risk
   * of reissuing a number a surviving record still holds. Do **not** call this
   * on a live agency's counter on its own.
   */
  async reset(key: string): Promise<void> {
    await this.counterModel.deleteOne({ _id: key });
  }

  /** Current value without consuming one — diagnostics and backfill reporting. */
  async peek(key: string): Promise<number> {
    const counter = await this.counterModel
      .findById(key)
      .lean<{ seq: number } | null>();
    return counter?.seq ?? 0;
  }
}
