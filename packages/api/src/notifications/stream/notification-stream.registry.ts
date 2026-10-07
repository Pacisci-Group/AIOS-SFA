import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { defer, finalize, Observable, Subject } from 'rxjs';
import {
  NotificationBus,
  NotificationNudge,
} from '../../common/redis/notification-bus';

/**
 * Which users this process is holding an SSE stream for, and the pipe from
 * the bus into each (PAC-154 PR2).
 *
 * ## One subscription to the bus, many streams
 *
 * The bus carries every nudge for every user on the platform; this registry
 * is the filter. It subscribes once at module init and routes each nudge to
 * the Subjects registered under its `recipientId` — a user with no stream on
 * this node costs a `Map` miss and nothing else. A user with three tabs has
 * three Subjects under one key, each fed once.
 *
 * ## Bookkeeping is tied to the subscription, not to a call
 *
 * {@link open} returns a cold observable: the Subject is created and
 * registered when Nest subscribes (the connection is live) and removed by
 * `finalize` when the subscription ends — the client went away, the server
 * closed the stream at the token's `exp`, or the app shut down. There is no
 * `close()` to forget to call, and an empty Set is deleted so the map never
 * grows with users who left.
 */
@Injectable()
export class NotificationStreamRegistry
  implements OnModuleInit, OnModuleDestroy
{
  private readonly streams = new Map<string, Set<Subject<NotificationNudge>>>();
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly bus: NotificationBus) {}

  onModuleInit(): void {
    this.unsubscribe = this.bus.subscribe((nudge) => this.dispatch(nudge));
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const subjects of this.streams.values()) {
      for (const subject of subjects) subject.complete();
    }
    this.streams.clear();
  }

  /** The nudges addressed to `userId`, for as long as somebody is listening. */
  open(userId: string): Observable<NotificationNudge> {
    return defer(() => {
      const subject = new Subject<NotificationNudge>();
      this.add(userId, subject);
      return subject.pipe(finalize(() => this.remove(userId, subject)));
    });
  }

  /** Fan one nudge out to every stream this node holds for its recipient. */
  dispatch(nudge: NotificationNudge): void {
    const subjects = this.streams.get(nudge.recipientId);
    if (!subjects) return;
    for (const subject of subjects) subject.next(nudge);
  }

  /** How many streams are open — for one user, or in total. A test seam. */
  size(userId?: string): number {
    if (userId !== undefined) return this.streams.get(userId)?.size ?? 0;
    let total = 0;
    for (const subjects of this.streams.values()) total += subjects.size;
    return total;
  }

  private add(userId: string, subject: Subject<NotificationNudge>): void {
    let subjects = this.streams.get(userId);
    if (!subjects) {
      subjects = new Set();
      this.streams.set(userId, subjects);
    }
    subjects.add(subject);
  }

  private remove(userId: string, subject: Subject<NotificationNudge>): void {
    const subjects = this.streams.get(userId);
    if (!subjects) return;
    subjects.delete(subject);
    if (subjects.size === 0) this.streams.delete(userId);
  }
}
