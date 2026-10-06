import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AgencyPermission, type AgencyProfileView } from '@sfa/shared';
import { AppModule } from '../src/app.module';
import { sweepMarkerAfterScheduleChange } from '../src/common/dates/end-of-day';
import { localClock } from '../src/common/dates/time-zones';
import { AccessResolverService } from '../src/permissions/access-resolver.service';
import { RolePermission } from '../src/permissions/schemas/role-permission.schema';
import { Agency } from '../src/platform/schemas/agency.schema';
import { dropTestDatabase, closeTestApp } from './helpers/test-app';
import {
  seedTestData,
  TEST_PASSWORD,
  TestSeedContext,
} from './helpers/seed-test-data';

/**
 * The agency's working day — its time zone (PAC-141) and its end-of-day Away
 * hour (PAC-149): the owner reads and changes them, the dashboards follow the
 * zone, the nightly Away sweep is not tripped by either change, and the gate
 * is `agency:settings:*`, not branding.
 */
describe('Agency profile (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestSeedContext;
  let ownerToken: string;
  let producerToken: string;
  let superAdminToken: string;
  let agencies: Model<Agency>;
  let rolePermissions: Model<RolePermission>;

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
    agencies
      .findById(ctx.agencyId)
      .select('timezone endOfDayHour availabilitySweep')
      .lean<{
        timezone?: string;
        endOfDayHour?: number;
        availabilitySweep?: { lastAwayDate: string | null };
      }>();

  const setMarker = (lastAwayDate: string) =>
    agencies.updateOne(
      { _id: ctx.agencyId },
      { $set: { 'availabilitySweep.lastAwayDate': lastAwayDate } },
    );

  const marker = async () =>
    (await stored())?.availabilitySweep?.lastAwayDate ?? null;

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
    rolePermissions = app.get<Model<RolePermission>>(
      getModelToken(RolePermission.name),
    );

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
        $set: { timezone: 'America/Chicago', endOfDayHour: 20 },
        $unset: { availabilitySweep: 1 },
      },
    );
  });

  describe('reading', () => {
    it('returns the name, the zone and the hour to the owner', async () => {
      const body = (await get(ownerToken).expect(200))
        .body as AgencyProfileView;
      expect(body).toEqual({
        agencyName: 'Test Agency',
        timezone: 'America/Chicago',
        endOfDayHour: 20,
      });
    });

    it('reads an agency that predates both fields as Central, 8 PM', async () => {
      // `.lean()` applies no defaults; the backfill migrations fill the
      // fields, but the view must not blank out on a database that has not
      // run them.
      await agencies.updateOne(
        { _id: ctx.agencyId },
        { $unset: { timezone: 1, endOfDayHour: 1 } },
      );
      const body = (await get(ownerToken).expect(200))
        .body as AgencyProfileView;
      expect(body.timezone).toBe('America/Chicago');
      expect(body.endOfDayHour).toBe(20);
    });

    it('is agency:settings:read — a producer is refused', async () => {
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
      ['neither field', {}],
      ['hour 24', { endOfDayHour: 24 }],
      ['hour -1', { endOfDayHour: -1 }],
      ['a fractional hour', { endOfDayHour: 7.5 }],
      ['the hour as a string', { endOfDayHour: '20' }],
      ['a good zone beside a bad hour', { timezone: 'UTC', endOfDayHour: 24 }],
    ])('refuses %s with a 400 and changes nothing', async (_label, body) => {
      await patch(ownerToken, body).expect(400);
      const row = await stored();
      expect(row?.timezone).toBe('America/Chicago');
      expect(row?.endOfDayHour).toBe(20);
    });

    it('stores a new hour and echoes it, leaving the zone alone', async () => {
      const body = (await patch(ownerToken, { endOfDayHour: 18 }).expect(200))
        .body as AgencyProfileView;
      expect(body).toEqual({
        agencyName: 'Test Agency',
        timezone: 'America/Chicago',
        endOfDayHour: 18,
      });
      const row = await stored();
      expect(row?.endOfDayHour).toBe(18);
      expect(row?.timezone).toBe('America/Chicago');
    });

    it('stores both fields in one save', async () => {
      await patch(ownerToken, {
        timezone: 'Asia/Kolkata',
        endOfDayHour: 0,
      }).expect(200);
      const row = await stored();
      expect(row?.timezone).toBe('Asia/Kolkata');
      expect(row?.endOfDayHour).toBe(0);
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
      await patch(producerToken, { endOfDayHour: 9 }).expect(403);
      const row = await stored();
      expect(row?.timezone).toBe('America/Chicago');
      expect(row?.endOfDayHour).toBe(20);
    });

    it('re-stamps the Away marker so the next sweep is the next end-of-day hour on the new clock', async () => {
      await setMarker('2026-01-01');
      // Whichever side of 8 PM Kiritimati is right now, the marker must agree
      // with the rule, and must no longer be the old clock's date.
      const expected = sweepMarkerAfterScheduleChange(
        new Date(),
        'Pacific/Kiritimati',
        20,
      );
      await patch(ownerToken, { timezone: 'Pacific/Kiritimati' }).expect(200);
      expect(await marker()).toBe(expected);
    });

    it('marks tonight done when the new hour has already passed', async () => {
      // Hour 0 has always passed: whenever this runs, moving the hour there
      // must not put the office Away on the next tick.
      await setMarker('2026-01-01');
      await patch(ownerToken, { endOfDayHour: 0 }).expect(200);
      expect(await marker()).toBe(
        localClock(new Date(), 'America/Chicago').date,
      );
    });

    it('clears the marker when the new hour is still ahead tonight', async () => {
      // 11 PM is ahead of the Chicago clock except between 23:00 and
      // midnight; the helper says which, the service must agree with it.
      await setMarker('2026-01-01');
      const expected = sweepMarkerAfterScheduleChange(
        new Date(),
        'America/Chicago',
        23,
      );
      await patch(ownerToken, { endOfDayHour: 23 }).expect(200);
      expect(await marker()).toBe(expected);
    });

    it('leaves the marker alone when neither field changes', async () => {
      await setMarker('2026-01-01');
      await patch(ownerToken, { timezone: 'America/Chicago' }).expect(200);
      await patch(ownerToken, { endOfDayHour: 20 }).expect(200);
      await patch(ownerToken, {
        timezone: 'America/Chicago',
        endOfDayHour: 20,
      }).expect(200);
      expect(await marker()).toBe('2026-01-01');
    });

    it('is agency:settings:write, not branding — an owner without it is refused', async () => {
      // An owner whose role lacks the new key: what every existing owner would
      // have been without the grant migration, and what an owner looks like
      // after a hand edit. They still hold `agency:branding:write`, which is
      // the point — that pair must no longer open this endpoint.
      const key = AgencyPermission.SettingsWrite;
      const row = await rolePermissions
        .findOne({ roleId: ctx.ownerRoleId, permissionKey: key })
        .lean();
      if (!row) {
        throw new Error(`The owner template no longer grants ${key}`);
      }
      const accessResolver = app.get(AccessResolverService);

      await rolePermissions.deleteOne({ _id: row._id });
      await accessResolver.invalidateAgency(ctx.agencyId);
      try {
        const token = await login(ctx.ownerEmail);
        await get(token).expect(200);
        await patch(token, { endOfDayHour: 9 }).expect(403);
        await request(app.getHttpServer())
          .patch('/api/v1/agency/branding')
          .set('Authorization', `Bearer ${token}`)
          .send({ tagline: 'PAC-149' })
          .expect(200);
        expect((await stored())?.endOfDayHour).toBe(20);
      } finally {
        await rolePermissions.create(row);
        await accessResolver.invalidateAgency(ctx.agencyId);
      }
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
