import { Inject, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import { LocalNotificationBus } from './local-notification-bus';
import { NotificationBus } from './notification-bus';
import { RedisNotificationBus } from './redis-notification-bus';
import {
  REDIS_CLIENT,
  redisClientProvider,
  type RedisClient,
} from './redis.provider';

/**
 * Redis, and the notification bus that rides on it (PAC-154 PR2).
 *
 * ## Deliberately not `@Global()`
 *
 * A global module is global only within the app that imports it, and the
 * standalone worker (`WorkerRootModule`) does not import `AppModule`. Both
 * `NotificationsModule` and `WorkerModule` import this explicitly instead —
 * the same reasoning that has `WorkerModule` import `StorageModule` by name.
 * Within one app the module is still a singleton, so the inline worker and
 * the stream registry share one bus, which is what makes the
 * {@link LocalNotificationBus} fallback work at all.
 *
 * `common/` is the tier the worker may import, so the bus lives here rather
 * than under `notifications/`, which the eslint boundary bars the worker from.
 */
@Module({
  providers: [
    redisClientProvider,
    {
      provide: NotificationBus,
      inject: [REDIS_CLIENT],
      useFactory: (client: RedisClient): NotificationBus => {
        const logger = new Logger('NotificationBus');
        if (client) {
          logger.log('Notification fan-out over Redis pub/sub.');
          return new RedisNotificationBus(client);
        }
        logger.log('Notification fan-out in-process (no REDIS_URL).');
        return new LocalNotificationBus();
      },
    },
  ],
  exports: [REDIS_CLIENT, NotificationBus],
})
export class RedisModule implements OnModuleDestroy {
  constructor(
    @Inject(REDIS_CLIENT) private readonly client: RedisClient,
    private readonly bus: NotificationBus,
  ) {}

  /**
   * Close the subscriber first (it is a duplicate of the client), then the
   * client. `quit()` waits for pending replies; if the server is already
   * gone it rejects, and `disconnect()` drops the socket instead.
   */
  async onModuleDestroy(): Promise<void> {
    if (this.bus instanceof RedisNotificationBus) {
      await this.bus.close();
    }
    if (!this.client) return;
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }
}
