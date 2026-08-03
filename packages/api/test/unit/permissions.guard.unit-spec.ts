import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  REQUIRE_ANY_PERMISSIONS_KEY,
  REQUIRE_PERMISSIONS_KEY,
} from '../../src/common/decorators/access.decorators';
import { PermissionsGuard } from '../../src/common/guards/permissions.guard';

/**
 * Pins the multi-permission (OR) path independently of any feature that uses
 * it. `@RequireAnyPermission` exists so data that renders on more than one page
 * (households/policies) can be read with either page's permission.
 */
describe('PermissionsGuard', () => {
  function buildContext(permissions: string[]): ExecutionContext {
    const request = { access: { permissions } };
    return {
      getHandler: () => 'handler',
      getClass: () => 'class',
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  /** Stub reflector returning the given metadata per key. */
  function buildGuard(metadata: Record<string, string[] | undefined>) {
    const reflector = {
      getAllAndOverride: (key: string) => metadata[key],
    } as unknown as Reflector;
    return new PermissionsGuard(reflector);
  }

  it('passes when no permission metadata is declared', () => {
    const guard = buildGuard({});
    expect(guard.canActivate(buildContext([]))).toBe(true);
  });

  describe('AND-set (@RequirePermissions)', () => {
    it('passes when every listed permission is held', () => {
      const guard = buildGuard({
        [REQUIRE_PERMISSIONS_KEY]: ['clients:read', 'clients:write'],
      });
      const ctx = buildContext(['clients:read', 'clients:write']);
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('rejects when only some are held', () => {
      const guard = buildGuard({
        [REQUIRE_PERMISSIONS_KEY]: ['clients:read', 'clients:write'],
      });
      expect(() => guard.canActivate(buildContext(['clients:read']))).toThrow(
        ForbiddenException,
      );
    });
  });

  describe('OR-set (@RequireAnyPermission)', () => {
    const anyMeta = {
      [REQUIRE_ANY_PERMISSIONS_KEY]: ['clients:read', 'crm_service:read'],
    };

    it('passes when the user holds one of them', () => {
      const guard = buildGuard(anyMeta);
      // A CSR holds crm_service:read but NOT clients:read.
      expect(guard.canActivate(buildContext(['crm_service:read']))).toBe(true);
    });

    it('passes when the user holds the other one', () => {
      const guard = buildGuard(anyMeta);
      expect(guard.canActivate(buildContext(['clients:read']))).toBe(true);
    });

    it('passes when the user holds both', () => {
      const guard = buildGuard(anyMeta);
      const ctx = buildContext(['clients:read', 'crm_service:read']);
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('rejects when the user holds neither', () => {
      const guard = buildGuard(anyMeta);
      expect(() => guard.canActivate(buildContext(['leads:read']))).toThrow(
        ForbiddenException,
      );
    });
  });

  describe('AND-set combined with OR-set', () => {
    const bothMeta = {
      [REQUIRE_PERMISSIONS_KEY]: ['leads:read'],
      [REQUIRE_ANY_PERMISSIONS_KEY]: ['clients:read', 'crm_service:read'],
    };

    it('passes only when both sets are satisfied', () => {
      const guard = buildGuard(bothMeta);
      const ctx = buildContext(['leads:read', 'crm_service:read']);
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('rejects when only the AND-set is satisfied', () => {
      const guard = buildGuard(bothMeta);
      expect(() => guard.canActivate(buildContext(['leads:read']))).toThrow(
        ForbiddenException,
      );
    });

    it('rejects when only the OR-set is satisfied', () => {
      const guard = buildGuard(bothMeta);
      expect(() =>
        guard.canActivate(buildContext(['crm_service:read'])),
      ).toThrow(ForbiddenException);
    });
  });
});
