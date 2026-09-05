import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import type { CarrierAppointmentsResponse } from '@sfa/shared';
import { AppModule } from '../src/app.module';
import { Carrier } from '../src/carriers/schemas/carrier.schema';
import { Agency } from '../src/platform/schemas/agency.schema';
import { dropTestDatabase, closeTestApp } from './helpers/test-app';
import {
  seedTestData,
  TEST_PASSWORD,
  TestSeedContext,
} from './helpers/seed-test-data';

/**
 * The agency's own carrier appointments (PAC-93).
 *
 * Its own suite rather than a block in `api.e2e-spec.ts` because the uniqueness
 * cases need the index to actually exist, which means rebuilding it after the
 * database drop — see the note in `beforeAll`.
 */
describe('Carrier appointments (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestSeedContext;
  let ownerToken: string;
  let producerToken: string;
  let superAdminToken: string;

  let agencies: Model<Agency>;
  let carriers: Model<Carrier>;
  let allstateId: Types.ObjectId;
  let travelersId: Types.ObjectId;

  const get = (token: string) =>
    request(app.getHttpServer())
      .get('/api/v1/agency/carrier-appointments')
      .set('Authorization', `Bearer ${token}`);

  const put = (token: string, appointments: unknown[]) =>
    request(app.getHttpServer())
      .put('/api/v1/agency/carrier-appointments')
      .set('Authorization', `Bearer ${token}`)
      .send({ appointments });

  const login = async (email: string) => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: TEST_PASSWORD })
      .expect(201);
    return (response.body as { accessToken: string }).accessToken;
  };

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
    carriers = app.get<Model<Carrier>>(getModelToken(Carrier.name));

    /*
     * ⚠ `dropTestDatabase` runs after `app.init()`, so `autoIndex` has already
     * built the indexes and will not run again — the collection is left with
     * none. Without this the cross-agency case would pass for the wrong reason:
     * the service pre-flight would catch it and the E11000 path would never be
     * exercised.
     */
    await agencies.syncIndexes();

    const [allstate, travelers] = await carriers.create([
      {
        agencyId: null,
        name: 'Allstate',
        slug: 'allstate',
        active: true,
        displayOrder: 0,
      },
      { agencyId: null, name: 'Travelers', slug: 'travelers', active: true },
    ]);
    allstateId = allstate._id;
    travelersId = travelers._id;

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
      { $set: { carrierAppointments: [] } },
    );
    // Anything a cross-agency case parked on another tenant.
    await agencies.deleteMany({ slug: 'rival-agency' });
  });

  describe('reading', () => {
    it('returns the appointments and the carriers one may pick', async () => {
      const response = await get(ownerToken).expect(200);
      const body = response.body as CarrierAppointmentsResponse;

      expect(body.appointments).toEqual([]);
      // Globals only. An agency-scoped carrier is not an appointment target,
      // so offering one in the picker would guarantee a 400.
      expect(body.carrierOptions.map((c) => c.name).sort()).toEqual([
        'Allstate',
        'Travelers',
      ]);
    });

    it('resolves the carrier name so the client never has to join', async () => {
      await put(ownerToken, [
        { carrierId: allstateId.toString(), carrierAgencyCode: 'A0B9049' },
      ]).expect(200);

      const body = (await get(ownerToken).expect(200))
        .body as CarrierAppointmentsResponse;
      expect(body.appointments[0]).toMatchObject({
        carrierName: 'Allstate',
        carrierAgencyCode: 'A0B9049',
        isPrimary: true,
        active: true,
      });
    });
  });

  describe('writing', () => {
    it('derives the code key and makes the first row primary', async () => {
      const response = await put(ownerToken, [
        { carrierId: allstateId.toString(), carrierAgencyCode: ' a0b9049 ' },
      ]).expect(200);

      expect(
        (response.body as { appointments: unknown[] }).appointments[0],
      ).toMatchObject({ carrierAgencyCode: 'a0b9049', isPrimary: true });

      const stored = await agencies.findById(ctx.agencyId).lean();
      // Stored as issued; matched on the normalized key.
      expect(stored?.carrierAppointments[0].codeKey).toBe('A0B9049');
    });

    it('drops a row with no code rather than storing half an appointment', async () => {
      const response = await put(ownerToken, [
        { carrierId: allstateId.toString(), carrierAgencyCode: 'A0B9049' },
        { carrierId: travelersId.toString() },
      ]).expect(200);

      expect(
        (response.body as { appointments: unknown[] }).appointments,
      ).toHaveLength(1);
    });

    it('replaces the whole list', async () => {
      await put(ownerToken, [
        { carrierId: allstateId.toString(), carrierAgencyCode: 'A0B9049' },
      ]).expect(200);
      const response = await put(ownerToken, [
        { carrierId: travelersId.toString(), carrierAgencyCode: '123456' },
      ]).expect(200);

      const appointments = (response.body as { appointments: unknown[] })
        .appointments;
      expect(appointments).toHaveLength(1);
      expect(appointments[0]).toMatchObject({ carrierName: 'Travelers' });
    });

    it('moves the primary flag to an active row', async () => {
      // A primary that is switched off is a contradiction — the primary is the
      // carrier the agency mainly writes under.
      const response = await put(ownerToken, [
        {
          carrierId: allstateId.toString(),
          carrierAgencyCode: 'A0B9049',
          isPrimary: true,
          active: false,
        },
        { carrierId: travelersId.toString(), carrierAgencyCode: '123456' },
      ]).expect(200);

      const appointments = (
        response.body as {
          appointments: { carrierName: string; isPrimary: boolean }[];
        }
      ).appointments;
      expect(
        appointments.find((a) => a.carrierName === 'Travelers')?.isPrimary,
      ).toBe(true);
      expect(
        appointments.find((a) => a.carrierName === 'Allstate')?.isPrimary,
      ).toBe(false);
    });

    it('refuses two primaries', async () => {
      await put(ownerToken, [
        {
          carrierId: allstateId.toString(),
          carrierAgencyCode: 'A0B9049',
          isPrimary: true,
        },
        {
          carrierId: travelersId.toString(),
          carrierAgencyCode: '123456',
          isPrimary: true,
        },
      ]).expect(400);
    });

    it('refuses the same pair listed twice', async () => {
      /*
       * The index cannot catch this: MongoDB's unique constraint applies across
       * separate documents and explicitly permits one document's array to
       * repeat index-key values. It is a service rule or it is nothing.
       */
      const response = await put(ownerToken, [
        { carrierId: allstateId.toString(), carrierAgencyCode: 'A0B9049' },
        { carrierId: allstateId.toString(), carrierAgencyCode: 'a0b9049' },
      ]).expect(400);

      // Names the code as the caller typed it, not the normalized key — an
      // error must never quote a value back that nobody entered.
      expect((response.body as { message: string }).message).toContain(
        'a0b9049',
      );
    });

    it('allows the same code under two different carriers', async () => {
      const response = await put(ownerToken, [
        { carrierId: allstateId.toString(), carrierAgencyCode: 'SAME1' },
        { carrierId: travelersId.toString(), carrierAgencyCode: 'SAME1' },
      ]).expect(200);

      expect(
        (response.body as { appointments: unknown[] }).appointments,
      ).toHaveLength(2);
    });

    it('refuses a code another agency already holds', async () => {
      await agencies.create({
        name: 'Rival Agency',
        slug: 'rival-agency',
        carrierAppointments: [
          {
            carrierId: allstateId,
            carrierAgencyCode: 'RIVAL1',
            codeKey: 'RIVAL1',
            isPrimary: true,
            active: true,
          },
        ],
      });

      const response = await put(ownerToken, [
        { carrierId: allstateId.toString(), carrierAgencyCode: 'rival1' },
      ]).expect(409);

      // Names the holder and the code — an operator cannot act on an index name.
      const message = (response.body as { message: string }).message;
      expect(message).toContain('Rival Agency');
      expect(message).toContain('rival1');
    });

    it('still refuses a code held by a deactivated appointment', async () => {
      // Deactivating does not release the pair; only removing it does. This is
      // the surprising half of the rule, so it is pinned.
      await agencies.create({
        name: 'Rival Agency',
        slug: 'rival-agency',
        carrierAppointments: [
          {
            carrierId: allstateId,
            carrierAgencyCode: 'LAPSED',
            codeKey: 'LAPSED',
            isPrimary: true,
            active: false,
          },
        ],
      });

      await put(ownerToken, [
        { carrierId: allstateId.toString(), carrierAgencyCode: 'LAPSED' },
      ]).expect(409);
    });

    it('refuses an agency-scoped carrier as a target', async () => {
      const custom = await carriers.create({
        agencyId: ctx.agencyId,
        name: 'Backyard Mutual',
        slug: 'backyard-mutual',
        active: true,
      });

      await put(ownerToken, [
        { carrierId: custom._id.toString(), carrierAgencyCode: 'X1' },
      ]).expect(400);
    });

    it('refuses a carrierId that is not an ObjectId', async () => {
      // A 400 naming the field, never a 500 out of a Mongoose cast.
      await put(ownerToken, [
        { carrierId: 'Allstate', carrierAgencyCode: 'X1' },
      ]).expect(400);
    });
  });

  describe('permissions', () => {
    it('refuses a producer on both routes', async () => {
      // `agency:carrier_appointments:*` is an admin capability: it reaches the
      // Agency Owner through the role template, never through
      // `grantsAllEnabledModules`.
      await get(producerToken).expect(403);
      await put(producerToken, []).expect(403);
    });

    it('refuses a platform operator, who has no agency of their own', async () => {
      await get(superAdminToken).expect(403);
    });

    it('lets a platform operator read the global carrier catalog', async () => {
      // `GET /carriers` is module-gated and unreachable for them; this is the
      // route `carrier.schema.ts` reserved.
      const response = await request(app.getHttpServer())
        .get('/api/v1/platform/carriers')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(200);

      expect(
        (response.body as { carriers: { name: string }[] }).carriers.length,
      ).toBeGreaterThanOrEqual(2);
    });

    it('refuses an agency owner on the platform catalog', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/platform/carriers')
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(403);
    });
  });
});
