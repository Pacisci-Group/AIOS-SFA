import {
  changeOf,
  foldSold,
  type RawSold,
  sharePct,
  soldTotal,
  toSalesMetrics,
  toServiceMetrics,
} from './analytics.normalize';

const raw = (
  id: unknown,
  premium: number,
  deals: string[],
  extra: Partial<RawSold> = {},
): RawSold => ({
  _id: id,
  premium,
  items: 1,
  policies: 1,
  deals,
  households: deals.map((d) => `h:${d}`),
  ...extra,
});

describe('foldSold', () => {
  it('merges spellings of one line and never counts a sale twice', () => {
    const buckets = foldSold('policyType', [
      raw('Auto', 100, ['d1', 'd2']),
      raw('PYgez', 50, ['d2', 'd3']),
      raw('Home', 70, ['d1']),
    ]);
    const auto = buckets.get('Auto')!;
    expect(auto.acc.premium).toBe(150);
    expect(auto.acc.deals.size).toBe(3);
    expect(buckets.get('Home')!.acc.premium).toBe(70);
  });

  it('keeps the null bucket as a row', () => {
    const buckets = foldSold('producer', [raw(null, 20, ['d9'])]);
    expect(buckets.get('')!.key).toBeNull();
  });
});

describe('toSalesMetrics', () => {
  const sold = soldTotal([raw(null, 1000, ['d1', 'd2'], { net: 900 })]);

  it('reports net only where it is a sale’s figure', () => {
    expect(
      toSalesMetrics(sold, null, { net: true, quotes: false }).netPremium,
    ).toBe(900);
    expect(
      toSalesMetrics(sold, null, { net: false, quotes: false }).netPremium,
    ).toBeNull();
  });

  it('marks quote figures unavailable rather than zero', () => {
    const metrics = toSalesMetrics(sold, null, { net: true, quotes: false });
    expect(metrics.quotes).toBeNull();
    expect(metrics.closingPct).toBeNull();
    expect(metrics.closingGap).toBe('not_available');
  });

  it('computes a closing ratio from the quote side', () => {
    const quoted = { quotedPremium: 2000, quotes: new Set(['q1', 'q2']) };
    expect(
      toSalesMetrics(sold, quoted, { net: true, quotes: true }).closingPct,
    ).toBe(50);
  });
});

describe('changeOf', () => {
  it('is percent for amounts and points for the closing ratio', () => {
    const change = changeOf(
      { premium: 150, closingPct: 40 },
      { premium: 100, closingPct: 30 },
      true,
    );
    expect(change).toEqual({ premium: 50, closingPct: 10 });
  });

  it('is null across the board with no prior window', () => {
    expect(changeOf({ premium: 150 }, { premium: 0 }, false)).toEqual({
      premium: null,
    });
  });
});

describe('sharePct / toServiceMetrics', () => {
  it('shares over nothing are null', () => {
    expect(sharePct(5, 0)).toBeNull();
    expect(sharePct(1, 3)).toBe(33.3);
  });

  it('averages hours over resolved tickets only', () => {
    expect(
      toServiceMetrics({
        _id: null,
        opened: 4,
        resolved: 2,
        stillOpen: 2,
        overdue: 1,
        hoursSum: 30,
      }).avgHoursToResolve,
    ).toBe(15);
    expect(toServiceMetrics(undefined).avgHoursToResolve).toBeNull();
  });
});
