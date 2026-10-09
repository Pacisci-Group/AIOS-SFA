import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ObjectIdType } from '../../common/mongo/object-id';

export type PushSubscriptionDocument = HydratedDocument<PushSubscription>;

/** The two keys the browser mints per subscription; the push service needs both. */
@Schema({ _id: false })
export class PushSubscriptionKeysSubdoc {
  @Prop({ required: true, trim: true })
  p256dh: string;

  @Prop({ required: true, trim: true })
  auth: string;
}

export const PushSubscriptionKeysSchema = SchemaFactory.createForClass(
  PushSubscriptionKeysSubdoc,
);

/**
 * One browser's web-push subscription (PAC-154, PR4).
 *
 * A user has several — one per device and browser profile — and the worker
 * sends to every live one. The row is identified by {@link endpoint}: a
 * device re-subscribing upserts its own row, and a shared machine signing in
 * as someone else moves the row to the new user, so the previous user's
 * pushes stop (`PushSubscriptionsService.upsert`).
 *
 * ## Soft-deleted, never removed
 *
 * The push service answers `404`/`410` for a subscription the browser has
 * dropped; the worker then sets {@link deletedAt} (PAC-155 rule — nothing is
 * ever hard-deleted). The unique index on `endpoint` is **partial on
 * `deletedAt: null`**, which is what lets the same device subscribe again
 * later without tripping E11000.
 *
 * ## `deletedAt` is an explicit null
 *
 * Mongo 7 partial filters do not accept `{ deletedAt: null }` equality, so
 * the filter is `{ $type: 'null' }` (house rule: `$type`, never `sparse`) —
 * and a `$type: 'null'` filter only sees a document that *stores* a BSON
 * null. The schema default is what writes it, so every writer must go through
 * the model (`create`, `findOneAndUpdate` with defaults, `insertMany`) and
 * never a raw `collection.insertOne`.
 *
 * Not a `TenantRecord`: a platform admin subscribes too, and the owner is
 * {@link userId}, which every read filters on. `authorshipPlugin` has no
 * paths to stamp here.
 */
@Schema({ timestamps: true, collection: 'pushSubscriptions' })
export class PushSubscription {
  @Prop({ type: ObjectIdType, ref: 'User', required: true })
  userId: Types.ObjectId;

  /** The push service URL. The identity of the row. */
  @Prop({ required: true, trim: true })
  endpoint: string;

  @Prop({ type: PushSubscriptionKeysSchema, required: true })
  keys: PushSubscriptionKeysSubdoc;

  /** For telling devices apart in support, nothing else. */
  @Prop({ type: String, default: null })
  userAgent: string | null;

  /** Last time the push service accepted a message for this row. */
  @Prop({ type: Date, default: null })
  lastSuccessAt: Date | null;

  /** Set by the worker on a 404/410, or by the user unsubscribing. */
  @Prop({ type: Date, default: null })
  deletedAt: Date | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export const PushSubscriptionSchema =
  SchemaFactory.createForClass(PushSubscription);

/**
 * One live row per endpoint. Partial so a soft-deleted row does not block the
 * device from subscribing again — see the class note on why `$type`.
 */
PushSubscriptionSchema.index(
  { endpoint: 1 },
  {
    unique: true,
    partialFilterExpression: { deletedAt: { $type: 'null' } },
  },
);

/** The worker's fan-out read: every live subscription of one user. */
PushSubscriptionSchema.index({ userId: 1, deletedAt: 1 });
