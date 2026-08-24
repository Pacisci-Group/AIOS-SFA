import { Middleware } from 'inngest';
import { createEventLogMiddleware } from './event-log.middleware';
import type { EventLogService } from './event-log.service';

/**
 * Records what the middleware asked the log to do, so a test can count writes.
 *
 * Counting is the point. The whole justification for this design is "two writes
 * per event, constant regardless of retries" — a claim that is invisible in code
 * review and only stays true if something asserts it.
 */
class SpyEventLog {
  readonly calls: Array<{
    kind: 'succeeded' | 'failed';
    id: string;
    attempts: number;
    error: string;
  }> = [];

  markSucceeded(id: string, _runId: string | null, attempts: number) {
    this.calls.push({ kind: 'succeeded', id, attempts, error: '' });
    return Promise.resolve();
  }

  markFailed(
    id: string,
    _runId: string | null,
    attempts: number,
    error: string,
  ) {
    this.calls.push({ kind: 'failed', id, attempts, error });
    return Promise.resolve();
  }
}

const EVENT_LOG_ID = '507f1f77bcf86cd799439010';

/** A run context shaped like the slice the middleware actually reads. */
function ctx(overrides: { eventLogId?: string | null; attempt?: number } = {}) {
  const { eventLogId = EVENT_LOG_ID, attempt = 0 } = overrides;
  return {
    runId: 'run_01ABCDEF',
    attempt,
    event: {
      name: 'email/invite.requested.v1',
      data: eventLogId === null ? {} : { eventLogId },
    },
  };
}

function build(): {
  mw: Middleware.BaseMiddleware;
  spy: SpyEventLog;
} {
  const spy = new SpyEventLog();
  const MiddlewareClass = createEventLogMiddleware(
    spy as unknown as EventLogService,
  );
  // Inngest constructs middleware with `{ client }` and nothing else; the client
  // is never touched by this middleware, so a cast past it is honest here.
  const mw = new MiddlewareClass({ client: null as never });
  return { mw, spy };
}

type RunErrorArgs = Parameters<
  NonNullable<Middleware.BaseMiddleware['onRunError']>
>[0];
type RunCompleteArgs = Parameters<
  NonNullable<Middleware.BaseMiddleware['onRunComplete']>
>[0];

describe('event-log middleware', () => {
  it('writes exactly once when a run succeeds', async () => {
    const { mw, spy } = build();

    await mw.onRunComplete?.({ ctx: ctx() } as unknown as RunCompleteArgs);

    expect(spy.calls).toEqual([
      { kind: 'succeeded', id: EVENT_LOG_ID, attempts: 0, error: '' },
    ]);
  });

  /**
   * The retry-amplification guard.
   *
   * `onRunError` fires on every failed attempt. Recording each one would turn a
   * run that exhausts `retries: 4` into roughly a dozen writes instead of two,
   * precisely when the system is already unhealthy. If someone removes the
   * `isFinalAttempt` check, this is the test that says so.
   */
  it('writes nothing for a retry that is not the final attempt', async () => {
    const { mw, spy } = build();

    for (let attempt = 0; attempt < 4; attempt++) {
      await mw.onRunError?.({
        ctx: ctx({ attempt }),
        error: new Error('Resend 503'),
        isFinalAttempt: false,
      } as unknown as RunErrorArgs);
    }

    expect(spy.calls).toEqual([]);
  });

  it('writes once, on the final attempt, when a run fails for good', async () => {
    const { mw, spy } = build();

    for (let attempt = 0; attempt < 4; attempt++) {
      await mw.onRunError?.({
        ctx: ctx({ attempt }),
        error: new Error('Resend 503'),
        isFinalAttempt: false,
      } as unknown as RunErrorArgs);
    }
    await mw.onRunError?.({
      ctx: ctx({ attempt: 4 }),
      error: new Error('Resend rejected the message'),
      isFinalAttempt: true,
    } as unknown as RunErrorArgs);

    expect(spy.calls).toEqual([
      {
        kind: 'failed',
        id: EVENT_LOG_ID,
        attempts: 4,
        error: 'Resend rejected the message',
      },
    ]);
  });

  /**
   * A cron-triggered function — the sweeper itself — has no originating event
   * and therefore no `eventLogId`. Without this guard the sweeper would try to
   * update a row that does not exist, on every tick, forever.
   */
  it('ignores runs with no event-log id, such as cron triggers', async () => {
    const { mw, spy } = build();

    await mw.onRunComplete?.({
      ctx: ctx({ eventLogId: null }),
    } as unknown as RunCompleteArgs);
    await mw.onRunError?.({
      ctx: ctx({ eventLogId: null }),
      error: new Error('boom'),
      isFinalAttempt: true,
    } as unknown as RunErrorArgs);

    expect(spy.calls).toEqual([]);
  });
});
