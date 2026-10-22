import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RedisModule } from '../common/redis/redis.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PublicNotificationsController } from './public-notifications.controller';
import { PushSubscriptionsService } from './push-subscriptions.service';
import { NotificationStreamRegistry } from './stream/notification-stream.registry';
import {
  Notification,
  NotificationSchema,
} from './schemas/notification.schema';
import {
  PushSubscription,
  PushSubscriptionSchema,
} from './schemas/push-subscription.schema';

/**
 * Notifications — the read side (PAC-154).
 *
 * The API owns the `notifications` collection and its indexes (`autoIndex`
 * builds them here; the worker's `WorkerIndexesService` must **not** list it,
 * because `syncIndexes()` drops what it does not know). The *write* side is
 * `src/worker/functions/deliver-notification.fn.ts`, which reaches the
 * collection through the schema — the one thing the worker boundary lets
 * across — and never through this module.
 *
 * The live half (PR2): `RedisModule` supplies the `NotificationBus` the
 * worker publishes on, and `NotificationStreamRegistry` turns its nudges into
 * frames on the SSE streams this node holds. Imported by name rather than
 * made global so the standalone worker resolves the same module on its own.
 *
 * The push half (PR4): `pushSubscriptions` is owned here the same way —
 * indexes built by this module's `autoIndex`, rows registered and withdrawn by
 * `PushSubscriptionsService`, and the *sending* done by the worker through the
 * schema alone (`src/worker/push/`). `PublicNotificationsController` serves
 * the VAPID public key with no session.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Notification.name, schema: NotificationSchema },
      { name: PushSubscription.name, schema: PushSubscriptionSchema },
    ]),
    RedisModule,
  ],
  controllers: [NotificationsController, PublicNotificationsController],
  providers: [
    NotificationsService,
    NotificationStreamRegistry,
    PushSubscriptionsService,
  ],
  exports: [NotificationsService, MongooseModule],
})
export class NotificationsModule {}
