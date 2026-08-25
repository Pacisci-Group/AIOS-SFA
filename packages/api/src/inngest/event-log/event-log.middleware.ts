import { Middleware } from 'inngest';
import type { EventLogService } from './event-log.service';

/**
 * Closes the loop on every run, for every function, without touching a handler.
 *
 * ## Why middleware rather than a per-function hook
 * The alternative is an `onFailure` handler on each `createFunction` call. That
 * works, and it is forgotten the first time someone adds a function in a hurry —
 * at which point that event type silently has no failure record and nobody finds
 * out until they go looking for one. Middleware applies to everything the client
 * runs, including functions that do not exist yet.
 *
 * ## Why this is a factory returning a class
 * `Middleware.Class` is `new (args: { client }) => BaseMiddleware` — Inngest
 * constructs it, so there is no constructor parameter to inject through. Closing
 * over an injected {@link EventLogService} keeps the actual logic in a normal
 * `@Injectable` and avoids a module-level singleton, which is the same instinct
 * `inngest.client.ts` documents about not reading `process.env` at import time.
 *
 * ## The one rule worth defending
 * A **non-final** retry writes nothing. `onRunError` fires on every failed
 * attempt, so recording each one would turn a run that exhausts `retries: 4`
 * into roughly twelve writes instead of two — and it would do so precisely when
 * something is already wrong and the database is least likely to want the
 * traffic. Intermediate attempts are visible in the Inngest dashboard; what the
 * application needs to know is the outcome.
 */
export function createEventLogMiddleware(
  log: EventLogService,
): Middleware.Class {
  return class EventLogMiddleware extends Middleware.BaseMiddleware {
    readonly id = 'event-log';

    async onRunComplete({ ctx }: Middleware.OnRunCompleteArgs): Promise<void> {
      const eventLogId = readEventLogId(ctx);
      if (!eventLogId) return;
      await log.markSucceeded(eventLogId, ctx.runId ?? null, ctx.attempt ?? 0);
    }

    async onRunError({
      ctx,
      error,
      isFinalAttempt,
    }: Middleware.OnRunErrorArgs): Promise<void> {
      // See the class docblock: intermediate attempts are deliberately silent.
      if (!isFinalAttempt) return;

      const eventLogId = readEventLogId(ctx);
      if (!eventLogId) return;
      await log.markFailed(
        eventLogId,
        ctx.runId ?? null,
        ctx.attempt ?? 0,
        error.message,
      );
    }
  };
}

/**
 * Pull the outbox row id off the triggering event.
 *
 * Read from `event.data`, stamped by `InngestService.send`, rather than from
 * `event.id` — which Inngest also carries, but whose relationship to the id we
 * *sent* is not something the SDK's types promise. A field in the payload is a
 * contract the catalog schemas enforce at compile time.
 *
 * Returns null for runs that have no outbox row at all. That is not an error
 * case: a **cron-triggered** function (the sweeper itself) is invoked by a
 * schedule, not by an event anyone emitted, so there is nothing to update.
 */
function readEventLogId(ctx: { event?: { data?: unknown } }): string | null {
  const data = ctx.event?.data;
  if (!data || typeof data !== 'object') return null;

  const id = (data as Record<string, unknown>).eventLogId;
  return typeof id === 'string' && id.length > 0 ? id : null;
}
