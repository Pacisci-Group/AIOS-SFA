import {
  Controller,
  Get,
  HttpCode,
  Logger,
  type MessageEvent,
  Param,
  Patch,
  Post,
  Query,
  Sse,
} from '@nestjs/common';
import type {
  AccessContext,
  JwtPayload,
  MarkAllNotificationsReadResponse,
  NotificationListResponse,
  NotificationRecord,
  UnreadCountResponse,
} from '@sfa/shared';
import {
  catchError,
  EMPTY,
  filter,
  from,
  interval,
  map,
  merge,
  mergeMap,
  type Observable,
  of,
  takeUntil,
  timer,
} from 'rxjs';
import {
  SkipBranch,
  SkipModule,
  SkipTenant,
} from '../common/decorators/access.decorators';
import { SkipAllThrottlers } from '../common/decorators/throttle.decorators';
import { Access, CurrentUser } from '../common/decorators/user.decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  listNotificationsSchema,
  type ListNotificationsDto,
} from './dto/notifications.dto';
import { NotificationsService } from './notifications.service';
import { NotificationStreamRegistry } from './stream/notification-stream.registry';

/**
 * How often the stream sends a `ping` while nothing happens. Load-bearing:
 * the DigitalOcean balancer and the edge both drop a connection that stays
 * silent past their idle timeout (60 s is the common default), and a dropped
 * stream is a reconnect, a refetch, and a gap. 25 s clears every hop with
 * room to spare.
 */
export const STREAM_PING_MS = 25_000;

/** What the client should wait before reconnecting after a close. */
const STREAM_RETRY_MS = 3_000;

/**
 * Closed this long before the token's `exp`, so the server ends the stream
 * cleanly and the client reconnects with a refreshed token — rather than the
 * JWT guard refusing the reconnect of a token that expired mid-flight.
 */
const STREAM_EXP_MARGIN_MS = 1_000;

/**
 * The caller's own notifications (PAC-154).
 *
 * ## The guard stack, and why it is this permissive
 *
 * Authenticated, and nothing more — the same shape as `bug-reports`. No
 * `@RequirePermissions` (a notification is addressed to you, ticket decision
 * 8); `@SkipModule()` because it is not a feature of any module; `@SkipTenant()`
 * and `@SkipBranch()` because a platform admin — who has neither — is a
 * recipient the day a bug report is filed. Identity is `request.access.userId`,
 * resolved from the database on every request; nothing here is client-supplied.
 *
 * Impersonation is deliberately not special-cased: the resolved context *is*
 * the impersonated user's, so an operator sees and marks exactly what they
 * would (ticket decision 6).
 */
@Controller('notifications')
@SkipTenant()
@SkipBranch()
@SkipModule()
export class NotificationsController {
  private readonly logger = new Logger(NotificationsController.name);

  constructor(
    private readonly service: NotificationsService,
    private readonly registry: NotificationStreamRegistry,
  ) {}

