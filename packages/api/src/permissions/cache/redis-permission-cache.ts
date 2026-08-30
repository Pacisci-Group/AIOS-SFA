import { Logger, OnModuleDestroy } from '@nestjs/common';
import { AccessContext } from '@sfa/shared';
import Redis from 'ioredis';
import { PermissionCache } from './permission-cache';

/**
 * Versioned on purpose. Entries hold a serialized {@link AccessContext}, so
 * **adding a field to that interface invalidates every warm entry** — a cached
 * context deserializes without the new field and the code reading it sees
 * `undefined` rather than a value, with no error anywhere.
 *
 * Bump `v2` whenever `AccessContext` gains or loses a field. Old keys are left
 * to expire on their own TTL rather than scanned and deleted; they are simply
 * never read again.
 *
 * `v2` = `roleIds` added for polymorphic ownership (PAC-72).
 * `v3` = relational RBAC — permissions, roles and overrides resolved from the
 *        `permissions` / `rolePermissions` / `userRoles` / `userPermissions`
 *        collections instead of arrays on the user and role documents.
 * `v4` = `tokenVersion` added so a password reset can end live sessions
 *        (PAC-79).
 */
const KEY_PREFIX = 'sfa:perm:v4:';

/**
 * Redis-backed cache for resolved access contexts. Entries carry a safety TTL
 * so that any missed invalidation self-heals within the TTL window. Explicit
 * invalidation (on role/permission/module changes) keeps entries fresh in the
 * common case.
 */
export class RedisPermissionCache
  extends PermissionCache
  implements OnModuleDestroy
{
  private readonly logger = new Logger(RedisPermissionCache.name);

  constructor(
    private readonly client: Redis,
    private readonly ttlSeconds: number,
  ) {
    super();
    this.client.on('error', (err) =>
      this.logger.error(`Redis permission cache error: ${err.message}`),
    );
  }

  private key(userId: string): string {
    return `${KEY_PREFIX}${userId}`;
  }

  async get(userId: string): Promise<AccessContext | null> {
    try {
      const raw = await this.client.get(this.key(userId));
      return raw ? (JSON.parse(raw) as AccessContext) : null;
    } catch (err) {
      // Fail open to the DB rather than blocking requests on a cache outage.
      this.logger.warn(`Cache get failed for ${userId}: ${String(err)}`);
      return null;
    }
  }

  async set(userId: string, context: AccessContext): Promise<void> {
    try {
      await this.client.set(
        this.key(userId),
        JSON.stringify(context),
        'EX',
        this.ttlSeconds,
      );
    } catch (err) {
      this.logger.warn(`Cache set failed for ${userId}: ${String(err)}`);
    }
  }

  async del(userId: string): Promise<void> {
    try {
      await this.client.del(this.key(userId));
    } catch (err) {
      this.logger.warn(`Cache del failed for ${userId}: ${String(err)}`);
    }
  }

  async delMany(userIds: string[]): Promise<void> {
    if (!userIds.length) {
      return;
    }
    try {
      await this.client.del(...userIds.map((id) => this.key(id)));
    } catch (err) {
      this.logger.warn(`Cache delMany failed: ${String(err)}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => this.client.disconnect());
  }
}
