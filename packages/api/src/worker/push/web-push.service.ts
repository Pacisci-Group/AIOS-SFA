import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { WebPushError } from 'web-push';
import { isAllowedPushEndpoint } from '../../common/push/push-endpoint';
import {
  PushSubscription,
  type PushSubscriptionDocument,
} from '../../notifications/schemas/push-subscription.schema';
import type { NotificationChannelStatus } from '../../notifications/schemas/notification.schema';
import { WebPushTransport } from './web-push.transport';

/**
 * What the service worker receives. Under 4 KB by construction — the push
 * services reject larger payloads, and `title`/`body` are the stored row's
 * one-line rendering.
 */
export interface PushPayload {
  /** The notification row id; also the OS notification `tag`, so a re-send replaces rather than stacks. */
  id: string;
  title: string;
  body: string;
  /** App-relative path, as stored. The service worker opens it on its own origin. */
  href: string;
  /** Absolute URL of the agency mark (or the platform icon). */
  icon: string;
}

/**
 * One user's fan-out, summarised for the row's `delivery.push`.
 *
 * `sent` when at least one subscription accepted the message; `skipped` when
 * there was nothing to send to (push unconfigured, or no live subscription);
 * `failed` when every live subscription refused it. `removed` counts the
 * subscriptions the push service reported gone, which are now soft-deleted.
 */
export interface PushSendOutcome {
  status: NotificationChannelStatus;
  sent: number;
  failed: number;
  removed: number;
  error: string | null;
}

/** An hour: long enough for a phone to wake up, short enough to be stale after. */
const PUSH_TTL_SECONDS = 3600;

/**
 * Web push to a user's subscribed browsers (PAC-154, PR4).
 *
 * Lives in `src/worker/push/` — not `src/worker/notifications/`, because
 * `notifications` is a `FEATURE_DIRS` entry and the eslint boundary matches
 * the import *string*; a worker directory of that name would make the rule
 * fire on the worker's own relative imports (same trap as `src/worker/email/`
 * vs `src/mail/`). It reaches `pushSubscriptions` through the schema alone.
 *
 * ## Dead subscriptions are soft-deleted
 *
 * The push service answers `404`/`410` for a subscription the browser has
 * dropped (user revoked permission, browser profile gone). That row gets
 * `deletedAt` — never a hard delete (PAC-155) — and the partial unique index
 * lets the same device subscribe again later. Nothing else about a failure
 * touches the row.
 *
 * ## The endpoint is re-checked here, not only at the API
 *
 * `isAllowedPushEndpoint` ran when the row was written, but a row written
 * before the allowlist existed, or before a host was removed from it, is
 * still a URL this worker would POST to from inside the network. So every
 * send checks again; a row that fails is soft-deleted like a dead one and the
 * device re-subscribes through the (now stricter) API on its next visit.
 *
 * ## A `401`/`403` is a failure, not a dead subscription
 *
 * The push service answers these when the VAPID signature does not match the
 * key the browser subscribed with — after a key rotation, or a misconfigured
 * private key. Soft-deleting on them would, on a misconfiguration, silently
 * wipe every subscription in the system. They are recorded as `failed` with
 * the status in the message; the browser compares its key against the
 * published one on every app load and re-subscribes on a mismatch
 * (`reconcilePushSubscription` in the web app), which is the repair path.
 */
@Injectable()
export class WebPushService {
  private readonly logger = new Logger(WebPushService.name);

  constructor(
    private readonly transport: WebPushTransport,
    @InjectModel(PushSubscription.name)
    private readonly subscriptions: Model<PushSubscriptionDocument>,
  ) {}

  /** Whether the VAPID keys are configured — `false` means every send is `skipped`. */
  get enabled(): boolean {
    return this.transport.enabled;
  }

  /**
   * Send one payload to every live subscription of one user.
   *
   * Never throws: every failure is folded into the outcome, because the caller
   * is a best-effort step that records the result and moves on. A single
   * dead device must not fail, or retry, the rows already stored and live.
   */
  async sendToUser(
    userId: string,
    payload: PushPayload,
  ): Promise<PushSendOutcome> {
    if (!this.transport.enabled) {
      return {
        status: 'skipped',
        sent: 0,
        failed: 0,
        removed: 0,
        error: 'web push is not configured',
      };
    }

    const targets = await this.subscriptions
      .find({ userId: new Types.ObjectId(userId), deletedAt: null })
      .select({ _id: 1, endpoint: 1, keys: 1 })
      .lean<
        Array<{
          _id: Types.ObjectId;
          endpoint: string;
          keys: { p256dh: string; auth: string };
        }>
      >();

    if (targets.length === 0) {
      return {
        status: 'skipped',
        sent: 0,
        failed: 0,
        removed: 0,
        error: 'recipient has no push subscription',
      };
    }

    const body = JSON.stringify(payload);
    const options = {
      TTL: PUSH_TTL_SECONDS,
      urgency: 'normal' as const,
      // ≤ 32 chars, base64url charset: the hex row id qualifies as is.
      topic: payload.id.slice(-32),
    };

    let sent = 0;
    let failed = 0;
    let removed = 0;
    const errors: string[] = [];

    for (const target of targets) {
      if (!isAllowedPushEndpoint(target.endpoint)) {
        removed += 1;
        await this.subscriptions.updateOne(
          { _id: target._id, deletedAt: null },
          { $set: { deletedAt: new Date() } },
        );
        this.logger.warn(
          `Push subscription ${target._id.toHexString()} points at a host that is not a known push service; soft-deleted, not sent.`,
        );
        continue;
      }
      try {
        await this.transport.send(
          { endpoint: target.endpoint, keys: target.keys },
          body,
          options,
        );
        sent += 1;
        await this.subscriptions.updateOne(
          { _id: target._id },
          { $set: { lastSuccessAt: new Date() } },
        );
      } catch (err) {
        if (isGone(err)) {
          removed += 1;
          await this.subscriptions.updateOne(
            { _id: target._id, deletedAt: null },
            { $set: { deletedAt: new Date() } },
          );
          this.logger.log(
            `Push subscription ${target._id.toHexString()} is gone (${err.statusCode}); soft-deleted.`,
          );
          continue;
        }
        failed += 1;
        const message = err instanceof Error ? err.message : String(err);
        errors.push(message);
        this.logger.warn(
          isVapidRejection(err)
            ? `Push to subscription ${target._id.toHexString()} was refused (${err.statusCode}): the push service rejected the VAPID signature — a rotated or mismatched key. The browser re-subscribes on its next visit; the row stays live.`
            : `Push to subscription ${target._id.toHexString()} failed: ${message}`,
        );
      }
    }

    const status: NotificationChannelStatus =
      sent > 0 ? 'sent' : failed > 0 ? 'failed' : 'skipped';
    return {
      status,
      sent,
      failed,
      removed,
      error:
        status === 'sent'
          ? null
          : status === 'failed'
            ? errors.join('; ').slice(0, 1000)
            : `every subscription (${removed}) had expired`,
    };
  }
}

/** The push service's "this subscription no longer exists". */
function isGone(err: unknown): err is WebPushError {
  return (
    err instanceof WebPushError &&
    (err.statusCode === 404 || err.statusCode === 410)
  );
}

/** The push service's "your VAPID signature is not the key this device subscribed with". */
function isVapidRejection(err: unknown): err is WebPushError {
  return (
    err instanceof WebPushError &&
    (err.statusCode === 401 || err.statusCode === 403)
  );
}