  /**
   * The live stream (PAC-154, decision 3): one Server-Sent Events connection
   * per tab, carrying every notification addressed to the caller as it is
   * written.
   *
   * ## Frames
   *
   * - `ready` — the first frame, sent at once. Nest commits the response
   *   headers lazily on the first message; without this a quiet user would
   *   sit on an uncommitted response that a proxy may hold indefinitely. The
   *   client treats every open as a reason to refetch the count and the list,
   *   which is what makes the lossy bus behind this acceptable.
   * - `ping` — every {@link STREAM_PING_MS}. A named event rather than an SSE
   *   comment because Nest's `MessageEvent` cannot emit a bare `: ping`; the
   *   effect on idle timeouts is the same, and the client ignores it.
   * - `notification` — the stored row, re-read by id after the worker's
   *   nudge. `id:` is the row id. A nudge for a row that is not the caller's
   *   is dropped by `findForStream`.
   *
   * ## Authentication, and why it is checked once
   *
   * Every global guard runs, at connect: a Bearer header from the
   * fetch-based client (native `EventSource` cannot set one, and a token in
   * the URL would land in every proxy log). Nothing re-checks `tokenVersion`
   * mid-stream; instead the stream ends itself at the token's `exp` — 15
   * minutes at most — and the client reconnects with a refreshed token. A
   * password reset therefore stops the old session's stream within one token
   * lifetime, which is the same bound every other request already lives under
   * between refreshes.
   *
   * ## What is deliberately not here
   *
   * `@Header('Cache-Control')` / `@Header('X-Accel-Buffering')`: Nest's
   * `SseStream` writes both (plus `no-transform` and `Connection: keep-alive`)
   * when it commits the headers, and `writeHead` would override a decorator's
   * value anyway.
   *
   * ## Why `SkipAllThrottlers()` and not `@SkipThrottle()`
   *
   * A stream is one request held open, and a reconnect wave after a deploy —
   * every tab in an office, through one NAT, reconnecting within seconds —
   * must not 429 the badge. The bare `@SkipThrottle()` this first shipped with
   * did not achieve that: it targets a throttler named `default`, and ours are
   * named, so the stream stayed under the same per-IP budget as every other
   * call. See `THROTTLER_NAMES`.
   */
  @Sse('stream')
  @SkipAllThrottlers()
  stream(
    @Access() access: AccessContext,
    @CurrentUser() user: JwtPayload,
  ): Observable<MessageEvent> {
    const untilExp =
      user.exp !== undefined
        ? Math.max(0, user.exp * 1000 - Date.now() - STREAM_EXP_MARGIN_MS)
        : // No `exp` on the token at all (`JWT_ACCESS_EXPIRES` unset): nothing
          // bounds the session, so nothing bounds the stream either.
          Infinity;

    const ready$ = of<MessageEvent>({
      type: 'ready',
      data: '',
      retry: STREAM_RETRY_MS,
    });
    const ping$ = interval(STREAM_PING_MS).pipe(
      map((): MessageEvent => ({ type: 'ping', data: '' })),
    );
    const rows$ = this.registry.open(access.userId).pipe(
      mergeMap((nudge) =>
        from(
          this.service.findForStream(nudge.notificationId, access.userId),
        ).pipe(
          // Per nudge, so one failed read drops that one frame and nothing
          // else. Left to propagate, the rejection errors the merged stream:
          // Nest's SSE `catchError` then writes `{ type: 'error', data:
          // err.message }` to the browser — the raw driver message, host and
          // port included — and completes the response. A transient Mongo
          // error would close every stream on this node that was mid-read
          // and hand the client text it should never see. The client would
          // recover through reconnect + refetch, but it should not have to;
          // the row is still there and the badge's poll picks it up.
          catchError((err: unknown) => {
            this.logger.warn(
              `Dropped a stream frame for ${nudge.notificationId}: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
            return EMPTY;
          }),
        ),
      ),
      filter((row): row is NotificationRecord => row !== null),
      map((row): MessageEvent => ({
        type: 'notification',
        id: row.id,
        data: row,
      })),
    );

    const stream$ = merge(ready$, ping$, rows$);
    // Completing the observable is how Nest ends the response; `finalize` in
    // the registry then drops this stream from the map.
    return Number.isFinite(untilExp)
      ? stream$.pipe(takeUntil(timer(untilExp)))
      : stream$;
  }

  @Get()
  list(
    @Access() access: AccessContext,
    @Query(new ZodValidationPipe(listNotificationsSchema))
    query: ListNotificationsDto,
  ): Promise<NotificationListResponse> {
    return this.service.list(access.userId, query);
  }

  @Get('unread-count')
  unreadCount(@Access() access: AccessContext): Promise<UnreadCountResponse> {
    return this.service.unreadCount(access.userId);
  }

  @Patch(':id/read')
  markRead(
    @Access() access: AccessContext,
    @Param('id') id: string,
  ): Promise<NotificationRecord> {
    return this.service.markRead(access.userId, id);
  }

  @Post('read-all')
  @HttpCode(200)
  markAllRead(
    @Access() access: AccessContext,
  ): Promise<MarkAllNotificationsReadResponse> {
    return this.service.markAllRead(access.userId);
  }
}
