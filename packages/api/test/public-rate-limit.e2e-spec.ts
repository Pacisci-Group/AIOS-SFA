// MUST be first: clamps the throttle limits before AppModule is evaluated.
import {
  TIGHT_PUBLIC_FORM_LIMIT,
  TIGHT_PUBLIC_INTAKE_LIMIT,
} from './helpers/tight-rate-limits';

import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { authHeader, login } from './helpers/auth.helper';
import {
  seedTestData,
  TEST_PASSWORD,
  TestSeedContext,
} from './helpers/seed-test-data';
import {
  closeTestApp,
  createTestApp,
  dropTestDatabase,
} from './helpers/test-app';

/**
 * Rate limiting on the public intake routes (PAC-37).
 *
 * A separate spec file because the limits have to be tight, and the throttler's
 * storage is in-memory and process-wide — running these numbers inside
 * `api.e2e-spec.ts` would bleed 429s into every other block there.
 */
describe('Public intake rate limiting (e2e)', () => {
  let app: INestApplication<App>;
  let seed: TestSeedContext;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    await dropTestDatabase(app);
    seed = await seedTestData(app);

    const producer = await login(app, seed.producerEmail, TEST_PASSWORD);
    const res = await request(app.getHttpServer())
      .post('/api/v1/leads/share-links')
      .set(authHeader(producer.accessToken))
      .send({ label: 'rate limit tests' })
      .expect(201);
    token = (res.body as { token: string }).token;
  });

  afterAll(async () => {
    await dropTestDatabase(app);
    await closeTestApp(app);
  });

  const submission = (key: string) => ({
    primaryContact: {
      firstName: 'Rate',
      lastName: key,
      dateOfBirth: '1980-01-01',
      phone: '5551110000',
      email: `rate.${key}@example.com`,
    },
    members: [],
  });

  it('returns 429 once the form-render limit is exceeded', async () => {
    for (let i = 0; i < TIGHT_PUBLIC_FORM_LIMIT; i++) {
      await request(app.getHttpServer())
        .get(`/api/v1/public/lead-form/${token}`)
        .expect(200);
    }

    await request(app.getHttpServer())
      .get(`/api/v1/public/lead-form/${token}`)
      .expect(429);
  });

  it('returns 429 once the submit limit is exceeded', async () => {
    for (let i = 0; i < TIGHT_PUBLIC_INTAKE_LIMIT; i++) {
      await request(app.getHttpServer())
        .post(`/api/v1/public/leads/${token}`)
        .send(submission(`Allowed${i}`))
        .expect(201);
    }

    await request(app.getHttpServer())
      .post(`/api/v1/public/leads/${token}`)
      .send(submission('Blocked'))
      .expect(429);
  });

  it('rejects a throttled submission BEFORE it writes anything', async () => {
    // The submit limit is already exhausted by the test above; a throttled
    // request must not have reached the pipeline.
    await request(app.getHttpServer())
      .post(`/api/v1/public/leads/${token}`)
      .send(submission('NeverWritten'))
      .expect(429);

    const res = await request(app.getHttpServer())
      .get(`/api/v1/public/lead-form/${token}`)
      .expect(429);
    expect(res.status).toBe(429);
  });
});
