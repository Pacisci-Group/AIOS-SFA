import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { PushSubscriptionResponse } from '@sfa/shared';
import { Model, Types } from 'mongoose';
import type {
  PushSubscriptionDto,
  RemovePushSubscriptionDto,
} from './dto/push-subscriptions.dto';
import {
  PushSubscription,
  type PushSubscriptionDocument,
} from './schemas/push-subscription.schema';

/**
 * The request-path half of web push (PAC-154, PR4): a browser registering or
 * withdrawing its subscription. Sending is the worker's alone
 * (`src/worker/push/web-push.service.ts`), which also soft-deletes the rows
 * the push service reports gone.
 */
@Injectable()
export class PushSubscriptionsService {
  constructor(
    @InjectModel(PushSubscription.name)
    private readonly model: Model<PushSubscriptionDocument>,
  ) {}

  /**
   * Register, or refresh, the caller's subscription for one endpoint.
   *
   * Keyed on the **live** row for that endpoint. A soft-deleted row for the
   * same endpoint is left where it is — the partial unique index ignores it,
   * and this inserts a fresh one.
   *
   * ## Another user's endpoint moves only with its keys
   *
   * A shared machine that signs in as someone else presents the *same*
   * browser subscription — same endpoint, same `p256dh`/`auth` — and the row
   * moves to the new user, so the previous user's pushes stop arriving on
   * it. A caller who knows only the endpoint (a leaked URL, a row read off
   * a database) and presents other keys is refused with a `409`: matching on
   * the endpoint alone let any signed-in user, from any tenant, overwrite
   * the owner and the keys, which stopped the owner's pushes and encrypted
   * the new ones with keys that browser could not read (PR4 review, second
   * round). The keys are the proof of possession the endpoint is not.
   *
   * ## Two tabs, one new endpoint
   *
   * Tabs share one browser subscription, and after a VAPID rotation both
   * reconcile at once: two upserts for an endpoint no row has yet. The
   * loser's insert hits the unique index (E11000) and is retried once —
   * the second attempt finds the winner's row and updates it (PR4 review,
   * second round).
   *
   * `$setOnInsert: { deletedAt: null }` is belt and braces with the schema
   * default: the partial index only sees a stored null, so the write that
   * creates the row says so explicitly rather than trusting `setDefaultsOnInsert`.
   */
  async upsert(
    userId: string,
    input: PushSubscriptionDto,
  ): Promise<PushSubscriptionResponse> {
    const owner = new Types.ObjectId(userId);
    const live = await this.model
      .findOne({ endpoint: input.endpoint, deletedAt: null })
      .select({ userId: 1, keys: 1 })
      .lean<Pick<PushSubscriptionDocument, 'userId' | 'keys'>>();
    if (
      live &&
      !live.userId.equals(owner) &&
      (live.keys.p256dh !== input.keys.p256dh ||
        live.keys.auth !== input.keys.auth)
    ) {
      throw new ConflictException(
        'This push endpoint is registered to another user.',
      );
    }

    try {
      return toResponse(await this.write(owner, input));
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err;
      return toResponse(await this.write(owner, input));
    }
  }

  private write(
    owner: Types.ObjectId,
    input: PushSubscriptionDto,
  ): Promise<PushSubscriptionDocument> {
    return this.model
      .findOneAndUpdate(
        { endpoint: input.endpoint, deletedAt: null },
        {
          $set: {
            userId: owner,
            keys: { p256dh: input.keys.p256dh, auth: input.keys.auth },
            userAgent: input.userAgent ?? null,
          },
          $setOnInsert: { deletedAt: null, lastSuccessAt: null },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .lean<PushSubscriptionDocument>();
  }

  /**
   * Withdraw the caller's subscription for one endpoint — a soft delete, like
   * the worker's. Scoped to the caller: somebody else's endpoint is a 404, not
   * a 403, so an endpoint cannot be probed for whose it is.
   */
  async remove(
    userId: string,
    input: RemovePushSubscriptionDto,
  ): Promise<void> {
    const result = await this.model.updateOne(
      {
        endpoint: input.endpoint,
        userId: new Types.ObjectId(userId),
        deletedAt: null,
      },
      { $set: { deletedAt: new Date() } },
    );
    if (result.matchedCount === 0) {
      throw new NotFoundException('Push subscription not found');
    }
  }
}

/** E11000 — the unique `endpoint` index, from a concurrent insert. */
function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === 11000
  );
}

function toResponse(row: PushSubscriptionDocument): PushSubscriptionResponse {
  return {
    id: row._id.toHexString(),
    endpoint: row.endpoint,
    userAgent: row.userAgent ?? null,
    createdAt: (row.createdAt ?? new Date()).toISOString(),
    lastSuccessAt: row.lastSuccessAt ? row.lastSuccessAt.toISOString() : null,
  };
}
