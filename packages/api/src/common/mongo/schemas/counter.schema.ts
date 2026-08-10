import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type CounterDocument = HydratedDocument<Counter>;

/**
 * One monotonically increasing sequence per key — the classic MongoDB counters
 * collection, behind {@link SequenceService}.
 *
 * The key is the `_id` on purpose. `findOneAndUpdate` is only guaranteed atomic
 * for an **indexed** upsert, so putting the key anywhere else would mean adding
 * a unique index to get back what `_id` provides for free — and two concurrent
 * allocations racing to insert the same missing counter is exactly the case that
 * has to hold.
 *
 * Deliberately not a `TenantRecord`: the tenant is part of the key
 * (`household:<agencyId>`), and a counter is infrastructure rather than a record
 * anyone reads, so it carries no branch, no legacy id and no timestamps.
 */
@Schema({ collection: 'counters', versionKey: false })
export class Counter {
  /** Scope key, e.g. `household:65f...` — see `householdCounterKey`. */
  @Prop({ type: String, required: true })
  _id: string;

  @Prop({ type: Number, required: true, default: 0 })
  seq: number;
}

export const CounterSchema = SchemaFactory.createForClass(Counter);
