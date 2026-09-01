import {
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessContext, AccessScope, DataScope } from '@sfa/shared';
import { HostTenantGuard } from './host-tenant.guard';
import type {
  HostTenant,
  HostTenantResolver,
} from '../tenancy/host-tenant.resolver';
import type { AuthenticatedRequest } from '../types/authenticated-request';

const AGENCY_A = '6941fdb2dc9a6d024fd8c3a1';
const AGENCY_B = '6941fdb2dc9a6d024fd8c3b2';

function access(overrides: Partial<AccessContext> = {}): AccessContext {
  return {
    userId: '507f1f77bcf86cd799439011',
    agencyId: AGENCY_A,
    branchId: '6941fdb2dc9a6d024fd8bc53',
    isPlatformAdmin: false,
    scope: AccessScope.Agency,
    dataScope: DataScope.Agency,
    permissions: [],
    roleIds: [],
    ...overrides,
  };
}

function contextFor(request: Partial<AuthenticatedRequest>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

/** A reflector that reports every route as public / not public. */
function reflectorSaying(isPublic: boolean): Reflector {
  return {
    getAllAndOverride: () => isPublic,
  } as unknown as Reflector;
}

/** A resolver stub reporting whether the agency already owns a hostname. */
function resolverSaying(hasDomains: boolean): HostTenantResolver {
  return {
    agencyHasDomains: () => Promise.resolve(hasDomains),
  } as unknown as HostTenantResolver;
}

const AGENCY_A_HOST: HostTenant = {
  kind: 'agency',
  agencyId: AGENCY_A,
  hostname: 'texasholdings.com',
};
const PLATFORM_HOST: HostTenant = {
  kind: 'platform',
  hostname: 'app.smithfamily.agency',
};
const UNKNOWN_HOST: HostTenant = { kind: 'unknown', hostname: 'nope.example' };

describe('HostTenantGuard', () => {
  /** Default: the agency already has a host, so the fallback does not apply. */
  const guard = (hasDomains = true) =>
    new HostTenantGuard(reflectorSaying(false), resolverSaying(hasDomains));

  describe('on an agency host', () => {
    it('admits a user of that agency', async () => {
      await expect(
        guard().canActivate(
          contextFor({ hostTenant: AGENCY_A_HOST, access: access() }),
        ),
      ).resolves.toBe(true);
    });

    /**
     * The requirement this whole feature exists for, and the case a
     * branding-only implementation would silently get wrong.
     */
    it('rejects a user of a different agency', async () => {
      await expect(
        guard().canActivate(
          contextFor({
            hostTenant: AGENCY_A_HOST,
            access: access({ agencyId: AGENCY_B }),
          }),
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects a platform admin', async () => {
      // The one account that can reach every agency must not also be the one
      // whose host binding means nothing.
      await expect(
        guard().canActivate(
          contextFor({
            hostTenant: AGENCY_A_HOST,
            access: access({ agencyId: null, isPlatformAdmin: true }),
          }),
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects a user with no agency at all', async () => {
      await expect(
        guard().canActivate(
          contextFor({
            hostTenant: AGENCY_A_HOST,
            access: access({ agencyId: null }),
          }),
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('on the platform host', () => {
    it('admits a platform admin', async () => {
      await expect(
        guard().canActivate(
          contextFor({
            hostTenant: PLATFORM_HOST,
            access: access({ agencyId: null, isPlatformAdmin: true }),
          }),
        ),
      ).resolves.toBe(true);
    });

    it('rejects an agency user whose agency has its own host', async () => {
      await expect(
        guard(true).canActivate(
          contextFor({ hostTenant: PLATFORM_HOST, access: access() }),
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    /**
     * The bootstrap case. Without it, deploying white-labelling locks every
     * pre-existing agency out: refused on the platform host, and with no host
     * of their own to be refused *to*.
     */
    it('admits an agency user whose agency has no host yet', async () => {
      await expect(
        guard(false).canActivate(
          contextFor({ hostTenant: PLATFORM_HOST, access: access() }),
        ),
      ).resolves.toBe(true);
    });

    it('still rejects a user with no agency and no admin flag', async () => {
      await expect(
        guard(false).canActivate(
          contextFor({
            hostTenant: PLATFORM_HOST,
            access: access({ agencyId: null }),
          }),
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('on an unknown host', () => {
    it('404s even for a platform admin', async () => {
      // 404 rather than 403: nothing should confirm a live app is here.
      await expect(
        guard().canActivate(
          contextFor({
            hostTenant: UNKNOWN_HOST,
            access: access({ agencyId: null, isPlatformAdmin: true }),
          }),
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  it('fails closed when the middleware did not run', async () => {
    // A wiring mistake must not silently disable the boundary.
    await expect(
      guard().canActivate(contextFor({ access: access() })),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects an unauthenticated request on a known host', async () => {
    await expect(
      guard().canActivate(contextFor({ hostTenant: AGENCY_A_HOST })),
    ).rejects.toThrow(ForbiddenException);
  });

  it('skips public routes entirely', async () => {
    // No host, no session — a public route must still pass.
    const publicGuard = new HostTenantGuard(
      reflectorSaying(true),
      resolverSaying(true),
    );
    await expect(publicGuard.canActivate(contextFor({}))).resolves.toBe(true);
  });
});
