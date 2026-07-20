import { Logger, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { NoopPermissionCache } from './noop-permission-cache';
import { PermissionCache } from './permission-cache';
import { RedisPermissionCache } from './redis-permission-cache';

const DEFAULT_TTL_SECONDS = 300;

/**
 * Provides the active {@link PermissionCache}. When `REDIS_URL` is set we use a
 * Redis-backed cache; otherwise we fall back to a no-op cache and resolve
 * permissions straight from MongoDB on every request. This keeps Redis strictly
 * optional — nothing else in the app needs to know which one is active.
 */
export const permissionCacheProvider: Provider = {
  provide: PermissionCache,
  inject: [ConfigService],
  useFactory: (config: ConfigService): PermissionCache => {
    const logger = new Logger('PermissionCache');
    const redisUrl = config.get<string>('REDIS_URL');

    if (!redisUrl) {
      logger.log(
        'REDIS_URL not set — resolving permissions from MongoDB only.',
      );
      return new NoopPermissionCache();
    }

    const ttlSeconds = Number(
      config.get<string>('PERMISSION_CACHE_TTL_SECONDS') ?? DEFAULT_TTL_SECONDS,
    );
    const client = new Redis(redisUrl, {
      lazyConnect: false,
      maxRetriesPerRequest: 2,
    });
    logger.log(
      `Using Redis permission cache (ttl=${ttlSeconds}s) at ${redisUrl.replace(
        /\/\/.*@/,
        '//***@',
      )}`,
    );
    return new RedisPermissionCache(
      client,
      Number.isFinite(ttlSeconds) && ttlSeconds > 0
        ? ttlSeconds
        : DEFAULT_TTL_SECONDS,
    );
  },
};
