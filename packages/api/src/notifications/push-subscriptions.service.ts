import { Injectable, NotFoundException } from '@nestjs/common';
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
   * Keyed on the **live** row for that endpoint, whoever it belongs to: a
   * shared machine that signs in as someone else moves the row to the new
   * user, so the previous user's pushes stop arriving on it. A soft-deleted
   * row for the same endpoint is left where it is — the partial unique index
   * ignores it, and this inserts a fresh one.
   *
   * `$setOnInsert: { deletedAt: null }` is belt and braces with the schema
   * default: the partial index only sees a stored null, so the write that
   * creates the row says so explicitly rather than trusting `setDefaultsOnInsert`.
   */
  async upsert(
    userId: string,
    input: PushSubscriptionDto,
  ): Promise<PushSubscriptionResponse> {
    const row = await this.model
      .findOneAndUpdate(
        { endpoint: input.endpoint, deletedAt: null },
        {
          $set: {
            userId: new Types.ObjectId(userId),
            keys: { p256dh: input.keys.p256dh, auth: input.keys.auth },
            userAgent: input.userAgent ?? null,
          },
          $setOnInsert: { deletedAt: null, lastSuccessAt: null },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .lean<PushSubscriptionDocument>();

    return toResponse(row);
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

function toResponse(row: PushSubscriptionDocument): PushSubscriptionResponse {
  return {
    id: row._id.toHexString(),
    endpoint: row.endpoint,
    userAgent: row.userAgent ?? null,
    createdAt: (row.createdAt ?? new Date()).toISOString(),
    lastSuccessAt: row.lastSuccessAt ? row.lastSuccessAt.toISOString() : null,
  };
}
