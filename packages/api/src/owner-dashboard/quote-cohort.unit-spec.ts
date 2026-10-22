import { Types } from 'mongoose';
import type {
  ConversionDeal,
  QuoteConversion,
} from '../common/sales-metrics/quote-conversion';
import {
  type CohortLead,
  type CohortQuote,
  backlogStats,
  clientNameOf,
  outcomeOf,
  producerQuoteCounts,
  productsOf,
  quoteOutcome,
} from './quote-cohort';

const oid = () => new Types.ObjectId();
const at = (iso: string) => new Date(`${iso}T15:00:00.000Z`);

const quote = (fields: Partial<CohortQuote> = {}): CohortQuote => ({
  _id: oid(),
  quoteDate: at('2026-06-10'),
  linePremium: 1000,
  ...fields,
});
const lead = (status?: string): CohortLead => ({ _id: oid(), status });

function sold(
  q: CohortQuote,
  soldDate: Date,
  premium = 1000,
  dealId = oid(),
): [string, QuoteConversion<ConversionDeal>] {
  return [
    String(q._id),
    { deal: { _id: dealId, soldDate, premium }, matchedBy: 'lead' },
  ];
}

describe('quoteOutcome', () => {
  it('a sale beats a lost lead', () => {
    expect(quoteOutcome(true, lead('Lost'))).toBe('sold');
  });
  it('a lost lead, by label or raw code, makes it lost', () => {
    expect(quoteOutcome(false, lead('Not Qualified'))).toBe('lost');
    expect(quoteOutcome(false, lead('jp76g'))).toBe('lost');
  });
  it('no lead, an open lead, and a Sold lead with no deal are all open', () => {
    expect(quoteOutcome(false, undefined)).toBe('open');
    expect(quoteOutcome(false, lead('Quoted'))).toBe('open');
    expect(quoteOutcome(false, lead('Sold'))).toBe('open');
  });
});

describe('producerQuoteCounts', () => {
  it('buckets by producer, with no producer under the empty key', () => {
    const producer = oid();
    const lostLead = lead('Closed');
    const a = quote({ producerId: producer, linePremium: 500 });
    const b = quote({ producerId: producer, leadId: lostLead._id });
    const c = quote({ producerId: producer, linePremium: 700 });
    const d = quote({ linePremium: 300 });
    const conversions = new Map([sold(c, at('2026-06-20'))]);
    const leads = new Map([[String(lostLead._id), lostLead]]);

    const rows = producerQuoteCounts([a, b, c, d], conversions, leads);
    expect(rows.get(String(producer))).toEqual({
      written: 3,
      sold: 1,
      open: 1,
      lost: 1,
      openPremium: 500,
    });
    expect(rows.get('')).toEqual({
      written: 1,
      sold: 0,
      open: 1,
      lost: 0,
      openPremium: 300,
    });
    expect(outcomeOf(b, conversions, leads)).toBe('lost');
  });
});

describe('backlogStats', () => {
  const july = { $gte: at('2026-07-01'), $lt: at('2026-08-01') };

  it('counts what was open at the start and what of it sold inside the window', () => {
    const lostLead = lead('Lost');
    const recovered = quote();
    const soldBefore = quote();
    const stillOpen = quote();
    const lost = quote({ leadId: lostLead._id });
    const soldAfter = quote();
    const conversions = new Map([
      sold(recovered, at('2026-07-08'), 2000),
      sold(soldBefore, at('2026-06-20')),
      sold(soldAfter, at('2026-08-03')),
    ]);
    const leads = new Map([[String(lostLead._id), lostLead]]);

    expect(
      backlogStats(
        [recovered, soldBefore, stillOpen, lost, soldAfter],
        conversions,
        leads,
        july,
      ),
    ).toEqual({ backlogAtStart: 3, recovered: 1, recoveredPremium: 2000 });
  });

  it('counts a recovered quote even when its lead is now lost', () => {
    const lostLead = lead('Closed');
    const q = quote({ leadId: lostLead._id });
    const stats = backlogStats(
      [q],
      new Map([sold(q, at('2026-07-02'))]),
      new Map([[String(lostLead._id), lostLead]]),
      july,
    );
    expect(stats).toMatchObject({ backlogAtStart: 1, recovered: 1 });
  });

  it('adds a deal that closed two quotes once', () => {
    const dealId = oid();
    const q1 = quote();
    const q2 = quote();
    const stats = backlogStats(
      [q1, q2],
      new Map([
        sold(q1, at('2026-07-08'), 900, dealId),
        sold(q2, at('2026-07-08'), 900, dealId),
      ]),
      new Map(),
      july,
    );
    expect(stats).toEqual({
      backlogAtStart: 2,
      recovered: 2,
      recoveredPremium: 900,
    });
  });
});

describe('productsOf', () => {
  it('normalizes the recap list and drops duplicates', () => {
    expect(
      productsOf(quote({ productsQuoted: ['Auto', 'auto', 'Home'] })),
    ).toEqual(['Auto', 'Home']);
  });
  it('falls back to the line types when the list is empty', () => {
    expect(
      productsOf(
        quote({ productsQuoted: [], policies: [{ policyType: 'Renters' }] }),
      ),
    ).toEqual(['Renters']);
  });
});

describe('clientNameOf', () => {
  it('joins the names, or says the lead is unknown', () => {
    expect(
      clientNameOf({ _id: oid(), firstName: 'Ada', lastName: 'Lovelace' }),
    ).toBe('Ada Lovelace');
    expect(clientNameOf(undefined)).toBe('Unknown lead');
  });
});
