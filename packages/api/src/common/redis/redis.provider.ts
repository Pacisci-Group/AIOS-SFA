import { Logger, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/** The shared Redis client, or `null` when `REDIS_URL` is unset. */
export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

export type RedisClient = Redis | null;

/**
 * One Redis connection per process, for everything that is not the permission
 * cache (which keeps its own client in
 * `permissions/cache/permission-cache.provider.ts` — sharing the two is a
 * follow-up, not this ticket).
 *
 * ## Fails open locally, loud in production
 *
 * Unset `REDIS_URL` resolves to `null`, and consumers pick an in-process
 * fallback. That is the right default for the host dev loop and for e2e. In
 * production it is a silent degradation — SSE fan-out stops crossing process
 * boundaries while every health check stays green — so it is logged at `error`
 * there, the same shape as `mail-transport.provider.ts`, and the deploy
 * preflight requires the secret so the log line is only ever a backstop.
 */
export const redisClientProvider: Provider = {
  provide: REDIS_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService): RedisClient => {
    const logger = new Logger('Redis');
    const url = config.get<string>('REDIS_URL');

    if (!url) {
      const message =
        'REDIS_URL is not set — notification fan-out stays in-process. ' +
        'A multi-node tier will not deliver live notifications across nodes.';
      if (config.get<string>('NODE_ENV') === 'production') {
        logger.error(message);
      } else {
        logger.log(message);
      }
      return null;
    }

    const client = new Redis(url, {
      lazyConnect: false,
      maxRetriesPerRequest: 2,
    });
    client.on('error', (err: Error) => {
      // Every failed reconnect emits one. Logged, never thrown — an unhandled
      // 'error' event on the client would crash the process.
      logger.warn(`Redis connection error: ${err.message}`);
    });
    logger.log(`Connected to Redis at ${url.replace(/\/\/.*@/, '//***@')}`);
    return client;
  },
};
