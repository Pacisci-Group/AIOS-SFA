import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type {
  MarkAllNotificationsReadResponse,
  NotificationListResponse,
  NotificationRecord,
  UnreadCountResponse,
} from '@sfa/shared';
import { FilterQuery, Model, Types } from 'mongoose';
import {
  Notification,
  NotificationDocument,
} from './schemas/notification.schema';

export interface NotificationListOptions {
  cursor?: string;
  unread: boolean;
  limit: number;
}

interface NotificationCursor {
  createdAt: Date;
  id: Types.ObjectId;
}

type LeanNotification = Notification & { _id: Types.ObjectId };

/** Newest first, `_id` as the tiebreak for rows created in the same millisecond. */
const NEWEST_FIRST = { createdAt: -1, _id: -1 } as const;

/**
 * The page cursor: `<createdAt ISO>|<_id hex>`, base64url so it survives a
 * query string untouched. Opaque to clients by contract, but deliberately
 * readable in a debugger.
 */
export function encodeNotificationCursor(
  createdAt: Date,
  id: Types.ObjectId,
): string {
  return Buffer.from(
    `${createdAt.toISOString()}|${id.toHexString()}`,
    'utf8',
  ).toString('base64url');
}

/**
 * Null for anything that is not exactly what {@link encodeNotificationCursor}
 * produces. `Buffer.from(_, 'base64url')` never throws — it drops bytes it
 * cannot read — so the shape check after it is the real validation.
 */
export function decodeNotificationCursor(
  cursor: string,
): NotificationCursor | null {
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  const [iso, hex, ...rest] = decoded.split('|');
  if (rest.length > 0 || !iso || !hex) return null;
  if (hex.length !== 24 || !Types.ObjectId.isValid(hex)) return null;
  const createdAt = new Date(iso);
  if (Number.isNaN(createdAt.getTime()) || createdAt.toISOString() !== iso) {
    return null;
  }
  return { createdAt, id: new Types.ObjectId(hex) };
}

function toRecord(doc: LeanNotification): NotificationRecord {
  return {
    id: doc._id.toHexString(),
    type: doc.type,
    title: doc.title,
    body: doc.body,
    href: doc.href,
    entity: { kind: doc.entity.kind, id: doc.entity.id },
    actorId: doc.actorId ? doc.actorId.toHexString() : null,
    agencyId: doc.agencyId ? doc.agencyId.toHexString() : null,
    data: doc.data ?? {},
    readAt: doc.readAt ? doc.readAt.toISOString() : null,
    createdAt: (doc.createdAt ?? new Date(0)).toISOString(),
  };
}

/**
 * Reading and marking the caller's own notifications (PAC-154).
 *
 * ## Scoped to the recipient, always
 *
 * Every query here filters on `recipientId`, and the id comes from the resolved
 * `AccessContext` — never from the request. That is the whole isolation story
 * for this collection (it does not extend `TenantRecord`), and it is also why
 * impersonation needs no code: `AccessContextGuard` resolves the *target's*
 * context, so an operator acting as a user sees, and marks read, exactly what
 * the user would (ticket decision 6).
 *
 * ## No module permission
 *
 * A notification is addressed to you (ticket decision 8). The page its `href`
 * opens keeps its own `RequirePermission`; this service only says what you
 * were told, not whether you may act on it.
 *
 * ## Never writes a new row
 *
 * The worker's `deliver-notification.fn.ts` is the sole writer. The API only
 * flips `readAt`.
 */
@Injectable()
export class NotificationsService {
  constructor(
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<NotificationDocument>,
  ) {}

  async list(
    userId: string,
    options: NotificationListOptions,
  ): Promise<NotificationListResponse> {
    const filter: FilterQuery<NotificationDocument> = {
      recipientId: new Types.ObjectId(userId),
    };
    if (options.unread) filter.readAt = null;

    if (options.cursor) {
      const cursor = decodeNotificationCursor(options.cursor);
      if (!cursor) throw new BadRequestException('Invalid cursor.');
      // Strictly older, or the same instant with a smaller `_id` — the keyset
      // predicate matching `NEWEST_FIRST`. Both branches ride the recipient
      // indexes, which end in `createdAt: -1, _id: -1` for this reason.
      filter.$or = [
        { createdAt: { $lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, _id: { $lt: cursor.id } },
      ];
    }

    // One more than asked for, to know whether a next page exists without a
    // count query. The extra row is never returned.
    const rows = await this.notificationModel
      .find(filter)
      .sort(NEWEST_FIRST)
      .limit(options.limit + 1)
      .lean<LeanNotification[]>();

    const page = rows.slice(0, options.limit);
    const last = page[page.length - 1];
    const nextCursor =
      rows.length > options.limit && last
        ? encodeNotificationCursor(last.createdAt ?? new Date(0), last._id)
        : null;

    return { items: page.map(toRecord), nextCursor };
  }

  async unreadCount(userId: string): Promise<UnreadCountResponse> {
    const unread = await this.notificationModel.countDocuments({
      recipientId: new Types.ObjectId(userId),
      readAt: null,
    });
    return { unread };
  }

  /**
   * Mark one row read. Idempotent: an already-read row is returned as-is with
   * its original `readAt`, because a second click is not a second fact.
   * Somebody else's row is a 404, not a 403 — the id tells the caller nothing.
   */
  async markRead(userId: string, id: string): Promise<NotificationRecord> {
    if (id.length !== 24 || !Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Notification not found.');
    }
    const owned = {
      _id: new Types.ObjectId(id),
      recipientId: new Types.ObjectId(userId),
    };

    await this.notificationModel.updateOne(
      { ...owned, readAt: null },
      { $set: { readAt: new Date() } },
    );

    const row = await this.notificationModel
      .findOne(owned)
      .lean<LeanNotification>();
    if (!row) throw new NotFoundException('Notification not found.');
    return toRecord(row);
  }

  async markAllRead(userId: string): Promise<MarkAllNotificationsReadResponse> {
    const result = await this.notificationModel.updateMany(
      { recipientId: new Types.ObjectId(userId), readAt: null },
      { $set: { readAt: new Date() } },
    );
    return { updated: result.modifiedCount };
  }

  /**
   * One row by id, for the SSE stream (PR2): the worker publishes ids only and
   * the API node re-reads the row, so every channel renders the stored text.
   * Null when it is not the caller's — a nudge for somebody else is dropped.
   */
  async findForStream(
    id: string,
    userId: string,
  ): Promise<NotificationRecord | null> {
    if (id.length !== 24 || !Types.ObjectId.isValid(id)) return null;
    const row = await this.notificationModel
      .findOne({
        _id: new Types.ObjectId(id),
        recipientId: new Types.ObjectId(userId),
      })
      .lean<LeanNotification>();
    return row ? toRecord(row) : null;
  }
}
