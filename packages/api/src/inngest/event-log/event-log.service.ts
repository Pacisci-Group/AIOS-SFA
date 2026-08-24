import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  eventLogRetentionDays,
  eventLogStaleMinutes,
} from '../../config/event-log.config';
import { EventLogEntry, type EventLogEntryDocument } from './event-log.schema';

/** What the sweeper needs to replay a row. */
export interface ReplayableEvent {
  id: string;
  eventName: string;
  payload: Record<string, unknown>;
}

/**
 * Reads and writes the durable outbox.
 *
 * A normal `@Injectable` on purpose. The middleware that calls the two `mark*`
 * methods cannot itself be injected — Inngest constructs middleware classes
 * with only `{ client }` — so `event-log.middleware.ts` closes over an instance
 * of this rather than reaching for a module-level singleton. That keeps the
 * logic testable and the wiring inside Nest's container.
 */
@Injectable()
export class EventLogService {
  private readonly logger = new Logger(EventLogService.name);

  constructor(
    @InjectModel(EventLogEntry.name)
    private readonly entries: Model<EventLogEntry>,
    private readonly config: ConfigService,
  ) {}

  /**
   * Write the row that makes an event recoverable.
   *
   * Called by `InngestService.send` **before** `client.send()`. The ordering is
   * the entire point: write afterwards and a crash in between loses the row;
   * write only on success and the emit gap is exactly as open as it was.
   *
   * The id is minted by the caller because it doubles as the event's Inngest
   * `id` — see `InngestService.send`.
   */
  async recordPending(
    id: Types.ObjectId,
    eventName: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.entries.create({
      _id: id,
      eventName,
      payload,
      status: 'pending',
      // Tenancy is read off the payload rather than passed separately: every
      // event that belongs to a tenant already carries these, and requiring
      // producers to repeat them would be a second place to get them wrong.
      agencyId: readString(payload, 'agencyId'),
      branchId: readString(payload, 'branchId'),
    });
  }

  /** Terminal: the run completed. */
  async markSucceeded(
    eventLogId: string,
    runId: string | null,
    attempts: number,
  ): Promise<void> {
    await this.markTerminal(eventLogId, 'succeeded', runId, attempts, '');
  }

  /**
   * Terminal: the run failed and will not be retried.
   *
   * Only ever called with a final attempt — see the guard in
   * `event-log.middleware.ts`.
   */
  async markFailed(
    eventLogId: string,
    runId: string | null,
    attempts: number,
    error: string,
  ): Promise<void> {
    await this.markTerminal(eventLogId, 'failed', runId, attempts, error);
    this.logger.warn(
      `Event ${eventLogId} failed after ${attempts + 1} attempt(s) — ${error}`,
    );
  }

  /**
   * Rows that were emitted but never reached a terminal state.
   *
   * `createdAt` rather than `updatedAt`: a `pending` row is never touched after
   * insert, so the two are identical, and `createdAt` is the field the compound
   * index is built on.
   */
  async findStale(limit = 100): Promise<ReplayableEvent[]> {
    const staleMinutes = eventLogStaleMinutes(
      this.config.get<string>('EVENT_LOG_STALE_MINUTES'),
    );
    const cutoff = new Date(Date.now() - staleMinutes * 60 * 1000);

    const rows = await this.entries
      .find({ status: 'pending', createdAt: { $lt: cutoff } })
      .sort({ createdAt: 1 })
      .limit(limit)
      .lean();

    return rows.map((row) => ({
      id: row._id.toString(),
      eventName: row.eventName,
      payload: row.payload,
    }));
  }

  /** Bump the diagnostic counter after a sweeper replay. */
  async markResent(eventLogId: string): Promise<void> {
    await this.entries.updateOne(
      { _id: eventLogId },
      { $inc: { resendCount: 1 } },
    );
  }

  /** Test/diagnostic read. */
  findById(eventLogId: string): Promise<EventLogEntryDocument | null> {
    return this.entries.findById(eventLogId).exec();
  }

  private async markTerminal(
    eventLogId: string,
    status: 'succeeded' | 'failed',
    runId: string | null,
    attempts: number,
    lastError: string,
  ): Promise<void> {
    const retentionDays = eventLogRetentionDays(
      this.config.get<string>('EVENT_LOG_RETENTION_DAYS'),
    );

    await this.entries.updateOne(
      { _id: eventLogId },
      {
        status,
        runId,
        attempts,
        lastError,
        // Written here and nowhere else. A row only becomes eligible for the TTL
        // reaper once it is terminal, which is what stops a stuck `pending` row
        // being deleted before the sweeper can act on it.
        expiresAt: new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000),
      },
    );
  }
}

/** Pull a tenancy id off a payload without assuming any event's shape. */
function readString(
  payload: Record<string, unknown>,
  key: string,
): string | null {
  const value = payload[key];
  return typeof value === 'string' ? value : null;
}
