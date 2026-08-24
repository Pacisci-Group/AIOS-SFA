import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export const EVENT_LOG_STATUSES = ['pending', 'succeeded', 'failed'] as const;

export type EventLogStatus = (typeof EVENT_LOG_STATUSES)[number];

export type EventLogEntryDocument = HydratedDocument<EventLogEntry>;

/**
 * One row per event we asked Inngest to run — the durable outbox.
 *
 * ## Why this exists when Inngest already has a queue
 * Two gaps no Inngest backend can close, not SQLite today and not a managed
 * Valkey later:
 *
 * 1. **The emit gap.** If `client.send()` fails, or the API dies between
 *    deciding to do the work and Inngest accepting it, Inngest never learned the
 *    event existed. Writing here *before* the send is the only thing that makes
 *    that recoverable.
 * 2. **Visibility.** Inngest's run history lives in its own store, with no query
 *    API our app can reach. "Which invites never arrived?" is unanswerable from
 *    the application without this collection.
 *
 * ## Exactly two writes per event, whatever happens
 * Insert `pending` on emit; one update on the terminal outcome. There is
 * deliberately no `queued` or `running` state — a crashed mid-run event staying
 * `pending` and being swept is precisely the behaviour we want, and tracking
 * those transitions would double the write cost to tell us something the
 * terminal write already says.
 *
 * The same reasoning drives the rule in `event-log.middleware.ts`: a **non-final**
 * retry writes nothing. Without that, a run exhausting `retries: 4` would write
 * about twelve times — and failure paths multiply exactly when the system is
 * already unhealthy.
 *
 * ## Retention
 * `expiresAt` is written **only** when a row reaches a terminal state, so the TTL
 * index can never reap a row the sweeper still needs. A stuck `pending` row lives
 * until something resolves it. See `config/event-log.config.ts`.
 *
 * ## Why it does not extend `TenantRecord`
 * Same reason as `EmailMessage`: `TenantRecord` requires `branchId`, and plenty
 * of work is agency-scoped with no branch. This is an operational record, not a
 * tenant domain record, and nothing here was ever migrated so it carries no
 * `legacySmartSuiteId`.
 */
@Schema({ timestamps: true, collection: 'eventLog' })
export class EventLogEntry {
  /** e.g. `email/invite.requested.v1`. Matches a name in `inngest/events/`. */
  @Prop({ required: true, index: true })
  eventName: string;

  /**
   * The event's `data`, verbatim — this is what a replay re-sends.
   *
   * Written once at insert and **never updated**: status changes touch only small
   * scalar fields, which is what keeps the update cheap.
   *
   * ⚠ Two warnings, both load-bearing.
   *
   * **This can hold credentials.** An invite payload's `inviteUrl` contains a
   * live bearer token. It cannot be redacted, because a replay needs the real
   * payload — that is the whole point of storing it. The same secret already
   * sits in `users.inviteToken`, so this is not a new class of exposure, but it
   * is a wider one: never surface this collection in an admin or support UI
   * without redacting per-event. Compare `emailMessages.bodyHash`, which stores
   * a hash precisely because it never needs to replay anything.
   *
   * **Keep payloads small.** Storage and working-set size are driven by this
   * field, not by the write count. An event type that wants to carry a large
   * blob should carry a reference to it instead.
   */
  @Prop({ type: Object, required: true })
  payload: Record<string, unknown>;

  /**
   * `type: String` is required, not decorative: `EventLogStatus` is a union, and
   * `emitDecoratorMetadata` reports a union as `Object`, so Mongoose cannot infer
   * the field and throws `CannotDetermineTypeError` at boot. Same trap as
   * `EmailMessage.status`.
   */
  @Prop({ type: String, required: true, enum: EVENT_LOG_STATUSES })
  status: EventLogStatus;

  /** Inngest's attempt number on the terminal run. 0 when it succeeded first try. */
  @Prop({ default: 0 })
  attempts: number;

  /** Populated on `failed` only. */
  @Prop({ default: '' })
  lastError: string;

  /** Inngest's run id — the join back to a run in the dashboard. */
  @Prop({ type: String, default: null })
  runId: string | null;

  /** How many times the sweeper has re-emitted this row. Diagnostic only. */
  @Prop({ default: 0 })
  resendCount: number;

  /**
   * Null for work that belongs to no tenant.
   *
   * Nullable rather than required because this log is generic: every event today
   * carries an agency, but a platform-wide job legitimately would not, and
   * Mongoose's `required` validator rejects `''` — so a "required" field here
   * would force a sentinel value the first time one appears.
   */
  @Prop({ type: String, default: null })
  agencyId: string | null;

  /** Null for agency-scoped work with no branch context. */
  @Prop({ type: String, default: null })
  branchId: string | null;

  /** Set only on reaching a terminal state. See the retention note above. */
  @Prop({ type: Date, default: null })
  expiresAt: Date | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export const EventLogEntrySchema = SchemaFactory.createForClass(EventLogEntry);

/**
 * The sweeper's query: `status: 'pending'` older than the stale threshold.
 *
 * Compound rather than a standalone `status` index plus a `createdAt` one. Every
 * index multiplies the cost of the terminal update, and `status` changes on that
 * update — so carrying a second index over the same field would be paid on every
 * event for no additional query.
 */
EventLogEntrySchema.index({ status: 1, createdAt: 1 });

/** Per-agency support queries: "what did we try to do for this agency?" */
EventLogEntrySchema.index({ agencyId: 1, createdAt: -1 });

/**
 * TTL. `expireAfterSeconds: 0` means "expire at the instant in `expiresAt`",
 * which is what lets retention be a per-row decision rather than a fixed age.
 *
 * Rows with a null `expiresAt` are never considered — that is the guarantee that
 * a non-terminal row cannot be reaped out from under the sweeper.
 */
EventLogEntrySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
