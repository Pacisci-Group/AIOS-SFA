import { Logger, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  REDIS_CLIENT,
  type RedisClient,
} from '../../common/redis/redis.provider';
import { NoopPermissionCache } from './noop-permission-cache';
import { PermissionCache } from './permission-cache';
import { RedisPermissionCache } from './redis-permission-cache';

const DEFAULT_TTL_SECONDS = 300;

/**
 * Provides the active {@link PermissionCache}. When `REDIS_URL` is set we use a
 * Redis-backed cache; otherwise we fall back to a no-op cache and resolve
 * permissions straight from MongoDB on every request. This keeps Redis strictly
 * optional — nothing else in the app needs to know which one is active.
 *
 * The client is the process-wide one from `common/redis/redis.provider.ts`
 * (`PermissionsModule` imports `RedisModule` for it), not a second connection
 * of its own: one API process used to open three — this cache, the
 * notification publisher and its subscriber — against a managed Valkey with a
 * connection cap (PAC-154 PR2 review). `RedisModule` owns the client's
 * lifecycle, so this cache never closes it.
 */
export const permissionCacheProvider: Provider = {
  provide: PermissionCache,
  inject: [ConfigService, REDIS_CLIENT],
  useFactory: (config: ConfigService, client: RedisClient): PermissionCache => {
    const logger = new Logger('PermissionCache');

    if (!client) {
      logger.log(
        'REDIS_URL not set — resolving permissions from MongoDB only.',
      );
      return new NoopPermissionCache();
    }

    const ttlSeconds = Number(
      config.get<string>('PERMISSION_CACHE_TTL_SECONDS') ?? DEFAULT_TTL_SECONDS,
    );
    const ttl =
      Number.isFinite(ttlSeconds) && ttlSeconds > 0
        ? ttlSeconds
        : DEFAULT_TTL_SECONDS;
    logger.log(`Using the Redis permission cache (ttl=${ttl}s).`);
    return new RedisPermissionCache(client, ttl);
  },
};
