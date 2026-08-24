import { Inject, Injectable, Logger } from '@nestjs/common';
import { Types } from 'mongoose';
import { INNGEST_CLIENT, type InngestClient } from './inngest.client';
import {
  EventLogService,
  type ReplayableEvent,
} from './event-log/event-log.service';

/**
 * The minimum shape of a catalog {@link EventType} that {@link InngestService}
 * needs.
 *
 * Structural rather than importing `EventType` with its two generics: this
 * keeps the signature readable at call sites and avoids taking a direct
 * dependency on `@standard-schema/spec`, which is only a transitive dep of
 * `inngest` and could vanish from the hoisted tree on any install.
 *
 * Explicit `(data, options)` rather than the variadic form it used to be,
 * because {@link InngestService.send} has to pass `options.id` — see there.
 */
interface CatalogEvent<TData> {
  readonly name: string;
  create(data: TData, options?: { id?: string }): { validate(): Promise<void> };
}

/**
 * The one way anything on the API side hands work to the worker.
 *
 * ## Failure contract — a throw, never a swallow, but it no longer means what it did
 * `send()` still rejects if the Inngest event API is unreachable, and callers
 * must still let that propagate. What changed when the outbox landed is what the
 * rejection *means*.
 *
 * Previously a throw meant "the work will not happen"; `UsersService.issueInvite`
 * leant on that, saving the user before sending so a throw left a pending invite
 * the owner could resend. Now the `eventLog` row is written **before** the send,
 * so a throw means "Inngest has not accepted this **yet**" — the sweeper will
 * re-emit it within `EVENT_LOG_STALE_MINUTES`. The work is not lost; it is late.
 *
 * The throw is still worth propagating: it is the signal that something is wrong
 * with Inngest right now, and the owner seeing an error is more honest than a
 * silent success for an invite that will arrive fifteen minutes later.
 *
 * A resolved promise means Inngest has durably accepted the event — that the
 * work *will* happen, not that it has happened.
 */
@Injectable()
export class InngestService {
  private readonly logger = new Logger(InngestService.name);

  constructor(
    @Inject(INNGEST_CLIENT) public readonly client: InngestClient,
    private readonly eventLog: EventLogService,
  ) {}

  /**
   * Send one event, built from a catalog event type.
   *
   * Taking the catalog object rather than a raw `{ name, data }` is what makes
   * the payload type-checked at the call site — a renamed or retyped field
   * becomes a compile error in the *producer*, which is the whole reason the
   * catalog lives outside `src/worker/`.
   *
   * ## Order of operations, and why it is this order
   * 1. **Mint the id.** It is the outbox row's `_id` *and* the event's Inngest
   *    `id`, which is what lets a replay be recognised as the same event.
   * 2. **Validate.** Inngest does not validate on send, so without this a payload
   *    that violates the catalog sails through and blows up in the worker
   *    instead — far away from the code that got it wrong. Done before the write
   *    so a malformed payload leaves no row for the sweeper to retry forever.
   * 3. **Write `pending`.** Before the send, never after. This is the entire
   *    point of the outbox: a crash between the write and the send leaves a row
   *    the sweeper recovers, whereas a crash between a send and a later write
   *    would leave nothing at all.
   * 4. **Send.**
   *
   * `data` omits `eventLogId` — producers neither know nor set it. The generic
   * constraint means an event schema that forgot to spread `eventEnvelope` is a
   * compile error here rather than a row that never reaches a terminal state.
   */
  async send<TData extends { eventLogId: string }>(
    event: CatalogEvent<TData>,
    data: Omit<TData, 'eventLogId'>,
  ): Promise<void> {
    const eventLogId = new Types.ObjectId();
    const payload = {
      ...data,
      eventLogId: eventLogId.toHexString(),
    } as TData;

    // `id` doubles as Inngest's deduplication key: an event sent twice with the
    // same id runs once (24h window). That is what makes the sweeper safe to run
    // live — re-emitting a row Inngest still remembers is a no-op.
    const created = event.create(payload, { id: eventLogId.toHexString() });

    await created.validate();

    await this.eventLog.recordPending(eventLogId, event.name, payload);

    await this.client.send(created as never);
    this.logger.debug(`Sent ${event.name} (${eventLogId.toHexString()})`);
  }

  /**
   * Re-emit a stored event. **Sweeper only.**
   *
   * Deliberately bypasses the catalog: the sweeper holds a name and a payload
   * read back from Mongo, not a typed `EventType`, and re-validating would only
   * re-check a payload that was already validated when it was first sent.
   *
   * The original id is preserved, which is the property that makes this safe to
   * run automatically:
   *
   * - If Inngest still remembers the event, the re-send **deduplicates** and
   *   nothing runs twice.
   * - If Inngest lost its state — the case this exists for — the deduplication
   *   memory went with it, so the event correctly runs again.
   *
   * ⚠ The corollary is a real limitation: an event Inngest accepted and then
   * genuinely wedged cannot be rescued within the 24h dedupe window. It sweeps
   * successfully once the window expires. That trade is deliberate — never
   * duplicating work is worth more than rescuing a rare stuck run quickly.
   */
  async resend(row: ReplayableEvent): Promise<void> {
    await this.client.send({
      id: row.id,
      name: row.eventName,
      data: row.payload,
    });
    await this.eventLog.markResent(row.id);
    this.logger.warn(`Re-emitted stale event ${row.eventName} (${row.id})`);
  }
}
