import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA } from '@nestjs/common/constants';
import { AgencyPermission } from '@sfa/shared';
import { AgencyDomainsController } from '../../src/agency-domains/agency-domains.controller';
import { AgencyEmailController } from '../../src/agency-email/agency-email.controller';
import {
  IS_PUBLIC_KEY,
  REQUIRE_PERMISSIONS_KEY,
} from '../../src/common/decorators/access.decorators';
import { AgencyBrandingController } from '../../src/tenant-branding/tenant-branding.controller';

/**
 * PAC-133. `PermissionsGuard` admits a route that declares no permission, so a
 * forgotten decorator is not a 403 — it is an open door. That is how
 * `DELETE /agency/domains/:domainId` shipped callable by every user in the
 * agency. These three controllers are `@SkipModule`, so no module gate stands
 * behind them either: the permission is the only check.
 *
 * Read off the decorator metadata rather than through HTTP, so a new route
 * added to any of them is covered without anyone remembering to write a test.
 */
describe('white-label settings controllers', () => {
  const controllers = [
    {
      name: AgencyDomainsController.name,
      prototype: AgencyDomainsController.prototype as object,
      read: AgencyPermission.DomainsRead,
      write: AgencyPermission.DomainsWrite,
    },
    {
      name: AgencyBrandingController.name,
      prototype: AgencyBrandingController.prototype as object,
      read: AgencyPermission.BrandingRead,
      write: AgencyPermission.BrandingWrite,
    },
    {
      name: AgencyEmailController.name,
      prototype: AgencyEmailController.prototype as object,
      read: AgencyPermission.EmailRead,
      write: AgencyPermission.EmailWrite,
    },
  ];

  /** Every method carrying a Nest HTTP verb decorator. */
  function routes(prototype: object) {
    return Object.getOwnPropertyNames(prototype)
      .filter((key) => key !== 'constructor')
      .map((key) => ({
        key,
        handler: (prototype as Record<string, unknown>)[key] as object,
      }))
      .map(({ key, handler }) => ({
        key,
        handler,
        // `RequestMethod.GET` is 0, so compare against undefined, not falsiness.
        method: Reflect.getMetadata(METHOD_METADATA, handler) as
          RequestMethod | undefined,
      }))
      .filter((route) => route.method !== undefined);
  }

  describe.each(controllers)('$name', ({ prototype, read, write }) => {
    const found = routes(prototype);

    it('has routes to check', () => {
      // Guards the rest against passing vacuously if Nest's metadata key moves.
      expect(found.length).toBeGreaterThan(0);
    });

    it.each(found)('$key is not public', ({ handler }) => {
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBeUndefined();
    });

    it.each(found)(
      '$key requires read for GET and write for anything else',
      ({ handler, method }) => {
        const required = Reflect.getMetadata(
          REQUIRE_PERMISSIONS_KEY,
          handler,
        ) as string[] | undefined;
        expect(required).toEqual([method === RequestMethod.GET ? read : write]);
      },
    );
  });
});
