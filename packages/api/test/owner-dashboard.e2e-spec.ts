import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import type {
  OwnerDashboardSummary,
  OwnerLeadSourcesResponse,
  OwnerProducersResponse,
} from '@sfa/shared';
import { Model, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { Deal } from '../src/deals/schemas/deal.schema';
import { Lead } from '../src/leads/schemas/lead.schema';
import { Policy } from '../src/policies/schemas/policy.schema';
import { QuoteRecap } from '../src/quote-recaps/schemas/quote-recap.schema';
import { User } from '../src/users/schemas/user.schema';
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
 * The Owner View dashboard (PAC-135).
 *
 * Everything lives in **May 2026**, asked for as a custom window so the suite is
 * independent of today's date. A custom window compares with the preceding span
 * of equal length — Mar 31 → Apr 30 — which is where the "previous" rows sit.
 *
 * | | producer | lead → source | policies | premium / items |
 * |---|---|---|---|---|
 * | D1 | producer | L1 → Mailer | Auto 1200/3 + Home 1800/1 | 3000 / 4 |
 * | D2 | owner | L2 → Facebook | Auto 1000/2 | 1000 / 2 |
 * | D3 | *none* | *no lead*, deal says Mailer | "Landlords" 500/1 | 500 / 1 |
 * | D4 | producer | none | *no policy rows*; deal says Renters | 700 / 1 |
 * | D7 | producer | L3 has no source, deal says Facebook | Auto 300/1 | 300 / 1 |
 *
 * Sold 5,500 over 9 items and 4 households (D1 and D3 share one). Quoted 10,000:
 * Q1 5,000 (Auto 2000 + Home 3000, Mailer), Q2 4,000 (migrated shape — no lines,
 * `productsQuoted: ['PYgez']`, Facebook), Q3 1,000 (Renters, no lead).
 */
describe('Owner dashboard (PAC-135) (e2e)', () => {
  let app: INestApplication<App>;
  let seed: TestSeedContext;
  let ownerToken: string;
  let producerToken: string;
  let csrToken: string;
  let readOnlyToken: string;
  let producerId: string;
  let ownerId: string;

  const MAY = 'range=custom&from=2026-05-01&to=2026-05-31';

  const get = async <T>(path: string, query: string, token = ownerToken) => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/owner-dashboard/${path}?${query}`)
      .set(authHeader(token))
      .expect(200);
    return res.body as T;
  };
  const summary = (query = MAY) => get<OwnerDashboardSummary>('summary', query);
  const producers = (query = MAY) =>
    get<OwnerProducersResponse>('producers', query);
  const leadSources = (query = MAY) =>
    get<OwnerLeadSourcesResponse>('lead-sources', query);

  beforeAll(async () => {
    app = await createTestApp();
    // Drop BEFORE seeding — suites share one database and jest reorders them.
    await dropTestDatabase(app);
    seed = await seedTestData(app);

    const model = <T>(name: string) => app.get<Model<T>>(getModelToken(name));
    const userModel = model<User>(User.name);
    const leadModel = model<Lead>(Lead.name);
    const dealModel = model<Deal>(Deal.name);
    const policyModel = model<Policy>(Policy.name);
    const recapModel = model<QuoteRecap>(QuoteRecap.name);

    const producer = await userModel.findOne({ email: seed.producerEmail });
    const owner = await userModel.findOne({ email: seed.ownerEmail });
    producerId = producer!._id.toString();
    ownerId = owner!._id.toString();

    const base = { agencyId: seed.agencyId, branchId: seed.branchId };
    const mailer = new Types.ObjectId(seed.leadSourceIds.mailer);
    const facebook = new Types.ObjectId(seed.leadSourceIds.facebook);
    const householdOne = new Types.ObjectId();

    const lead = (fields: Record<string, unknown>) =>
      leadModel.create({
        ...base,
        firstName: 'Lead',
        lastName: 'Fixture',
        status: 'New',
        temperature: 'Warm',
        ...fields,
      });

    const l1 = await lead({
      producerId: producer!._id,
      leadSourceId: mailer,
      createdDate: new Date('2026-05-03T15:00:00.000Z'),
    });
    // Date-only, as the migration writes it: exactly UTC midnight. Read as a
    // Chicago instant it would land on May 9 — still in the window — so the
    // real tell is the June 1 lead below.
    const l2 = await lead({
      producerId: owner!._id,
      leadSourceId: facebook,
      createdDate: new Date('2026-05-10T00:00:00.000Z'),
    });
    // Nobody has said where this one came from.
    const l3 = await lead({
      producerId: producer!._id,
      createdDate: new Date('2026-05-12T15:00:00.000Z'),
    });
    await lead({
      // Outside the window entirely.
      producerId: producer!._id,
      leadSourceId: mailer,
      createdDate: new Date('2026-04-15T15:00:00.000Z'),
    });
    await lead({
      // Migrated shape on **June 1**. Read in Chicago it is the evening of
      // May 31 and would be miscounted into the window.
      producerId: producer!._id,
      leadSourceId: mailer,
      createdDate: new Date('2026-06-01T00:00:00.000Z'),
    });

    const sell = async (
      deal: Record<string, unknown>,
      policies: { policyType: string; premium: number; items: number }[],
    ) => {
      const created = await dealModel.create({
        ...base,
        premium: policies.reduce((sum, p) => sum + p.premium, 0),
        itemCount: policies.reduce((sum, p) => sum + p.items, 0),
        policyTypes: policies.map((p) => p.policyType),
        ...deal,
      });
      await policyModel.create(
        policies.map((p) => ({ ...base, dealId: created._id, ...p })),
      );
      return created;
    };

    // D1 — the bundle the LOB filter has to split.
    await sell(
      {
        producerId: producer!._id,
        leadId: l1._id,
        leadSourceId: mailer,
        householdId: householdOne,
        soldDateYmd: 20260504,
      },
      [
        { policyType: 'Auto', premium: 1200, items: 3 },
        { policyType: 'Home', premium: 1800, items: 1 },
      ],
    );
    // D2
    await sell(
      {
        producerId: owner!._id,
        leadId: l2._id,
        leadSourceId: facebook,
        householdId: new Types.ObjectId(),
        soldDateYmd: 20260511,
      },
      [{ policyType: 'Auto', premium: 1000, items: 2 }],
    );
    // D3 — no producer, no lead; the deal's own source is all there is. Same
    // household as D1, and the type stored under a legacy spelling.
    await sell(
      {
        leadSourceId: mailer,
        householdId: householdOne,
        soldDateYmd: 20260518,
      },
      [{ policyType: 'Landlords', premium: 500, items: 1 }],
    );
    // D4 — no policy rows at all, like 10 of the migrated deals.
    await dealModel.create({
      ...base,
      producerId: producer!._id,
      soldDateYmd: 20260520,
      premium: 700,
      itemCount: 1,
      policyTypes: ['Renters'],
    });
    // D7 — the lead exists but has no source, so the deal's own stands.
    await sell(
      {
        producerId: producer!._id,
        leadId: l3._id,
        leadSourceId: facebook,
        householdId: new Types.ObjectId(),
        soldDateYmd: 20260525,
      },
      [{ policyType: 'Auto', premium: 300, items: 1 }],
    );

    // Must never be counted.
    await sell(
      { producerId: producer!._id, soldDateYmd: 20260506, isTestRecord: true },
      [{ policyType: 'Auto', premium: 99_999, items: 99 }],
    );
    await sell(
      {
        producerId: producer!._id,
        soldDateYmd: 20260507,
        businessType: 'company_transfer',
      },
      [{ policyType: 'Auto', premium: 88_888, items: 88 }],
    );
    await sell({ producerId: producer!._id, soldDateYmd: 20260601 }, [
      { policyType: 'Auto', premium: 55_555, items: 55 },
    ]);
    const foreign = await dealModel.create({
      agencyId: seed.otherAgencyId,
      branchId: seed.branchId,
      soldDateYmd: 20260508,
      premium: 123_456,
      itemCount: 12,
    });
    await policyModel.create({
      agencyId: seed.otherAgencyId,
      branchId: seed.branchId,
      dealId: foreign._id,
      policyType: 'Auto',
      premium: 123_456,
      items: 12,
    });

    // The comparison window (Mar 31 → Apr 30): one sale, one quote.
    await sell(
      {
        producerId: producer!._id,
        householdId: new Types.ObjectId(),
        soldDateYmd: 20260415,
      },
      [{ policyType: 'Auto', premium: 4000, items: 2 }],
    );

    await recapModel.create([
      {
        ...base,
        producerId: producer!._id,
        leadId: l1._id,
        quoteDateYmd: 20260502,
        premium: 5000,
        itemCount: 4,
        productsQuoted: ['Auto', 'Home'],
        policies: [
          { policyType: 'Auto', premium: 2000, itemCount: 3 },
          { policyType: 'Home', premium: 3000, itemCount: 1 },
        ],
      },
      // Migrated shape: no lines, and the type as a raw SmartSuite code.
      {
        ...base,
        producerId: owner!._id,
        leadId: l2._id,
        quoteDateYmd: 20260509,
        premium: 4000,
        itemCount: 2,
        productsQuoted: ['PYgez'],
      },
      {
        ...base,
        producerId: producer!._id,
        quoteDateYmd: 20260519,
        premium: 1000,
        itemCount: 1,
        productsQuoted: ['Renters'],
        policies: [{ policyType: 'Renters', premium: 1000, itemCount: 1 }],
      },
      // Comparison window.
      {
        ...base,
        producerId: producer!._id,
        quoteDateYmd: 20260414,
        premium: 8000,
        itemCount: 2,
        productsQuoted: ['Auto'],
        policies: [{ policyType: 'Auto', premium: 8000, itemCount: 2 }],
      },
    ]);

    const tokenFor = async (email: string) =>
      (await login(app, email, TEST_PASSWORD)).accessToken;
    ownerToken = await tokenFor(seed.ownerEmail);
    producerToken = await tokenFor(seed.producerEmail);
    csrToken = await tokenFor(seed.csrEmail);
    readOnlyToken = await tokenFor(seed.readOnlyEmail);
  });

  afterAll(async () => {
    await dropTestDatabase(app);
    await closeTestApp(app);
  });

  describe('GET /owner-dashboard/summary', () => {
    it('echoes the window it used and the one it compared with', async () => {
      const { period } = await summary();

      expect(period).toEqual({
        key: 'custom',
        current: { from: '2026-05-01', to: '2026-05-31' },
        // 31 days, so the 31 days before them.
        previous: { from: '2026-03-31', to: '2026-04-30' },
      });
    });

    it('sums sold premium and items from policy lines, excluding what must never count', async () => {
      const body = await summary();

      // Not the test record, the company transfer, the June sale or the other
      // agency's — any one of which would add five or six figures.
      expect(body.premium.current).toBe(5500);
      expect(body.items.current).toBe(9);
    });

    it('counts a household once however many deals it has', async () => {
      // D1 and D3 share a household; D4 has none and counts as its own.
      // 5500 ÷ 4.
      expect((await summary()).avgPremiumPerHousehold.current).toBe(1375);
    });

    it('reports the premium closing ratio with both of its sides', async () => {
      const { closingRatio } = await summary();

      expect(closingRatio.current).toBe(55);
      expect(closingRatio.soldPremium).toBe(5500);
      expect(closingRatio.quotedPremium).toBe(10_000);
      expect(closingRatio.reason).toBeNull();
    });

    it('trends each figure against the comparison window', async () => {
      const body = await summary();

      // 5500 vs 4000.
      expect(body.premium).toMatchObject({
        previous: 4000,
        change: 37.5,
        unit: 'percent',
        status: 'ok',
      });
      expect(body.items).toMatchObject({ previous: 2, change: 350 });
      // 1375 vs 4000.
      expect(body.avgPremiumPerHousehold).toMatchObject({
        previous: 4000,
        change: -65.6,
      });
      // 55% vs 50% is +5 *points*, not +10%.
      expect(body.closingRatio).toMatchObject({
        previous: 50,
        change: 5,
        unit: 'points',
      });
    });

    it('mixes line of business by share of policies, merging a legacy spelling', async () => {
      const { lobMix } = await summary();

      // Five typed policies: Auto ×3, Home, and "Landlords" → Landlord. D4 has
      // no policy rows, so it is a sale but not a policy of any type.
      expect(lobMix).toEqual({
        policyCount: 5,
        top: [
          { policyType: 'Auto', policyCount: 3, pct: 60 },
          { policyType: 'Home', policyCount: 1, pct: 20 },
          { policyType: 'Landlord', policyCount: 1, pct: 20 },
        ],
        otherPct: 0,
      });
    });

    it('says "no prior data" instead of inventing a trend', async () => {
      // April compares with March, which holds nothing at all.
      const body = await summary('range=custom&from=2026-04-01&to=2026-04-30');

      expect(body.premium.current).toBe(4000);
      expect(body.premium).toMatchObject({
        previous: null,
        change: null,
        status: 'no_prior_data',
      });
      expect(body.closingRatio.status).toBe('no_prior_data');
    });

    it('returns zeroes and nulls, never NaN, for an empty window', async () => {
      const body = await summary('range=custom&from=2020-01-01&to=2020-01-31');

      expect(body.premium.current).toBe(0);
      expect(body.items.current).toBe(0);
      expect(body.avgPremiumPerHousehold.current).toBeNull();
      expect(body.closingRatio.current).toBeNull();
      expect(body.closingRatio.reason).toBe('no_quotes');
      expect(body.lobMix).toEqual({ policyCount: 0, top: [], otherPct: 0 });
    });
  });

  describe('line-of-business filter', () => {
    it('counts only the matching policy of a bundle, not the whole deal', async () => {
      const body = await summary(`${MAY}&policyTypes=Auto`);

      // D1 contributes its Auto line (1200), not its 3000. Plus D2 and D7.
      expect(body.premium.current).toBe(2500);
      expect(body.items.current).toBe(6);
    });

    it('keeps a lineless record whose own type list contains the selection', async () => {
      const auto = await summary(`${MAY}&policyTypes=Auto`);
      const renters = await summary(`${MAY}&policyTypes=Renters`);

      // Q1's Auto line (2000) plus **all** of Q2: a migrated recap has nothing
      // to split by, and its `PYgez` is Auto.
      expect(auto.closingRatio.quotedPremium).toBe(6000);
      // D4 has no policy rows but says Renters, so it counts in full.
      expect(renters.premium.current).toBe(700);
      expect(renters.closingRatio.quotedPremium).toBe(1000);
    });

    it('ORs several types and finds a type stored under a legacy spelling', async () => {
      const body = await summary(`${MAY}&policyTypes=Home,Landlord`);

      // D1's Home line + D3, stored as "Landlords".
      expect(body.premium.current).toBe(2300);
    });
  });

  describe('GET /owner-dashboard/producers', () => {
    it('ranks by premium, with sales nobody owns kept as a last row', async () => {
      const { rows } = await producers();

      expect(
        rows.map((r) => [r.rank, r.producerId, r.premium, r.bound, r.quotes]),
      ).toEqual([
        [1, producerId, 4000, 6, 2],
        [2, ownerId, 1000, 2, 1],
        [3, null, 500, 1, 0],
      ]);
      expect(rows[2].name).toBe('Unassigned');
      expect(rows.every((r) => r.goalProgress === null)).toBe(true);
    });

    it('reacts to the line-of-business filter', async () => {
      const { rows } = await producers(`${MAY}&policyTypes=Auto`);

      // The producer's Auto lines only (1200 + 300); the unassigned Landlord
      // sale drops out.
      expect(rows.map((r) => [r.producerId, r.premium, r.bound])).toEqual([
        [producerId, 1500, 4],
        [ownerId, 1000, 2],
      ]);
    });

    it('narrows to the selected producers', async () => {
      const { rows, totals } = await producers(`${MAY}&producerIds=${ownerId}`);

      expect(rows.map((r) => r.producerId)).toEqual([ownerId]);
      expect(totals.premium).toBe(1000);
    });
  });

  describe('GET /owner-dashboard/lead-sources', () => {
    const shape = (body: OwnerLeadSourcesResponse) =>
      body.rows.map((r) => [
        r.name,
        r.volume,
        r.premium,
        r.quotedPremium,
        r.convPct,
      ]);

    it('attributes through the lead, falling back to the deal — and keeps "No source"', async () => {
      const body = await leadSources();

      expect(shape(body)).toEqual([
        // D1 via its lead + D3, which has no lead and says Mailer itself.
        ['Mailer', 1, 3500, 5000, 70],
        // D2 via its lead + D7, whose lead has no source of its own.
        ['Facebook', 1, 1300, 4000, 32.5],
        ['No source', 1, 700, 1000, 70],
      ]);
      expect(body.totals).toEqual({
        volume: 3,
        premium: 5500,
        quotedPremium: 10_000,
        convPct: 55,
        convGap: null,
      });
    });

    it('reads a date-only migrated lead on its own day, not the evening before', async () => {
      // The June 1 migrated lead is UTC midnight; in Chicago that is May 31.
      const mailer = (await leadSources()).rows.find(
        (r) => r.name === 'Mailer',
      );

      expect(mailer!.volume).toBe(1);
    });

    it('narrows to the selected sources, "No source" included', async () => {
      const onlyNone = await leadSources(`${MAY}&leadSourceIds=__none__`);
      const both = await leadSources(
        `${MAY}&leadSourceIds=__none__,${seed.leadSourceIds.mailer}`,
      );

      expect(shape(onlyNone)).toEqual([['No source', 1, 700, 1000, 70]]);
      expect(both.rows.map((r) => r.name)).toEqual(['Mailer', 'No source']);
    });

    it("shows a producer's own sources when filtered to them", async () => {
      const body = await leadSources(`${MAY}&producerIds=${ownerId}`);

      expect(shape(body)).toEqual([['Facebook', 1, 1000, 4000, 25]]);
    });
  });

  describe('the three reads agree', () => {
    // The page's whole promise: a leaderboard that does not add up to the card
    // above it is a dashboard nobody trusts twice.
    const filters = [
      ['no filter', MAY],
      ['one line of business', `${MAY}&policyTypes=Auto`],
      ['several lines of business', `${MAY}&policyTypes=Home,Renters,Landlord`],
      ['one producer', `${MAY}&producerIds=PRODUCER`],
      ['one source', `${MAY}&leadSourceIds=MAILER`],
      ['no source', `${MAY}&leadSourceIds=__none__`],
      [
        'everything at once',
        `${MAY}&policyTypes=Auto&producerIds=PRODUCER&leadSourceIds=MAILER`,
      ],
    ] as const;

    it.each(filters)('under %s', async (_name, template) => {
      const query = template
        .replace('PRODUCER', producerId)
        .replace('MAILER', seed.leadSourceIds.mailer);

      const [kpi, board, sources] = await Promise.all([
        summary(query),
        producers(query),
        leadSources(query),
      ]);

      expect(board.totals.premium).toBe(kpi.premium.current);
      expect(sources.totals.premium).toBe(kpi.premium.current);
      expect(board.totals.bound).toBe(kpi.items.current);
      expect(sources.totals.quotedPremium).toBe(kpi.closingRatio.quotedPremium);
    });
  });

  describe('access', () => {
    it.each(['summary', 'producers', 'lead-sources'])(
      'GET /owner-dashboard/%s — forbidden without owner_dashboard:read',
      async (path) => {
        for (const token of [producerToken, csrToken]) {
          await request(app.getHttpServer())
            .get(`/api/v1/owner-dashboard/${path}`)
            .set(authHeader(token))
            .expect(403);
        }
      },
    );

    it('is readable by any holder of owner_dashboard:read', async () => {
      const body = await get<OwnerDashboardSummary>(
        'summary',
        MAY,
        readOnlyToken,
      );

      expect(body.premium.current).toBe(5500);
    });

    it("is read-only — the stub's bare GET and PATCH are gone", async () => {
      await request(app.getHttpServer())
        .get('/api/v1/owner-dashboard')
        .set(authHeader(ownerToken))
        .expect(404);
      await request(app.getHttpServer())
        .patch('/api/v1/owner-dashboard')
        .set(authHeader(ownerToken))
        .expect(404);
    });
  });

  describe('validation', () => {
    it.each([
      ['an unknown range', 'range=fortnight'],
      ['a producer-dashboard-only range', 'range=week'],
      ['custom without bounds', 'range=custom'],
      ['from after to', 'range=custom&from=2026-05-31&to=2026-05-01'],
      ['an impossible date', 'range=custom&from=2026-02-31&to=2026-03-01'],
      ['a malformed producer id', `${MAY}&producerIds=not-an-id`],
      ['a malformed lead source id', `${MAY}&leadSourceIds=Mailer`],
      [
        'a policy type that is not on the Sold form',
        `${MAY}&policyTypes=Boats`,
      ],
    ])('rejects %s (400)', async (_name, query) => {
      await request(app.getHttpServer())
        .get(`/api/v1/owner-dashboard/summary?${query}`)
        .set(authHeader(ownerToken))
        .expect(400);
    });

    it('defaults to this month', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/owner-dashboard/summary')
        .set(authHeader(ownerToken))
        .expect(200);

      const { period } = res.body as OwnerDashboardSummary;
      expect(period.key).toBe('mtd');
      expect(period.current.from).toMatch(/^\d{4}-\d{2}-01$/);
      // The same elapsed days of the month before.
      expect(period.previous.from).toMatch(/^\d{4}-\d{2}-01$/);
    });
  });
});
