import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ObjectIdType } from '../../common/mongo/object-id';

export type RenewalScanStateDocument = HydratedDocument<RenewalScanState>;

/**
 * When an agency's renewal scan last ran.
 *
 * There is no scheduler in this API — no `@nestjs/schedule`, no queue, nothing
 * that runs on a timer. Renewal cycles therefore materialize lazily on read,
 * the same bargain onboarding already makes with `reconcileOnboarding`.
 *
 * This one-document-per-agency collection is what stops every request paying
 * for a scan: a request *claims* the next window with an atomic conditional
 * update, and whoever loses simply skips it.
 *
 *     findOneAndUpdate(
 *       { agencyId, lastScanAt: { $lt: cutoff } },
 *       { $set: { lastScanAt: now } },
 *       { upsert: true },
 *     )
 *
 * The unique index is load-bearing rather than merely tidy: when a document
 * already exists *inside* the window the filter misses, the upsert attempts an
 * insert, and the index rejects it. That duplicate-key error is the normal
 * "someone else holds the window" path, not a failure.
 */
@Schema({ timestamps: true, collection: 'renewalScanState' })
export class RenewalScanState {
  @Prop({ type: ObjectIdType, ref: 'Agency', required: true })
  agencyId: Types.ObjectId;

  @Prop({ type: Date, required: true, default: () => new Date(0) })
  lastScanAt: Date;

  /**
   * How far through the renewal window the last pass got.
   *
   * Side A reads a **bounded batch** ordered by `renewalDate`, so without a
   * cursor it re-reads the same earliest `RENEWAL_SCAN_BATCH` policies on every
   * pass and never reaches the rest — they already have cycles, the pass does
   * no new work, and the tail of the window is never scanned at all. With a
   * whole book newly eligible after the anchor backfill that is roughly 40% of
   * policies silently getting no ticket, forever.
   *
   * So each pass resumes at the last `renewalDate` it saw and sweeps forward.
   * A short batch means the window is exhausted, and the cursor resets to null
   * to start the next sweep from the beginning — which is also what picks up
   * policies whose dates have since moved backwards into the window.
   *
   * Null is "start from the beginning of the window", not "done".
   */
  @Prop({ type: Date, default: null })
  scanCursor: Date | null;
}

export const RenewalScanStateSchema =
  SchemaFactory.createForClass(RenewalScanState);

RenewalScanStateSchema.index({ agencyId: 1 }, { unique: true });
