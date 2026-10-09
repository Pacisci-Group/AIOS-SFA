import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import {
  Notification,
  NotificationSchema,
} from './schemas/notification.schema';

/**
 * Notifications — the read side (PAC-154).
 *
 * The API owns the `notifications` collection and its indexes (`autoIndex`
 * builds them here; the worker's `WorkerIndexesService` must **not** list it,
 * because `syncIndexes()` drops what it does not know). The *write* side is
 * `src/worker/functions/deliver-notification.fn.ts`, which reaches the
 * collection through the schema — the one thing the worker boundary lets
 * across — and never through this module.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Notification.name, schema: NotificationSchema },
    ]),
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService, MongooseModule],
})
export class NotificationsModule {}
