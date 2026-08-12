import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

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
  @Prop({ type: Types.ObjectId, ref: 'Agency', required: true })
  agencyId: Types.ObjectId;

  @Prop({ type: Date, required: true, default: () => new Date(0) })
  lastScanAt: Date;
}

export const RenewalScanStateSchema =
  SchemaFactory.createForClass(RenewalScanState);

RenewalScanStateSchema.index({ agencyId: 1 }, { unique: true });
