import { NOTIFICATION_TYPE_KEYS, type NotificationType } from '@sfa/shared';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ObjectIdType } from '../../common/mongo/object-id';

export type NotificationDocument = HydratedDocument<Notification>;

export const NOTIFICATION_CHANNEL_STATUSES = [
  'sent',
  'failed',
  'skipped',
] as const;
export type NotificationChannelStatus =
  (typeof NOTIFICATION_CHANNEL_STATUSES)[number];

/** What the notification is about. Deep-link target; collapse key later. */
@Schema({ _id: false })
export class NotificationEntitySubdoc {
  @Prop({ required: true, trim: true })
  kind: string;

  @Prop({ required: true, trim: true })
  id: string;
}

export const NotificationEntitySchema = SchemaFactory.createForClass(
  NotificationEntitySubdoc,
);

/**
 * One secondary channel's outcome (PAC-148 FR-H4: per-channel delivery status).
 * A failed channel never touches the in-app row — it is only recorded here.
 */
@Schema({ _id: false })
export class NotificationChannelDeliverySubdoc {
  @Prop({ required: true, type: String, enum: NOTIFICATION_CHANNEL_STATUSES })
  status: NotificationChannelStatus;

  @Prop({ type: Date, default: null })
  at: Date | null;

  @Prop({ type: String, default: null })
  error: string | null;

  /** The `emailMessages` row, for the email channel. */
  @Prop({ type: String, default: null })
  emailMessageId: string | null;
}

export const NotificationChannelDeliverySchema = SchemaFactory.createForClass(
  NotificationChannelDeliverySubdoc,
);

@Schema({ _id: false })
export class NotificationDeliverySubdoc {
  @Prop({ type: NotificationChannelDeliverySchema, default: null })
  push: NotificationChannelDeliverySubdoc | null;

  @Prop({ type: NotificationChannelDeliverySchema, default: null })
  email: NotificationChannelDeliverySubdoc | null;
}

export const NotificationDeliverySchema = SchemaFactory.createForClass(
  NotificationDeliverySubdoc,
);

/**
 * One notification for one recipient (PAC-154).
 *
 * ## Why this does not extend `TenantRecord`
 *
 * A platform admin is a recipient (a bug report filed, PAC-82) and has no
 * agency and no branch, which `TenantRecord` requires. Isolation is by
 * {@link recipientId}: every read path filters on it, and nothing else about
 * this collection is tenant-scoped. `agencyId` is context, not a tenancy key.
 * `authorshipPlugin` does not stamp it (no `createdBy`/`updatedBy` paths) —
 * the writer is the worker, which has no request context anyway.
 *
 * ## Written once, by one function
 *
 * `deliver-notification.fn.ts` is the only writer of new rows; the API only
 * flips {@link readAt}. `title`/`body`/`href` are rendered **at write time**
 * by the shared renderer so every channel shows the same words.
 *
 * ## `readAt` is a date with an explicit null
 *
 * Unread is `readAt: null`, stored as a real BSON null by the schema default so
 * the covered unread index sees every row the same way. Never a boolean: when
 * it was read is a fact a boolean throws away.
 *
 * No TTL — rows are kept forever (ticket decision 7). Revisit with a TTL
 * migration only if the per-recipient index ever becomes a problem.
 */
@Schema({ timestamps: true, collection: 'notifications' })
export class Notification {
  /** The one index-driving field. */
  @Prop({ type: ObjectIdType, ref: 'User', required: true })
  recipientId: Types.ObjectId;

  /** Context, not a tenancy key. Null for a platform-level notification. */
  @Prop({ type: ObjectIdType, ref: 'Agency', default: null })
  agencyId: Types.ObjectId | null;

  @Prop({ required: true, type: String, enum: NOTIFICATION_TYPE_KEYS })
  type: NotificationType;

  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ required: true, trim: true })
  body: string;

  /** App-relative path. The email channel prefixes the tenant host. */
  @Prop({ required: true, trim: true })
  href: string;

  @Prop({ type: NotificationEntitySchema, required: true })
  entity: NotificationEntitySubdoc;

  /** Null means the system caused it. */
  @Prop({ type: ObjectIdType, ref: 'User', default: null })
  actorId: Types.ObjectId | null;

  /** The producer's per-type payload, kept for future client-side rendering. */
  @Prop({ type: Object, default: {} })
  data: Record<string, unknown>;

  @Prop({ type: Date, default: null })
  readAt: Date | null;

  @Prop({ type: NotificationDeliverySchema, default: {} })
  delivery: NotificationDeliverySubdoc;

  /** Copied from the event for traceability, and the unique key below. */
  @Prop({ required: true, trim: true })
  dedupeKey: string;

  createdAt?: Date;
  updatedAt?: Date;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);

/**
 * The unread list and the unread count, covered: `{ recipientId, readAt: null }`
 * sorted newest first. `_id` is in the key because it is the cursor's tiebreak.
 */
NotificationSchema.index({ recipientId: 1, readAt: 1, createdAt: -1, _id: -1 });

/** The All tab: everything for one recipient, newest first. */
NotificationSchema.index({ recipientId: 1, createdAt: -1, _id: -1 });

/**
 * Exactly once, durably.
 *
 * Inngest's function-level `idempotency` collapses duplicate events for 24
 * hours only. A cron-driven trigger reuses its `dedupeKey` across days
 * (`timeoff.overdue:<id>:day1`), and a producer retried after a long outage
 * re-emits an old key — this index is what makes both safe. The writer
 * tolerates the E11000 it produces and re-reads the rows it did insert.
 */
NotificationSchema.index({ recipientId: 1, dedupeKey: 1 }, { unique: true });
