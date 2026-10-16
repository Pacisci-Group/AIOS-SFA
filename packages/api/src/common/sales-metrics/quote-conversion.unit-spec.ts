import { Types } from 'mongoose';
import { businessDateInstant } from '../dates/business-dates';
import {
  type ConversionDeal,
  type ConversionQuote,
  resolveQuoteConversions,
} from './quote-conversion';

const TZ = 'America/Chicago';
const day = (iso: string) => businessDateInstant(iso, TZ);
const oid = () => new Types.ObjectId();

const quote = (fields: Partial<ConversionQuote> = {}): ConversionQuote => ({
  _id: oid(),
  quoteDate: day('2026-05-10'),
  ...fields,
});
const deal = (fields: Partial<ConversionDeal> = {}): ConversionDeal => ({
  _id: oid(),
  soldDate: day('2026-05-12'),
  premium: 1000,
  ...fields,
});

/** The maps `loadConversionDeals` would build from these deals. */
function index(deals: ConversionDeal[], siblings: ConversionQuote[] = []) {
  const group = <T>(rows: T[], by: (row: T) => unknown) => {
    const out = new Map<string, T[]>();
    for (const row of rows) {
      const k = by(row) ? String(by(row)) : '';
      if (!k) continue;
      out.set(k, [...(out.get(k) ?? []), row]);
    }
    return out;
  };
  const sorted = [...deals].sort(
    (a, b) => (a.soldDate?.getTime() ?? 0) - (b.soldDate?.getTime() ?? 0),
  );
  return {
    byRecap: group(sorted, (d) => d.quoteRecapId),
    byLead: group(sorted, (d) => d.leadId),
    siblings: siblings.length ? group(siblings, (q) => q.leadId) : undefined,
  };
}

describe('resolveQuoteConversions', () => {
  it('a deal that names the recap wins over the lead fallback', () => {
    const leadId = oid();
    const q = quote({ leadId });
    const named = deal({
      leadId,
      quoteRecapId: q._id,
      soldDate: day('2026-05-20'),
    });
    const earlier = deal({ leadId, soldDate: day('2026-05-11') });
    const result = resolveQuoteConversions([q], index([named, earlier]), TZ);
    expect(result.get(String(q._id))).toEqual({
      deal: named,
      matchedBy: 'quote_recap',
    });
  });

  it("falls back to the lead's sale on or after the quote day", () => {
    const leadId = oid();
    const q = quote({ leadId });
    const sale = deal({ leadId, soldDate: day('2026-05-10') });
    const result = resolveQuoteConversions([q], index([sale]), TZ);
    expect(result.get(String(q._id))).toEqual({
      deal: sale,
      matchedBy: 'lead',
    });
  });

  it('compares agency days, not instants: a late quote and next-morning sale match', () => {
    const leadId = oid();
    // 23:30 Chicago on May 10 is already May 11 in UTC.
    const q = quote({
      leadId,
      quoteDate: new Date('2026-05-11T04:30:00.000Z'),
    });
    const sale = deal({
      leadId,
      soldDate: new Date('2026-05-11T14:00:00.000Z'),
    });
    expect(
      resolveQuoteConversions([q], index([sale]), TZ).get(String(q._id))?.deal,
    ).toBe(sale);
  });

  it('skips a sale before the quote day', () => {
    const leadId = oid();
    const q = quote({ leadId });
    const sale = deal({ leadId, soldDate: day('2026-05-09') });
    expect(resolveQuoteConversions([q], index([sale]), TZ).size).toBe(0);
  });

  it('skips a deal that names another recap', () => {
    const leadId = oid();
    const q = quote({ leadId });
    const other = deal({ leadId, quoteRecapId: oid() });
    expect(resolveQuoteConversions([q], index([other]), TZ).size).toBe(0);
  });

  it('skips a deal with no sold date', () => {
    const leadId = oid();
    const q = quote({ leadId });
    const undated = deal({ leadId, soldDate: null });
    expect(resolveQuoteConversions([q], index([undated]), TZ).size).toBe(0);
  });

  it('leaves a quote with no lead and no named deal unconverted', () => {
    const q = quote();
    expect(resolveQuoteConversions([q], index([deal()]), TZ).size).toBe(0);
  });

  it('gives one sale to one quote: the latest quote before it', () => {
    const leadId = oid();
    const first = quote({ leadId, quoteDate: day('2026-05-02') });
    const requote = quote({ leadId, quoteDate: day('2026-05-08') });
    const sale = deal({ leadId, soldDate: day('2026-05-12') });
    const result = resolveQuoteConversions([first, requote], index([sale]), TZ);
    expect(result.get(String(requote._id))?.deal).toBe(sale);
    expect(result.has(String(first._id))).toBe(false);
  });

  it('pairs two sales with two quotes in order', () => {
    const leadId = oid();
    const jan = quote({ leadId, quoteDate: day('2026-01-05') });
    const mar = quote({ leadId, quoteDate: day('2026-03-05') });
    const feb = deal({ leadId, soldDate: day('2026-02-01') });
    const apr = deal({ leadId, soldDate: day('2026-04-01') });
    const result = resolveQuoteConversions([jan, mar], index([feb, apr]), TZ);
    expect(result.get(String(jan._id))?.deal).toBe(feb);
    expect(result.get(String(mar._id))?.deal).toBe(apr);
  });

  it('arbitrates against sibling recaps the caller is not reporting on', () => {
    const leadId = oid();
    const may = quote({ leadId, quoteDate: day('2026-05-05') });
    const june = quote({ leadId, quoteDate: day('2026-06-02') });
    const sale = deal({ leadId, soldDate: day('2026-06-10') });
    // Viewing May alone, the June requote still takes the June sale.
    const result = resolveQuoteConversions(
      [may],
      index([sale], [may, june]),
      TZ,
    );
    expect(result.size).toBe(0);
  });

  it("a directly-sold sibling does not compete for the lead's other sales", () => {
    const leadId = oid();
    const early = quote({ leadId, quoteDate: day('2026-05-02') });
    const late = quote({ leadId, quoteDate: day('2026-05-08') });
    const named = deal({
      leadId,
      quoteRecapId: late._id,
      soldDate: day('2026-05-09'),
    });
    const other = deal({ leadId, soldDate: day('2026-05-20') });
    const result = resolveQuoteConversions(
      [early],
      index([named, other], [early, late]),
      TZ,
    );
    expect(result.get(String(early._id))?.deal).toBe(other);
  });
});
