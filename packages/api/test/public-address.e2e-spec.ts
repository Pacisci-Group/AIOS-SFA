// MUST be first: clamps the per-link daily cap before AppModule is evaluated.
import { TIGHT_PUBLIC_ADDRESS_LINK_DAILY_LIMIT } from './helpers/tight-rate-limits';

import { INestApplication } from '@nestjs/common';
import { AddressAutocompleteResponse } from '@sfa/shared';
import request from 'supertest';
import { App } from 'supertest/types';
import { authHeader, login } from './helpers/auth.helper';
import {
  TEST_PASSWORD,
  TestSeedContext,
  seedTestData,
} from './helpers/seed-test-data';
import {
  closeTestApp,
  createTestApp,
  dropTestDatabase,
} from './helpers/test-app';

/**
 * Address autocomplete on the public intake form (PAC-60).
 *
 * A separate spec because the per-link daily cap has to be clamped to a small
 * number, and it is counted on the `ShareLink` document rather than in the
 * throttler — so it would persist across every other request in a shared suite
 * rather than resetting.
 *
 * The property that matters most here is the *negative* one: these routes are
 * `@Public()`, so all six global guards are bypassed and every tenancy check is
 * made by hand. A bad token must be indistinguishable from a revoked one, or
 * the endpoint becomes an oracle for which share links exist.
 */
describe('Public address lookup (e2e)', () => {
  let app: INestApplication<App>;
  let seed: TestSeedContext;
  let token: string;
  let revokedToken: string;

  beforeAll(async () => {
    app = await createTestApp();
    await dropTestDatabase(app);
    seed = await seedTestData(app);

    const producer = await login(app, seed.producerEmail, TEST_PASSWORD);

    const live = await request(app.getHttpServer())
      .post('/api/v1/leads/share-links')
      .set(authHeader(producer.accessToken))
      .send({ label: 'public address tests' })
      .expect(201);
    token = (live.body as { token: string }).token;

    const doomed = await request(app.getHttpServer())
      .post('/api/v1/leads/share-links')
      .set(authHeader(producer.accessToken))
      .send({ label: 'revoked' })
      .expect(201);
    const doomedBody = doomed.body as { id: string; token: string };
    revokedToken = doomedBody.token;
    await request(app.getHttpServer())
      .patch(`/api/v1/leads/share-links/${doomedBody.id}/revoke`)
      .set(authHeader(producer.accessToken))
      .expect(200);
  });

  afterAll(async () => {
    await dropTestDatabase(app);
    await closeTestApp(app);
  });

  const body = {
    input: '4821 North Maple',
    sessionToken: 'public-session-token',
  };

  it('needs no Authorization header', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/public/address/${token}/autocomplete`)
      .send(body)
      .expect(200);
  });

  it('fails open with no API key, exactly like the authenticated route', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/public/address/${token}/autocomplete`)
      .send(body)
      .expect(200);

    expect(res.body as AddressAutocompleteResponse).toEqual({
      available: false,
      suggestions: [],
    });
  });

  describe('non-disclosure', () => {
    /*
     * The reason `ShareLinkAccessService` was extracted rather than copied: a
     * second hand-written implementation drifts, and the way it drifts is by
     * becoming more helpful about which of these cases applied.
     */
    it('answers a revoked token identically to an unknown one', async () => {
      const unknown = await request(app.getHttpServer())
        .post(`/api/v1/public/address/${'a'.repeat(43)}/autocomplete`)
        .send(body)
        .expect(404);

      const revoked = await request(app.getHttpServer())
        .post(`/api/v1/public/address/${revokedToken}/autocomplete`)
        .send(body)
        .expect(404);

      expect(revoked.body).toEqual(unknown.body);
    });

    it('answers a malformed token identically too', async () => {
      const malformed = await request(app.getHttpServer())
        .post('/api/v1/public/address/not-a-token/autocomplete')
        .send(body)
        .expect(404);

      expect(malformed.body).toMatchObject({
        message: 'This form is no longer available.',
      });
    });

    it('never names the agency, the producer or the link', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/public/address/${revokedToken}/autocomplete`)
        .send(body)
        .expect(404);

      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain('agency');
      expect(raw).not.toContain('producer');
      expect(raw).not.toContain('revoked');
    });
  });

  describe('the per-link daily cap', () => {
    it('serves available:false once the link exhausts its allowance', async () => {
      // A fresh link so the requests above do not count against this one.
      const producer = await login(app, seed.producerEmail, TEST_PASSWORD);
      const created = await request(app.getHttpServer())
        .post('/api/v1/leads/share-links')
        .set(authHeader(producer.accessToken))
        .send({ label: 'cap test' })
        .expect(201);
      const capped = (created.body as { token: string }).token;

      for (let i = 0; i < TIGHT_PUBLIC_ADDRESS_LINK_DAILY_LIMIT; i++) {
        await request(app.getHttpServer())
          .post(`/api/v1/public/address/${capped}/autocomplete`)
          .send(body)
          .expect(200);
      }

      /*
       * 200, not 429 — and that is the deliberate difference from the intake
       * limits. The client latches `available: false` and stops asking, the
       * submitter types the address by hand, and the form still submits. A 429
       * would paint an error on a form that is working fine.
       */
      const overCap = await request(app.getHttpServer())
        .post(`/api/v1/public/address/${capped}/autocomplete`)
        .send(body)
        .expect(200);

      expect(overCap.body as AddressAutocompleteResponse).toEqual({
        available: false,
        suggestions: [],
      });
    });

    it('caps resolve on the same allowance', async () => {
      const producer = await login(app, seed.producerEmail, TEST_PASSWORD);
      const created = await request(app.getHttpServer())
        .post('/api/v1/leads/share-links')
        .set(authHeader(producer.accessToken))
        .send({ label: 'cap test resolve' })
        .expect(201);
      const capped = (created.body as { token: string }).token;

      for (let i = 0; i < TIGHT_PUBLIC_ADDRESS_LINK_DAILY_LIMIT; i++) {
        await request(app.getHttpServer())
          .post(`/api/v1/public/address/${capped}/autocomplete`)
          .send(body)
          .expect(200);
      }

      const res = await request(app.getHttpServer())
        .post(`/api/v1/public/address/${capped}/resolve`)
        .send({ placeId: 'ChIJanything', sessionToken: 'public-session-token' })
        .expect(200);

      expect(res.body).toEqual({ available: false, address: null });
    });

    it('still rejects a bad token before spending any allowance', async () => {
      // Order matters: link verification runs first, so a bad token can never
      // consume another link's budget.
      await request(app.getHttpServer())
        .post(`/api/v1/public/address/${'b'.repeat(43)}/autocomplete`)
        .send(body)
        .expect(404);
    });
  });

  describe('validation still applies without a guard chain', () => {
    it('rejects an input too short to be worth a billed request', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/public/address/${token}/autocomplete`)
        .send({ input: '48', sessionToken: 'public-session-token' })
        .expect(400);
    });
  });
});
