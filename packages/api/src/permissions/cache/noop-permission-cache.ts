import { Injectable } from '@nestjs/common';
import { AccessContext } from '@sfa/shared';
import { PermissionCache } from './permission-cache';

/**
 * DB-only cache: never stores anything, so the resolver always reads live from
 * MongoDB. Used when no `REDIS_URL` is configured (the day-one default).
 */
@Injectable()
export class NoopPermissionCache extends PermissionCache {
  get(): Promise<AccessContext | null> {
    return Promise.resolve(null);
  }

  set(): Promise<void> {
    return Promise.resolve();
  }

  del(): Promise<void> {
    return Promise.resolve();
  }

  delMany(): Promise<void> {
    return Promise.resolve();
  }
}
