import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { NotificationRecord } from '@sfa/shared';
import { defer, finalize, Observable, Subject } from 'rxjs';
import {
  NotificationBus,
  NotificationNudge,
} from '../../common/redis/notification-bus';
import { NotificationsService } from '../notifications.service';

/**
 * How many streams one user may hold open on one node.
 *
 * The stream skips every throttler (a reconnect wave must not 429 the badge),
 * so this is the only thing that bounds it. Each open stream is a request
 * that ran the full guard chain and now holds a file descriptor on the edge,
 * nginx and the API for up to a token lifetime; a reconnect loop with a bug
 * in it, or one token used on purpose, could otherwise open thousands. A
 * person has a few tabs, and a hidden tab drops its stream, so eight is
 * generous. The ninth is a `429` the client backs off from (PR2 review).
 */
export const MAX_STREAMS_PER_USER = 8;

/**
 * Which users this process is holding an SSE stream for, and the pipe from
 * the bus into each (PAC-154 PR2).
 *
 * ## One subscription to the bus, many streams
 *
 * The bus carries every nudge for every user on the platform; this registry
 * is the filter. It subscribes once at module init and routes each nudge to
 * the Subjects registered under its `recipientId` — a user with no stream on
 * this node costs a `Map` miss and nothing else.
 *
 * ## One read per nudge, however many tabs
 *
 * A nudge carries ids only; the stored row is re-read here, once, and the
 * same record is handed to every stream of that user. The read used to live
 * in the controller, per stream, so a user with three tabs cost three
 * identical reads per notification and a broadcast multiplied that across
 * recipients (PR2 review). A read that fails drops that one nudge for that
 * user — logged, never an error on the stream, which would end it and hand
 * the browser the driver's message.
 *
 * ## Bookkeeping is tied to the subscription, not to a call
 *
 * {@link open} returns a cold observable: the Subject is created and
 * registered when Nest subscribes (the connection is live) and removed by
 * `finalize` when the subscription ends — the client went away, the server
 * closed the stream at the token's `exp`, or the app shut down. There is no
 * `close()` to forget to call, and an empty Set is deleted so the map never
 * grows with users who left.
 *
 * ## Shutdown ends every stream
 *
 * `onModuleDestroy` completes each Subject *and* fires {@link closed$}. The
 * controller merges a stream with an endless heartbeat, so completing the
 * Subject alone would not complete the merged observable and `app.close()`
 * would wait for every token to expire (PR2 review).
 */
@Injectable()
export class NotificationStreamRegistry
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(NotificationStreamRegistry.name);
  private readonly streams = new Map<
    string,
    Set<Subject<NotificationRecord>>
  >();
  private readonly closedSubject = new Subject<void>();
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly bus: NotificationBus,
    private readonly service: NotificationsService,
  ) {}

  /** Emits once, when the module shuts down. `takeUntil` this on every stream. */
  get closed$(): Observable<void> {
    return this.closedSubject.asObservable();
  }

  onModuleInit(): void {
    this.unsubscribe = this.bus.subscribe((nudge) => {
      void this.dispatch(nudge);
    });
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const subjects of this.streams.values()) {
      for (const subject of subjects) subject.complete();
    }
    this.streams.clear();
    this.closedSubject.next();
    this.closedSubject.complete();
  }

  /** Whether `userId` is under {@link MAX_STREAMS_PER_USER} on this node. */
  canOpen(userId: string): boolean {
    return this.size(userId) < MAX_STREAMS_PER_USER;
  }

  /**
   * The rows addressed to `userId`, as the bus announces them, for as long as
   * somebody is listening.
   */
  open(userId: string): Observable<NotificationRecord> {
    return defer(() => {
      const subject = new Subject<NotificationRecord>();
      this.add(userId, subject);
      return subject.pipe(finalize(() => this.remove(userId, subject)));
    });
  }

  /**
   * Re-read the row once and fan it out to every stream this node holds for
   * its recipient. Public as a test seam.
   */
  async dispatch(nudge: NotificationNudge): Promise<void> {
    if (!this.streams.has(nudge.recipientId)) return;

    let row: NotificationRecord | null;
    try {
      row = await this.service.findForStream(
        nudge.notificationId,
        nudge.recipientId,
      );
    } catch (err) {
      this.logger.warn(
        `Dropped a stream frame for ${nudge.notificationId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return;
    }
    // A nudge for a row that is not the recipient's is dropped here.
    if (!row) return;

    // Looked up again: a stream may have closed while the row was read.
    const subjects = this.streams.get(nudge.recipientId);
    if (!subjects) return;
    for (const subject of subjects) subject.next(row);
  }

  /** How many streams are open — for one user, or in total. A test seam. */
  size(userId?: string): number {
    if (userId !== undefined) return this.streams.get(userId)?.size ?? 0;
    let total = 0;
    for (const subjects of this.streams.values()) total += subjects.size;
    return total;
  }

  private add(userId: string, subject: Subject<NotificationRecord>): void {
    let subjects = this.streams.get(userId);
    if (!subjects) {
      subjects = new Set();
      this.streams.set(userId, subjects);
    }
    subjects.add(subject);
  }

  private remove(userId: string, subject: Subject<NotificationRecord>): void {
    const subjects = this.streams.get(userId);
    if (!subjects) return;
    subjects.delete(subject);
    if (subjects.size === 0) this.streams.delete(userId);
  }
}
