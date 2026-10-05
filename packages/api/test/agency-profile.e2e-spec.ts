import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import type { AgencyProfileView } from '@sfa/shared';
import { AppModule } from '../src/app.module';
import { sweepMarkerAfterZoneChange } from '../src/common/dates/end-of-day';
import { Agency } from '../src/platform/schemas/agency.schema';
import { dropTestDatabase, closeTestApp } from './helpers/test-app';
import {
  seedTestData,
  TEST_PASSWORD,
  TestSeedContext,
} from './helpers/seed-test-data';

/**
 * The agency's own time zone (PAC-141): the owner reads and changes it, the
 * dashboards follow it, and the nightly Away sweep is not tripped by the
 * change.
 */
describe('Agency profile (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestSeedContext;
  let ownerToken: string;
  let producerToken: string;
  let superAdminToken: string;
  let agencies: Model<Agency>;

  const get = (token: string) =>
    request(app.getHttpServer())
      .get('/api/v1/agency/profile')
      .set('Authorization', `Bearer ${token}`);

  const patch = (token: string, body: unknown) =>
    request(app.getHttpServer())
      .patch('/api/v1/agency/profile')
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  const todayFor = async (token: string) => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/performance?range=today')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return (res.body as { range: { from: string; to: string } }).range;
  };

  const login = async (email: string) => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: TEST_PASSWORD })
      .expect(201);
    return (response.body as { accessToken: string }).accessToken;
  };

  const stored = () =>
    agencies.findById(ctx.agencyId).select('timezone availabilitySweep').lean<{
      timezone?: string;
      availabilitySweep?: { lastAwayDate: string | null };
    }>();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication<INestApplication<App>>();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();

    await dropTestDatabase(app);
    ctx = await seedTestData(app);
    agencies = app.get<Model<Agency>>(getModelToken(Agency.name));

    ownerToken = await login(ctx.ownerEmail);
    producerToken = await login(ctx.producerEmail);
    superAdminToken = await login(ctx.superAdminEmail);
  });

  afterAll(async () => {
    if (app) {
      await dropTestDatabase(app);
      await closeTestApp(app);
    }
  });

  beforeEach(async () => {
    await agencies.updateOne(
      { _id: ctx.agencyId },
      {
        $set: { timezone: 'America/Chicago' },
        $unset: { availabilitySweep: 1 },
      },
    );
  });

  describe('reading', () => {
    it('returns the name and the zone to the owner', async () => {
      const body = (await get(ownerToken).expect(200))
        .body as AgencyProfileView;
      expect(body).toEqual({
        agencyName: 'Test Agency',
        timezone: 'America/Chicago',
      });
    });

    it('reads an agency that predates the field as Central', async () => {
      // `.lean()` applies no defaults; the backfill migration fills the field,
      // but the view must not blank out on a database that has not run it.
      await agencies.updateOne(
        { _id: ctx.agencyId },
        { $unset: { timezone: 1 } },
      );
      const body = (await get(ownerToken).expect(200))
        .body as AgencyProfileView;
      expect(body.timezone).toBe('America/Chicago');
    });

    it('is the branding permission: a producer is refused', async () => {
      await get(producerToken).expect(403);
    });

    it('is tenant-side: a platform account is refused', async () => {
      await get(superAdminToken).expect(403);
    });
  });

  describe('writing', () => {
    it('stores a new zone and echoes it', async () => {
      const body = (
        await patch(ownerToken, { timezone: 'Asia/Kolkata' }).expect(200)
      ).body as AgencyProfileView;
      expect(body.timezone).toBe('Asia/Kolkata');
      expect((await stored())?.timezone).toBe('Asia/Kolkata');
      expect(
        ((await get(ownerToken).expect(200)).body as AgencyProfileView)
          .timezone,
      ).toBe('Asia/Kolkata');
    });

    it.each([
      ['a made-up zone', { timezone: 'Mars/Olympus' }],
      ['a raw offset', { timezone: '+05:30' }],
      ['an empty string', { timezone: '' }],
      ['no zone at all', {}],
    ])('refuses %s with a 400 and changes nothing', async (_label, body) => {
      await patch(ownerToken, body).expect(400);
      expect((await stored())?.timezone).toBe('America/Chicago');
    });

    it('strips an unknown field rather than refusing, like every zod DTO', async () => {
      // zod strips by default; the point is that the extra key never reaches
      // the service. Same contract `onboardAgencySchema` is tested for.
      await patch(ownerToken, { timezone: 'UTC', colour: 'blue' }).expect(200);
      const row = await agencies.findById(ctx.agencyId).lean<{
        timezone?: string;
        colour?: unknown;
      }>();
      expect(row?.timezone).toBe('UTC');
      expect(row).not.toHaveProperty('colour');
    });

    it('refuses a producer', async () => {
      await patch(producerToken, { timezone: 'Asia/Kolkata' }).expect(403);
      expect((await stored())?.timezone).toBe('America/Chicago');
    });

    it('re-stamps the Away marker so the next sweep is the next 8 PM on the new clock', async () => {
      await agencies.updateOne(
        { _id: ctx.agencyId },
        { $set: { 'availabilitySweep.lastAwayDate': '2026-01-01' } },
      );
      // Whichever side of 8 PM Kiritimati is right now, the marker must agree
      // with the rule, and must no longer be the old clock's date.
      const expected = sweepMarkerAfterZoneChange(
        new Date(),
        'Pacific/Kiritimati',
      );
      await patch(ownerToken, { timezone: 'Pacific/Kiritimati' }).expect(200);
      expect((await stored())?.availabilitySweep?.lastAwayDate ?? null).toBe(
        expected,
      );
    });

    it('leaves the marker alone when the zone does not change', async () => {
      await agencies.updateOne(
        { _id: ctx.agencyId },
        { $set: { 'availabilitySweep.lastAwayDate': '2026-01-01' } },
      );
      await patch(ownerToken, { timezone: 'America/Chicago' }).expect(200);
      expect((await stored())?.availabilitySweep?.lastAwayDate).toBe(
        '2026-01-01',
      );
    });

    it('moves the dashboards onto the new calendar on the next request', async () => {
      // Kiritimati (UTC+14) and Etc/GMT+12 (UTC−12) are 26 hours apart, so
      // their "today" never coincides: a different echo proves the window was
      // cut on the stored zone, and that the cached context was invalidated.
      await patch(ownerToken, { timezone: 'Pacific/Kiritimati' }).expect(200);
      const east = await todayFor(ownerToken);
      await patch(ownerToken, { timezone: 'Etc/GMT+12' }).expect(200);
      const west = await todayFor(ownerToken);

      expect(east.from).toBe(east.to);
      expect(west.from).toBe(west.to);
      expect(east.from).not.toBe(west.from);
      expect(east.from > west.from).toBe(true);
    });
  });
});
