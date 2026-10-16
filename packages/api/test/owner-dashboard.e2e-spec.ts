import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import type {
  OwnerDashboardSummary,
  OwnerLeadSourcesResponse,
  OwnerOpenQuotesResponse,
  OwnerProducerQuotesResponse,
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
import { businessDateInstant } from '../src/common/dates/business-dates';

/**
 * A business date stored the way the app stores a day-only entry (PAC-159):
 * midnight of that day in the seeded agency's zone — `America/Chicago`, the
 * schema default — never UTC midnight, which Chicago reads as the evening
 * before.
 */
const onDay = (iso: string) => businessDateInstant(iso, 'America/Chicago');

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
  const producerQuotes = (query = MAY) =>
    get<OwnerProducerQuotesResponse>('producer-quotes', query);
  const openQuotes = (query: string) =>
    get<OwnerOpenQuotesResponse>('open-quotes', query);

  /**
   * The quote figures (David, 14–15 Oct 2026) live in **July 2026**, so the May
   * fixtures above stay exactly as they were. July compares with May 31 → Jun 30.
   *
   * | | producer | lead (status) | quoted | what happened |
   * |---|---|---|---|---|
   * | QA | producer | LA (Quoted) | **Jun 10**, Auto 2000 | sold Jul 8 → a backlog recovery |
   * | QB | producer | LB (`jp76g` = Lost) | Jul 3, 1500 | lost |
   * | QC | owner | LC (Quoted) | Jul 5, 900 | a company transfer Jul 6 — still open |
   * | QD | producer | LD (Sold) | Jul 10, 700 | no deal — open, a data gap |
   * | QE1, QE2 | producer | LE (Quoted) | Jul 2, 400 · Jul 12, 1200 | the deal names QE2 — QE1 stays open |
   * | QF | *none* | *none* | Jul 15, 300 | Unassigned, open |
   *
   * The backlog at Jul 1 (quotes from the year before, still open then): the
   * Apr 14 recap, Q3 and QA — Q1 and Q2 sold in May.
   */
  const JULY = 'range=custom&from=2026-07-01&to=2026-07-31';

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
    // Day-only, as the migration now stores it: agency-local midnight (PAC-159),
    // which the Chicago calendar reads as May 10 — not the evening of May 9.
    const l2 = await lead({
      producerId: owner!._id,
      leadSourceId: facebook,
      createdDate: onDay('2026-05-10'),
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
      // Day-only on **June 1**, the first instant of that day in Chicago.
      // Before PAC-159 this sat at UTC midnight, i.e. the evening of May 31,
      // and needed a special case not to be counted into the window.
      producerId: producer!._id,
      leadSourceId: mailer,
      createdDate: onDay('2026-06-01'),
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
        soldDate: onDay('2026-05-04'),
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
        soldDate: onDay('2026-05-11'),
      },
      [{ policyType: 'Auto', premium: 1000, items: 2 }],
    );
    // D3 — no producer, no lead; the deal's own source is all there is. Same
    // household as D1, and the type stored under a legacy spelling.
    await sell(
      {
        leadSourceId: mailer,
        householdId: householdOne,
        soldDate: onDay('2026-05-18'),
      },
      [{ policyType: 'Landlords', premium: 500, items: 1 }],
    );
    // D4 — no policy rows at all, like 10 of the migrated deals.
    await dealModel.create({
      ...base,
      producerId: producer!._id,
      soldDate: onDay('2026-05-20'),
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
        soldDate: onDay('2026-05-25'),
      },
      [{ policyType: 'Auto', premium: 300, items: 1 }],
    );

    // Must never be counted.
    await sell(
      {
        producerId: producer!._id,
        soldDate: onDay('2026-05-06'),
        isTestRecord: true,
      },
      [{ policyType: 'Auto', premium: 99_999, items: 99 }],
    );
    await sell(
      {
        producerId: producer!._id,
        soldDate: onDay('2026-05-07'),
        businessType: 'company_transfer',
      },
      [{ policyType: 'Auto', premium: 88_888, items: 88 }],
    );
    await sell({ producerId: producer!._id, soldDate: onDay('2026-06-01') }, [
      { policyType: 'Auto', premium: 55_555, items: 55 },
    ]);
    const foreign = await dealModel.create({
      agencyId: seed.otherAgencyId,
      branchId: seed.branchId,
      soldDate: onDay('2026-05-08'),
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
        soldDate: onDay('2026-04-15'),
      },
      [{ policyType: 'Auto', premium: 4000, items: 2 }],
    );

    await recapModel.create([
      {
        ...base,
        producerId: producer!._id,
        leadId: l1._id,
        quoteDate: onDay('2026-05-02'),
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
        quoteDate: onDay('2026-05-09'),
        premium: 4000,
        itemCount: 2,
        productsQuoted: ['PYgez'],
      },
      {
        ...base,
        producerId: producer!._id,
        quoteDate: onDay('2026-05-19'),
        premium: 1000,
        itemCount: 1,
        productsQuoted: ['Renters'],
        policies: [{ policyType: 'Renters', premium: 1000, itemCount: 1 }],
      },
      // Comparison window.
      {
        ...base,
        producerId: producer!._id,
        quoteDate: onDay('2026-04-14'),
        premium: 8000,
        itemCount: 2,
        productsQuoted: ['Auto'],
        policies: [{ policyType: 'Auto', premium: 8000, itemCount: 2 }],
      },
    ]);

    // ---- July: the quote figures -------------------------------------------
    const quoted = (status: string, by = producer!._id) =>
      lead({ producerId: by, status, createdDate: onDay('2026-06-05') });
    const recap = (fields: Record<string, unknown>, premium: number) =>
      recapModel.create({
        ...base,
        premium,
        itemCount: 1,
        productsQuoted: ['Auto'],
        policies: [{ policyType: 'Auto', premium, itemCount: 1 }],
        ...fields,
      });
    const lA = await quoted('Quoted');
    const lB = await quoted('jp76g');
    const lC = await quoted('Quoted', owner!._id);
    const lD = await quoted('Sold');
    const lE = await quoted('Quoted');
    await recap(
      {
        producerId: producer!._id,
        leadId: lA._id,
        quoteDate: onDay('2026-06-10'),
      },
      2000,
    );
    await sell(
      {
        producerId: producer!._id,
        leadId: lA._id,
        householdId: new Types.ObjectId(),
        soldDate: onDay('2026-07-08'),
      },
      [{ policyType: 'Auto', premium: 2000, items: 1 }],
    );
    await recap(
      {
        producerId: producer!._id,
        leadId: lB._id,
        quoteDate: onDay('2026-07-03'),
      },
      1500,
    );
    await recap(
      {
        producerId: owner!._id,
        leadId: lC._id,
        quoteDate: onDay('2026-07-05'),
      },
      900,
    );
    await sell(
      {
        producerId: owner!._id,
        leadId: lC._id,
        soldDate: onDay('2026-07-06'),
        businessType: 'company_transfer',
      },
      [{ policyType: 'Auto', premium: 900, items: 1 }],
    );
    await recap(
      {
        producerId: producer!._id,
        leadId: lD._id,
        quoteDate: onDay('2026-07-10'),
      },
      700,
    );
    await recap(
      {
        producerId: producer!._id,
        leadId: lE._id,
        quoteDate: onDay('2026-07-02'),
      },
      400,
    );
    const qE2 = await recap(
      {
        producerId: producer!._id,
        leadId: lE._id,
        quoteDate: onDay('2026-07-12'),
      },
      1200,
    );
    await sell(
      {
        producerId: producer!._id,
        leadId: lE._id,
        quoteRecapId: qE2._id,
        householdId: new Types.ObjectId(),
        soldDate: onDay('2026-07-20'),
      },
      [{ policyType: 'Auto', premium: 1200, items: 1 }],
    );
    await recap({ quoteDate: onDay('2026-07-15') }, 300);

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

      expect(closingRatio.premium.current).toBe(55);
      expect(closingRatio.premium.soldPremium).toBe(5500);
      expect(closingRatio.premium.quotedPremium).toBe(10_000);
      expect(closingRatio.premium.reason).toBeNull();
    });

    it('reports the quote closing ratio as the share of quotes written that sold', async () => {
      const { closingRatio } = await summary();

      // Q1 → D1 and Q2 → D2 through their leads; Q3 has no lead and no sale.
      expect(closingRatio.quote).toMatchObject({
        written: 3,
        sold: 2,
        current: 66.7,
        reason: null,
      });
    });

    it('headlines the average of the two ratios', async () => {
      const { closingRatio } = await summary();

      // (55 + 66.7) ÷ 2.
      expect(closingRatio).toMatchObject({
        basis: 'both',
        current: 60.9,
        reason: null,
      });
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
      expect(body.closingRatio.premium).toMatchObject({
        previous: 50,
        change: 5,
        unit: 'points',
      });
      // The April recap never sold: 0%. The blend moves from 25 to 60.9.
      expect(body.closingRatio.quote).toMatchObject({ previous: 0 });
      expect(body.closingRatio).toMatchObject({
        previous: 25,
        change: 35.9,
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
      expect(body.closingRatio.basis).toBe('none');
      expect(body.closingRatio.reason).toBe('no_quotes');
      expect(body.unsoldQuotesClosed.ratePct).toBeNull();
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
      expect(auto.closingRatio.premium.quotedPremium).toBe(6000);
      // D4 has no policy rows but says Renters, so it counts in full.
      expect(renters.premium.current).toBe(700);
      expect(renters.closingRatio.premium.quotedPremium).toBe(1000);
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

      const [kpi, board, sources, quotes] = await Promise.all([
        summary(query),
        producers(query),
        leadSources(query),
        producerQuotes(query),
      ]);

      expect(board.totals.premium).toBe(kpi.premium.current);
      expect(sources.totals.premium).toBe(kpi.premium.current);
      expect(board.totals.bound).toBe(kpi.items.current);
      expect(sources.totals.quotedPremium).toBe(
        kpi.closingRatio.premium.quotedPremium,
      );
      // The quotes the leaderboard counts are the quotes the ratio and the
      // quotes-by-producer card count.
      expect(quotes.totals.written).toBe(board.totals.quotes);
      expect(kpi.closingRatio.quote.written).toBe(board.totals.quotes);
    });
  });

  describe('quotes: sold, open, lost', () => {
    it('counts the backlog at the start and what of it sold in the window', async () => {
      const { unsoldQuotesClosed, closingRatio } = await summary(JULY);

      expect(unsoldQuotesClosed).toMatchObject({
        backlogAtStart: 3,
        recoveredPremium: 2000,
        ratePct: 33.3,
      });
      expect(unsoldQuotesClosed.recovered.current).toBe(1);
      // Six July quotes, one sold (QE2): the transfer on LC is not a sale, and
      // the one deal on LE goes to the quote it names.
      expect(closingRatio.quote).toMatchObject({ written: 6, sold: 1 });
    });

    it('splits each producer into sold, open and lost, most open first', async () => {
      const body = await producerQuotes(JULY);

      expect(
        body.rows.map((r) => [
          r.producerId,
          r.written,
          r.sold,
          r.open,
          r.lost,
          r.openPremium,
          r.closePct,
        ]),
      ).toEqual([
        [producerId, 4, 1, 2, 1, 1100, 25],
        [ownerId, 1, 0, 1, 0, 900, 0],
        [null, 1, 0, 1, 0, 300, 0],
      ]);
      expect(body.rows[2].name).toBe('Unassigned');
      expect(body.totals).toEqual({
        written: 6,
        sold: 1,
        open: 4,
        lost: 1,
        openPremium: 2300,
        closePct: 16.7,
      });
      expect(body.totals.written).toBe((await producers(JULY)).totals.quotes);
    });

    it("lists a producer's open quotes newest first, lost ones left out", async () => {
      const body = await openQuotes(`${JULY}&producer=${producerId}`);

      expect(body.producer.producerId).toBe(producerId);
      expect(body.total).toBe(2);
      expect(
        body.items.map((i) => [
          i.quoteDate.slice(0, 10),
          i.quotedPremium,
          i.leadStatus,
          i.clientName,
        ]),
      ).toEqual([
        // Jul 10 in Chicago is 05:00Z the same day.
        ['2026-07-10', 700, 'Sold', 'Lead Fixture'],
        ['2026-07-02', 400, 'Quoted', 'Lead Fixture'],
      ]);
      expect(body.items[0].productsQuoted).toEqual(['Auto']);
      expect(body.items[0].daysOpen).toBeGreaterThan(0);
    });

    it('pages in the requested size', async () => {
      const body = await openQuotes(
        `${JULY}&producer=${producerId}&page=2&pageSize=1`,
      );

      expect(body).toMatchObject({
        page: 2,
        pageSize: 1,
        total: 2,
        totalPages: 2,
      });
      expect(body.items.map((i) => i.quotedPremium)).toEqual([400]);
    });

    it('lists the quotes nobody owns under __none__', async () => {
      const body = await openQuotes(`${JULY}&producer=__none__`);

      expect(body.producer).toMatchObject({
        producerId: null,
        name: 'Unassigned',
      });
      expect(body.items).toEqual([
        expect.objectContaining({
          leadId: null,
          clientName: 'Unknown lead',
          leadStatus: 'Unknown',
          quotedPremium: 300,
        }),
      ]);
    });

    it('is empty, not an error, for a window with no quotes', async () => {
      const body = await openQuotes(
        `range=custom&from=2020-01-01&to=2020-01-31&producer=${producerId}`,
      );
      expect(body).toMatchObject({ total: 0, totalPages: 0, items: [] });
    });
  });

  describe('access', () => {
    it.each([
      'summary',
      'producers',
      'lead-sources',
      'producer-quotes',
      'open-quotes',
    ])(
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

    it.each([
      ['a malformed producer', `${MAY}&producer=nope`],
      ['page 0', `${MAY}&page=0`],
      ['a page past the cap', `${MAY}&pageSize=201`],
      ['custom without bounds', 'range=custom'],
    ])('rejects open quotes with %s (400)', async (_name, query) => {
      await request(app.getHttpServer())
        .get(`/api/v1/owner-dashboard/open-quotes?${query}`)
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
