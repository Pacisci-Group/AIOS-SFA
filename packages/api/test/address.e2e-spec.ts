import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  AddressAutocompleteResponse,
  AddressResolveResponse,
} from '@sfa/shared';
import { AppModule } from '../src/app.module';
import { InngestService } from '../src/inngest/inngest.service';
import { GoogleAddressClient } from '../src/address/google-address.client';
import { authHeader, login } from './helpers/auth.helper';
import {
  TEST_PASSWORD,
  TestSeedContext,
  seedTestData,
} from './helpers/seed-test-data';
import {
  CapturedInngestService,
  closeTestApp,
  createTestApp,
  dropTestDatabase,
} from './helpers/test-app';

/**
 * Address autocomplete (PAC-60).
 *
 * Two properties are worth an e2e rather than a unit test, because both are
 * about the *guard chain* and the wire contract rather than the mapping:
 *
 * 1. **The OR gate really admits a CSR.** The endpoint is reachable from four
 *    different forms owned by four different modules. Gating on a single module
 *    key would 403 the CSR filling in an escrow address on Policy Transfer, and
 *    only a request through the real guard chain proves it does not.
 * 2. **It fails open.** With no `GOOGLE_MAPS_API_KEY` — which is the case in
 *    CI and on most dev machines — the answer must be a `200` carrying
 *    `available: false`, never a 5xx. A 503 per keystroke is the failure mode
 *    this design exists to avoid.
 */
describe('Address (PAC-60)', () => {
  let app: INestApplication<App>;
  let seed: TestSeedContext;
  let producerToken: string;
  let csrToken: string;
  let readOnlyToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    await dropTestDatabase(app);
    seed = await seedTestData(app);

    producerToken = (await login(app, seed.producerEmail, TEST_PASSWORD))
      .accessToken;
    csrToken = (await login(app, seed.csrEmail, TEST_PASSWORD)).accessToken;
    readOnlyToken = (await login(app, seed.readOnlyEmail, TEST_PASSWORD))
      .accessToken;
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  const body = { input: '4821 North Maple', sessionToken: 'e2e-session-token' };

  describe('the guard chain', () => {
    it('rejects an unauthenticated caller', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/address/autocomplete')
        .send(body)
        .expect(401);
    });

    it('rejects a user who can read every page but write none', async () => {
      // The endpoint exists to help someone *fill in* a form, so it is gated on
      // `:write`. A read-only user has no address to type.
      await request(app.getHttpServer())
        .post('/api/v1/address/autocomplete')
        .set(authHeader(readOnlyToken))
        .send(body)
        .expect(403);
    });

    it('admits a producer', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/address/autocomplete')
        .set(authHeader(producerToken))
        .send(body)
        .expect(200);
    });

    it('admits a CSR, who holds no leads permission at all', async () => {
      // The whole reason the gate is an OR over four modules. A CSR fills in an
      // escrow address on Policy Transfer under `crm_service`; gating this on
      // `leads` — the module the feature was first asked for — would 403 them
      // on a control whose only job is to save typing.
      await request(app.getHttpServer())
        .post('/api/v1/address/autocomplete')
        .set(authHeader(csrToken))
        .send(body)
        .expect(200);
    });
  });

  describe('validation', () => {
    it('rejects an input too short to be worth a billed request', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/address/autocomplete')
        .set(authHeader(producerToken))
        .send({ input: '48', sessionToken: 'e2e-session-token' })
        .expect(400);
    });

    it('requires a session token', async () => {
      // Without it every keystroke is billed as its own standalone session.
      await request(app.getHttpServer())
        .post('/api/v1/address/autocomplete')
        .set(authHeader(producerToken))
        .send({ input: '4821 North Maple' })
        .expect(400);
    });
  });

  describe('with no API key configured', () => {
    it('answers 200 with available:false rather than a 5xx', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/address/autocomplete')
        .set(authHeader(producerToken))
        .send(body)
        .expect(200);

      expect(res.body as AddressAutocompleteResponse).toEqual({
        available: false,
        suggestions: [],
      });
    });

    it('answers 200 on resolve too, so a stale dropdown click cannot 500', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/address/resolve')
        .set(authHeader(producerToken))
        .send({ placeId: 'ChIJanything', sessionToken: 'e2e-session-token' })
        .expect(200);

      expect(res.body as AddressResolveResponse).toEqual({
        available: false,
        address: null,
      });
    });
  });
});

/**
 * The resolve path with Google stubbed out.
 *
 * A second app because the client is overridden at the module level. There is
 * no nock/msw in this repo — third-party clients are tested by injecting a
 * hand-rolled fake, the way `resend.transport.unit-spec.ts` does.
 */
describe('Address resolve with a stubbed Google client (PAC-60)', () => {
  let app: INestApplication<App>;
  let producerToken: string;

  const stub = {
    configured: true,
    autocomplete: () =>
      Promise.resolve([
        {
          placeId: 'ChIJstub',
          primaryText: '4821 N Maple Ave',
          secondaryText: 'Oklahoma City, OK, USA',
        },
      ]),
    resolve: () =>
      Promise.resolve({
        street: '4821 North Maple Avenue',
        city: 'Oklahoma City',
        state: 'Oklahoma',
        zip: '73013',
      }),
  };

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(InngestService)
      .useValue(new CapturedInngestService())
      .overrideProvider(GoogleAddressClient)
      .useValue(stub)
      .compile();

    app = moduleFixture.createNestApplication<INestApplication<App>>();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();

    // The database is already seeded by the suite above (jest runs `runInBand`),
    // so this only needs a token.
    producerToken = (await login(app, 'test-producer@sfa.local', TEST_PASSWORD))
      .accessToken;
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  it('returns exactly the four fields the forms hold', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/address/resolve')
      .set(authHeader(producerToken))
      .send({ placeId: 'ChIJstub', sessionToken: 'e2e-session-token' })
      .expect(200);

    const body = res.body as AddressResolveResponse;
    expect(body.available).toBe(true);
    expect(Object.keys(body.address ?? {}).sort()).toEqual([
      'city',
      'state',
      'street',
      'zip',
    ]);
  });

  it('spells the state out, never the two-letter code', async () => {
    // The PAC-60 acceptance criterion. Migrated SmartSuite households store
    // `Oklahoma`, so `OK` would sort new records apart from old ones.
    const res = await request(app.getHttpServer())
      .post('/api/v1/address/resolve')
      .set(authHeader(producerToken))
      .send({ placeId: 'ChIJstub', sessionToken: 'e2e-session-token' })
      .expect(200);

    expect((res.body as AddressResolveResponse).address?.state).toBe(
      'Oklahoma',
    );
  });

  it('never returns the API key or Google’s raw payload', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/address/autocomplete')
      .set(authHeader(producerToken))
      .send({ input: '4821 North Maple', sessionToken: 'e2e-session-token' })
      .expect(200);

    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('AIza');
    expect(raw).not.toContain('addressComponents');
    expect(raw).not.toContain('googleapis.com');
  });
});
