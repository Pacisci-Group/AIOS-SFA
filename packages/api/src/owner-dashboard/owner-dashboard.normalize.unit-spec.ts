import {
  closingPct,
  ratioPct,
  toClosingRatio,
  toLobMix,
  toTrend,
} from './owner-dashboard.normalize';

describe('toTrend', () => {
  it('reports percent change against the comparison window', () => {
    expect(toTrend(1100, 1000, true)).toEqual({
      current: 1100,
      previous: 1000,
      change: 10,
      unit: 'percent',
      status: 'ok',
    });
  });

  it('goes negative for a drop', () => {
    expect(toTrend(750, 1000, true).change).toBe(-25);
  });

  it('is a UI state, not a number, when the comparison window held nothing', () => {
    // The business may not have existed. Never +∞%, never −100%.
    expect(toTrend(1100, 0, false)).toEqual({
      current: 1100,
      previous: null,
      change: null,
      unit: 'percent',
      status: 'no_prior_data',
    });
  });

  it('has no percentage when the base is zero but the window had data', () => {
    // Sales worth $0 *is* data — but "up from nothing" is not a percentage.
    const trend = toTrend(500, 0, true);
    expect(trend.status).toBe('ok');
    expect(trend.change).toBeNull();
  });

  it('has no change when the figure itself is undefined', () => {
    // An average over zero households.
    expect(toTrend(null, 900, true).change).toBeNull();
    expect(toTrend(900, null, true).change).toBeNull();
  });

  it('moves in points, not percent, for a figure that is already a percentage', () => {
    // 40% → 50% is +10 points. It is *not* +25%.
    expect(toTrend(50, 40, true, 'points').change).toBe(10);
  });
});

describe('ratioPct', () => {
  it('is sold over quoted, as a percentage', () => {
    expect(ratioPct(2500, 10_000)).toBe(25);
  });

  it("may exceed 100 — sales are not only this window's quotes", () => {
    expect(ratioPct(3000, 2000)).toBe(150);
  });

  it('is null, not zero and not Infinity, when nothing was quoted', () => {
    expect(ratioPct(3000, 0)).toBeNull();
  });
});

describe('toClosingRatio', () => {
  const side = (soldPremium: number, quotedPremium: number) => ({
    soldPremium,
    quotedPremium,
    quoteCount: quotedPremium > 0 ? 1 : 0,
    soldCount: 1,
  });

  it("carries both sides of the ratio for the card's sub text", () => {
    const ratio = toClosingRatio(side(2500, 10_000), side(2000, 10_000));

    expect(ratio.current).toBe(25);
    expect(ratio.previous).toBe(20);
    expect(ratio.change).toBe(5);
    expect(ratio.unit).toBe('points');
    expect(ratio.soldPremium).toBe(2500);
    expect(ratio.quotedPremium).toBe(10_000);
    expect(ratio.reason).toBeNull();
  });

  it('says why there is no ratio when nothing was quoted', () => {
    const ratio = toClosingRatio(side(2500, 0), side(2000, 10_000));

    expect(ratio.current).toBeNull();
    expect(ratio.reason).toBe('no_quotes');
    expect(ratio.change).toBeNull();
  });

  it('treats a comparison window with sales but no quotes as no prior data', () => {
    const ratio = toClosingRatio(side(2500, 10_000), side(900_000, 0));

    expect(ratio.status).toBe('no_prior_data');
    expect(ratio.previous).toBeNull();
    expect(ratio.change).toBeNull();
  });
});

