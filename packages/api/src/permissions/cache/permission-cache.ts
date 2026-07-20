import { AccessContext } from '@sfa/shared';

/**
 * Cache abstraction for resolved {@link AccessContext} objects, keyed by user
 * id. Two implementations exist: a no-op cache (DB is hit on every request) and
 * a Redis-backed cache. The active implementation is chosen at startup based on
 * whether `REDIS_URL` is configured, so call sites never change.
 */
export abstract class PermissionCache {
  abstract get(userId: string): Promise<AccessContext | null>;
  abstract set(userId: string, context: AccessContext): Promise<void>;
  abstract del(userId: string): Promise<void>;
  abstract delMany(userIds: string[]): Promise<void>;
}
