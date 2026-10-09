import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  NotificationRenderError,
  renderNotification,
  type RenderedNotification,
} from '@sfa/shared';
import { NonRetriableError } from 'inngest';
import { Model, Types } from 'mongoose';
import { NotificationBus } from '../../common/redis/notification-bus';
import {
  notificationRequested,
  type NotificationRequestedData,
} from '../../inngest/events';
import {
  INNGEST_CLIENT,
  type InngestClient,
} from '../../inngest/inngest.client';
import {
  InngestFunction,
  type InngestFunctionProvider,
} from '../../inngest/inngest-registry.service';
import {
  Notification,
  NotificationDocument,
} from '../../notifications/schemas/notification.schema';

/**
 * The sole writer of the `notifications` collection (PAC-154, decision 1).
 *
 * Every producer — an API feature service or another worker function — emits
 * `notification/requested.v1` and this function does the rest: render the text
 * once, insert one row per recipient, then fan out to the secondary channels.
 * The channels arrive one PR at a time as further steps: `publish` (SSE nudge,
 * PR2, below), `email` (PR3), `push` (PR4). Each is its own `step.run` so a
 * crash in one never re-runs the ones before it.
 *
 * ## The nudge carries ids only
 *
 * `publish` tells the API tier `{ recipientId, notificationId }` and nothing
 * else; whichever node holds the recipient's stream re-reads the row before
 * writing the frame. A replayed step re-nudges, and the client invalidates
 * rather than appends, so a duplicate nudge is harmless by construction.
 *
 * ## Exactly once, twice over
 *
 * `idempotency: 'event.data.dedupeKey'` collapses duplicate events for 24
 * hours. The unique `{ recipientId, dedupeKey }` index does so forever, which
 * is what makes a cron trigger that reuses its key across days safe. The insert
 * tolerates the E11000 that index produces and re-reads the rows that exist,
 * so a retry after a partial insert converges rather than failing.
 */
@Injectable()
@InngestFunction()
export class DeliverNotificationFn implements InngestFunctionProvider {
  private readonly logger = new Logger(DeliverNotificationFn.name);

  constructor(
    @Inject(INNGEST_CLIENT) private readonly inngest: InngestClient,
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<NotificationDocument>,
    private readonly bus: NotificationBus,
  ) {}

  build() {
    return this.inngest.createFunction(
      {
        id: 'deliver-notification',
        name: 'Deliver notification',
        triggers: [notificationRequested],
        idempotency: 'event.data.dedupeKey',
        /**
         * Three attempts. The insert is idempotent, so retrying is free; the
         * only thing a retry rides out is a Mongo blip. A render failure is a
         * programming error and short-circuits this with `NonRetriableError`.
         */
        retries: 3,
        /**
         * Enforced server-side across every worker process. Bursty producers
         * (a cron fanning out to a whole agency) should not starve the email
         * and campaign functions of worker capacity.
         */
        concurrency: { limit: 10 },
      },
      ({ event, step }) => this.handle(event, step),
    );
  }

  /**
   * The handler body, lifted out so a test can call it with an inline `step`
   * (same seam as `SendInviteEmailFn`).
   */
  async handle(
    event: { id?: string; name: string; data: NotificationRequestedData },
    step: StepLike,
  ): Promise<{ notificationIds: string[] }> {
    // Plain JSON only out of a step: Inngest serialises the result, so the
    // ids come back as hex strings, never `ObjectId`s.
    const inserted = (await step.run('insert', () =>
      this.insert(event.data),
    )) as InsertResult;

    // Best-effort by contract (the bus swallows transport errors), so this
    // step cannot fail the run; it is a step at all so a retry of a later
    // channel does not nudge every tab a second time.
    await step.run('publish', () => this.publish(inserted.rows));

    return { notificationIds: inserted.rows.map((row) => row.id) };
  }

  /**
   * Render once, insert one row per distinct recipient, return every row that
   * now exists for this `dedupeKey` — whether this call inserted it or an
   * earlier attempt did.
   */
  async insert(data: NotificationRequestedData): Promise<InsertResult> {
    const rendered = this.render(data);
    const recipientIds = [...new Set(data.recipientIds)].map(
      (id) => new Types.ObjectId(id),
    );

    const docs = recipientIds.map((recipientId) => ({
      recipientId,
      agencyId: data.agencyId ? new Types.ObjectId(data.agencyId) : null,
      type: data.type,
      title: rendered.title,
      body: rendered.body,
      href: rendered.href,
      entity: { kind: data.entity.kind, id: data.entity.id },
      actorId: data.actorId ? new Types.ObjectId(data.actorId) : null,
      data: data.data,
      readAt: null,
      dedupeKey: data.dedupeKey,
    }));

    try {
      // Unordered: a duplicate for one recipient must not stop the inserts for
      // the others. Mongoose still throws afterwards, which is caught below.
      await this.notificationModel.insertMany(docs, { ordered: false });
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err;
      this.logger.log(
        `Some rows for ${data.dedupeKey} already existed; keeping them.`,
      );
    }

    const rows = await this.notificationModel
      .find({ recipientId: { $in: recipientIds }, dedupeKey: data.dedupeKey })
      .select({ _id: 1, recipientId: 1 })
      .lean<Array<{ _id: Types.ObjectId; recipientId: Types.ObjectId }>>();

    return {
      rows: rows.map((row) => ({
        id: row._id.toHexString(),
        recipientId: row.recipientId.toHexString(),
      })),
    };
  }

  /**
   * One nudge per row, all in flight at once. Returns a count so the step
   * result is plain JSON.
   *
   * Concurrent, not sequential, because a publish is best-effort and the bus
   * swallows its own failures: while Redis is unreachable each PUBLISH waits
   * out a full ioredis reconnect cycle before it is rejected, and awaiting
   * them one by one would make a broadcast to N recipients pay that wait N
   * times — minutes, holding a worker slot, with the email and push steps
   * queued behind it. Issued together they share one wait.
   */
  async publish(rows: InsertedRow[]): Promise<{ published: number }> {
    await Promise.all(
      rows.map((row) =>
        this.bus.publish({
          recipientId: row.recipientId,
          notificationId: row.id,
        }),
      ),
    );
    return { published: rows.length };
  }

  private render(data: NotificationRequestedData): RenderedNotification {
    try {
      return renderNotification(data.type, data.data);
    } catch (err) {
      // A type the catalog does not know, or a bad href: no retry can fix
      // either, and Inngest should show it as a failure, not a hung run.
      if (err instanceof NotificationRenderError) {
        throw new NonRetriableError(err.message, { cause: err });
      }
      throw err;
    }
  }
}

/**
 * E11000 from an unordered `insertMany`: either the top-level code, or every
 * write error being one (Mongoose reports a bulk failure either way depending
 * on how many rows collided).
 */
function isDuplicateKeyError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const candidate = err as {
    code?: unknown;
    writeErrors?: Array<{ code?: unknown }>;
  };
  if (candidate.code === 11000) return true;
  return (
    Array.isArray(candidate.writeErrors) &&
    candidate.writeErrors.length > 0 &&
    candidate.writeErrors.every((writeError) => writeError.code === 11000)
  );
}

/** One stored row, as the `insert` step reports it to the later steps. */
export interface InsertedRow {
  id: string;
  recipientId: string;
}

interface InsertResult {
  rows: InsertedRow[];
}

/** The slice of Inngest's step tooling this handler uses — the test seam. */
interface StepLike {
  run<T>(id: string, fn: () => Promise<T> | T): Promise<unknown>;
}