describe('closingPct', () => {
  const side = (quoteCount: number, soldCount: number) => ({
    soldPremium: 2_031_901,
    quotedPremium: 33_987,
    quoteCount,
    soldCount,
  });

  it('refuses a ratio built on too few quotes for the sales beside them', () => {
    // Production, calendar 2025: 9 quote recaps against 1,112 deals. The
    // arithmetic answer is 5,978% — a number, and not a closing rate.
    expect(closingPct(side(9, 1112))).toEqual({
      pct: null,
      gap: 'too_few_quotes',
    });
  });

  it('keeps the ratio once one sale in ten has a quote behind it', () => {
    expect(closingPct(side(111, 1112)).gap).toBe('too_few_quotes');
    expect(closingPct(side(112, 1112)).gap).toBeNull();
  });

  it('does not punish a small window for being small', () => {
    // Three quotes against five sales over three days is thin, but it is real.
    const { pct, gap } = closingPct({
      soldPremium: 3000,
      quotedPremium: 6000,
      quoteCount: 3,
      soldCount: 5,
    });

    expect(pct).toBe(50);
    expect(gap).toBeNull();
  });

  it('says "no quotes" rather than "too few" when there are none', () => {
    expect(closingPct(side(0, 1112)).gap).toBe('no_quotes');
  });

  it('has a ratio for quotes with no sales — 0%, which is information', () => {
    expect(
      closingPct({
        soldPremium: 0,
        quotedPremium: 5000,
        quoteCount: 4,
        soldCount: 0,
      }),
    ).toEqual({ pct: 0, gap: null });
  });
});

describe('toLobMix', () => {
  it('ranks the top three by share of policies, and closes the bar at 100', () => {
    const mix = toLobMix([
      { policyType: 'Auto', count: 45 },
      { policyType: 'Home', count: 40 },
      { policyType: 'Landlord', count: 8 },
      { policyType: 'Renters', count: 5 },
      { policyType: 'Umbrella', count: 2 },
    ]);

    expect(mix.policyCount).toBe(100);
    expect(mix.top).toEqual([
      { policyType: 'Auto', policyCount: 45, pct: 45 },
      { policyType: 'Home', policyCount: 40, pct: 40 },
      { policyType: 'Landlord', policyCount: 8, pct: 8 },
    ]);
    expect(mix.otherPct).toBe(7);
  });

  it('merges a raw SmartSuite code into the label it means', () => {
    // `policies.policyType` holds a label on some rows and a code on others.
    const mix = toLobMix([
      { policyType: 'Landlord', count: 3 },
      { policyType: 'Landlords', count: 1 },
    ]);

    expect(mix.top).toEqual([
      { policyType: 'Landlord', policyCount: 4, pct: 100 },
    ]);
    expect(mix.otherPct).toBe(0);
  });

  it('counts an uncatalogued code as a policy, but never names it', () => {
    const mix = toLobMix([
      { policyType: 'Auto', count: 6 },
      // A SmartSuite code the alias map has no entry for.
      { policyType: 'Zz9Qx', count: 4 },
    ]);

    expect(mix.policyCount).toBe(10);
    expect(mix.top).toEqual([{ policyType: 'Auto', policyCount: 6, pct: 60 }]);
    expect(mix.otherPct).toBe(40);
  });

  it('resolves the codes legacy documented (PAC-135)', () => {
    const mix = toLobMix([
      { policyType: 'BK08B', count: 1 },
      { policyType: 'Boat Owners', count: 1 },
    ]);

    expect(mix.top).toEqual([
      { policyType: 'Boat Owners', policyCount: 2, pct: 100 },
    ]);
  });

  it('ignores untyped rows', () => {
    expect(toLobMix([{ policyType: null, count: 9 }])).toEqual({
      policyCount: 0,
      top: [],
      otherPct: 0,
    });
  });

  it('breaks a tie by name so the order is stable between loads', () => {
    const mix = toLobMix([
      { policyType: 'Home', count: 5 },
      { policyType: 'Auto', count: 5 },
    ]);

    expect(mix.top.map((slice) => slice.policyType)).toEqual(['Auto', 'Home']);
  });

  it('is empty rather than NaN when nothing was sold', () => {
    expect(toLobMix([])).toEqual({ policyCount: 0, top: [], otherPct: 0 });
  });
});
