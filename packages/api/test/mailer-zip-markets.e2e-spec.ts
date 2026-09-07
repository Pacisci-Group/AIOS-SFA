import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import type { MailerZipMarketListResponse } from '@sfa/shared';
import { MailerZipMarket } from '../src/mailers/schemas/mailer-zip-market.schema';
import { authHeader, login } from './helpers/auth.helper';
import {
  closeTestApp,
  createTestApp,
  dropTestDatabase,
} from './helpers/test-app';
import {
  seedTestData,
  TEST_PASSWORD,
  TestSeedContext,
} from './helpers/seed-test-data';

/**
 * The ZIP → market table (PAC-71).
 *
 * It replaces ApexReports' Google Sheet, and it is editable data rather than a
 * constant: the market decides which local-presence phone number is printed on
 * the mail piece, and every campaign turns up new ZIPs.
 *
 * The uniqueness rule is the part worth a real database — `{agencyId, zip5}` is
 * unique and **not** partial, because `agencyId: null` is a *value* here (the
 * `Carrier` pattern) rather than an absence.
 */
describe('Mailer ZIP markets (e2e)', () => {
  let app: INestApplication<App>;
  let ctx: TestSeedContext;
  let superAdminToken: string;
  let ownerToken: string;
  let model: Model<MailerZipMarket>;

  const api = () => request(app.getHttpServer());
  const base = '/api/v1/platform/mailer-zip-markets';

  const list = async (query: Record<string, string | number> = {}) => {
    const res = await api()
      .get(base)
      .query(query)
      .set(authHeader(superAdminToken))
      .expect(200);
    return res.body as MailerZipMarketListResponse;
  };

  beforeAll(async () => {
    app = await createTestApp();
    await dropTestDatabase(app);
    ctx = await seedTestData(app);

    model = app.get<Model<MailerZipMarket>>(
      getModelToken(MailerZipMarket.name),
    );
    // `dropTestDatabase` runs after `app.init()`, so `autoIndex` has already
    // been and gone; without this the unique key would not exist and the
    // "one row per ZIP" case would pass for the wrong reason.
    await model.syncIndexes();

    superAdminToken = (await login(app, ctx.superAdminEmail, TEST_PASSWORD))
      .accessToken;
    ownerToken = (await login(app, ctx.ownerEmail, TEST_PASSWORD)).accessToken;
  });

  afterAll(async () => {
    if (app) {
      await dropTestDatabase(app);
      await closeTestApp(app);
    }
  });

  beforeEach(async () => {
    await model.deleteMany({});
  });

  it('refuses a caller without platform:mailers:*', async () => {
    await api().get(base).set(authHeader(ownerToken)).expect(403);
    await api()
      .put(base)
      .set(authHeader(ownerToken))
      .send({ entries: [{ zip5: '74133', market: 'Tulsa' }] })
      .expect(403);
  });

  it('upserts rather than duplicating, and records who decided', async () => {
    await api()
      .put(base)
      .set(authHeader(superAdminToken))
      .send({
        entries: [
          { zip5: '74133', market: 'Tulsa' },
          { zip5: '73071', market: 'Oklahoma City' },
        ],
      })
      .expect(200);

    // The correction path: same key, new market, still one row.
    const again = await api()
      .put(base)
      .set(authHeader(superAdminToken))
      .send({ entries: [{ zip5: '74133', market: '580 Group' }] })
      .expect(200);
    expect((again.body as { updated: number }).updated).toBe(1);

    const body = await list();
    expect(body.total).toBe(2);
    const row = body.items.find((item) => item.zip5 === '74133')!;
    expect(row.market).toBe('580 Group');
    expect(row.agencyId).toBeNull();
    expect(row.source).toBe('manual');
  });

  it('rejects anything that is not five digits', async () => {
    // The seed source carries a four-digit typo (`4031`, which should be
    // `74031`). Stored, it would be a row that can never match an address and
    // still looks like a mapping.
    await api()
      .put(base)
      .set(authHeader(superAdminToken))
      .send({ entries: [{ zip5: '4031', market: 'Tulsa' }] })
      .expect(400);

    await api()
      .put(base)
      .set(authHeader(superAdminToken))
      .send({ entries: [{ zip5: '74133-1234', market: 'Tulsa' }] })
      .expect(400);

    await api()
      .put(base)
      .set(authHeader(superAdminToken))
      .send({ entries: [{ zip5: '74133', market: '' }] })
      .expect(400);
  });

  it('searches by ZIP prefix and by market name', async () => {
    await api()
      .put(base)
      .set(authHeader(superAdminToken))
      .send({
        entries: [
          { zip5: '74133', market: 'Tulsa' },
          { zip5: '74003', market: 'Tulsa' },
          { zip5: '73071', market: 'Oklahoma City' },
        ],
      })
      .expect(200);

    expect((await list({ q: '74' })).total).toBe(2);
    expect((await list({ q: 'oklahoma' })).total).toBe(1);
    expect((await list({ q: '74133' })).items[0].market).toBe('Tulsa');
  });

  it('pages, sorted by ZIP', async () => {
    await api()
      .put(base)
      .set(authHeader(superAdminToken))
      .send({
        entries: [
          { zip5: '74003', market: 'Tulsa' },
          { zip5: '74133', market: 'Tulsa' },
          { zip5: '73071', market: 'Oklahoma City' },
        ],
      })
      .expect(200);

    const page = await list({ page: 1, pageSize: 2 });
    expect(page.items.map((row) => row.zip5)).toEqual(['73071', '74003']);
    expect(page.totalPages).toBe(2);
  });

  it('deletes one row, and 404s an id that is not there', async () => {
    await api()
      .put(base)
      .set(authHeader(superAdminToken))
      .send({ entries: [{ zip5: '74133', market: 'Tulsa' }] })
      .expect(200);
    const id = (await list()).items[0].id;

    await api()
      .delete(`${base}/${id}`)
      .set(authHeader(superAdminToken))
      .expect(200);
    expect((await list()).total).toBe(0);

    await api()
      .delete(`${base}/${id}`)
      .set(authHeader(superAdminToken))
      .expect(404);
    await api()
      .delete(`${base}/not-an-object-id`)
      .set(authHeader(superAdminToken))
      .expect(404);
  });

  it('caps a bulk paste at a thousand rows', async () => {
    const entries = Array.from({ length: 1001 }, (_, i) => ({
      zip5: String(70000 + i),
      market: 'Tulsa',
    }));
    await api()
      .put(base)
      .set(authHeader(superAdminToken))
      .send({ entries })
      .expect(400);
  });
});
