import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
import { AgencyDomainDocument } from '../../platform/schemas/agency-domain.schema';
import { TenantUrlService } from './tenant-url.service';

const AGENCY_ID = '6941fdb2dc9a6d024fd8c3a1';
const PLATFORM = 'https://app.smithfamily.agency';

/**
 * A model stub whose `findOne(...).select(...).sort(...).lean()` yields
 * `domain`, and which records the query so the ordering can be asserted.
 */
function modelReturning(
  domain: { hostname: string } | null,
  captured: { filter?: unknown; sort?: unknown } = {},
): Model<AgencyDomainDocument> {
  return {
    findOne: (filter: unknown) => {
      captured.filter = filter;
      return {
        select: () => ({
          sort: (sort: unknown) => {
            captured.sort = sort;
            return { lean: () => Promise.resolve(domain) };
          },
        }),
      };
    },
  } as unknown as Model<AgencyDomainDocument>;
}

function service(
  domain: { hostname: string } | null,
  captured: { filter?: unknown; sort?: unknown } = {},
) {
  const config = {
    get: (key: string) => (key === 'APP_BASE_URL' ? PLATFORM : undefined),
  } as unknown as ConfigService;
  return new TenantUrlService(modelReturning(domain, captured), config);
}

describe('TenantUrlService', () => {
  it('uses the agency’s own host', async () => {
    const url = await service({ hostname: 'texasholdings.com' }).baseUrlFor(
      AGENCY_ID,
    );
    expect(url).toBe('https://texasholdings.com');
  });

  /**
   * The case that keeps existing agencies working. An agency onboarded before
   * white-labelling — or one created five minutes ago — has no domain yet, and
   * its invites must still point somewhere that works.
   */
  it('falls back to the platform origin when the agency has no domain', async () => {
    const url = await service(null).baseUrlFor(AGENCY_ID);
    expect(url).toBe(PLATFORM);
  });

  it.each([null, undefined, 'not-an-object-id'])(
    'falls back for agencyId %p',
    async (agencyId) => {
      // A platform super admin has no agency at all; a malformed id must not
      // reach Mongo as a cast error.
      const url = await service(null).baseUrlFor(agencyId);
      expect(url).toBe(PLATFORM);
    },
  );

  it('only ever considers active domains', async () => {
    // A pending domain serves nothing, so a link pointing at one is dead.
    const captured: { filter?: unknown } = {};
    await service(null, captured).baseUrlFor(AGENCY_ID);
    expect(captured.filter).toMatchObject({ status: 'active' });
  });

  it('prefers the primary, then the oldest', async () => {
    // The second half matters as much as the first: an unstable fallback would
    // mean two invites sent minutes apart pointing at different hosts.
    const captured: { sort?: unknown } = {};
    await service({ hostname: 'a.com' }, captured).baseUrlFor(AGENCY_ID);
    expect(captured.sort).toEqual({ isPrimary: -1, createdAt: 1 });
  });

  it('strips a trailing slash from the configured base', async () => {
    const config = {
      get: () => 'https://app.smithfamily.agency/',
    } as unknown as ConfigService;
    const svc = new TenantUrlService(modelReturning(null), config);
    // Otherwise every built URL contains a double slash — cosmetic in a browser,
    // but it lands verbatim in emails and support tickets.
    expect(await svc.baseUrlFor(AGENCY_ID)).toBe(PLATFORM);
  });
});
