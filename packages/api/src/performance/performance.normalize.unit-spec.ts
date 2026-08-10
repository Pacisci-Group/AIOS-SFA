import { avgPerHousehold, toMetric } from './performance.normalize';

describe('avgPerHousehold', () => {
  it('divides and rounds to cents', () => {
    expect(avgPerHousehold(4250, 3)).toBe(1416.67);
  });

  it('returns null at a zero denominator, not 0 and not NaN', () => {
    // "Nothing to average" and "averages zero per household" are different
    // statements, and 0/0 would otherwise propagate NaN through the response.
    expect(avgPerHousehold(0, 0)).toBeNull();
    expect(avgPerHousehold(1000, 0)).toBeNull();
  });

  it('returns null for a negative denominator rather than a negative average', () => {
    expect(avgPerHousehold(1000, -1)).toBeNull();
  });

  it('handles a single household exactly', () => {
    expect(avgPerHousehold(1234.56, 1)).toBe(1234.56);
  });
});

describe('toMetric', () => {
  it('maps an aggregation row and derives both averages', () => {
    expect(
      toMetric({
        premium: 42500,
        itemCount: 32,
        recordCount: 20,
        householdCount: 16,
      }),
    ).toEqual({
      premium: 42500,
      itemCount: 32,
      recordCount: 20,
      householdCount: 16,
      avgPremiumPerHousehold: 2656.25,
      avgItemsPerHousehold: 2,
    });
  });

  // The classic $group trap: a $match that selects nothing makes
  // `{ $group: { _id: null } }` emit ZERO documents, not one row of zeroes.
  it('returns an all-zero card when the range matched nothing', () => {
    expect(toMetric(undefined)).toEqual({
      premium: 0,
      itemCount: 0,
      recordCount: 0,
      householdCount: 0,
      avgPremiumPerHousehold: null,
      avgItemsPerHousehold: null,
    });
  });

  it('never shares the empty card between callers', () => {
    // A shared constant would let one request's mutation leak into the next.
    const first = toMetric(undefined);
    const second = toMetric(undefined);
    expect(first).not.toBe(second);
  });

  it('rounds a float-summed premium to cents', () => {
    // 1200.10 + 899.95 is 2100.0499999999997 in IEEE-754, and Mongo's $sum
    // hands that value straight through.
    expect(
      toMetric({
        premium: 2100.0499999999997,
        itemCount: 2,
        recordCount: 2,
        householdCount: 1,
      }),
    ).toMatchObject({ premium: 2100.05, avgPremiumPerHousehold: 2100.05 });
  });

  it('reports zeroed counts with null averages when rows matched but carry no premium', () => {
    // Distinct from the no-rows case: recordCount proves documents matched.
    expect(
      toMetric({
        premium: 0,
        itemCount: 0,
        recordCount: 3,
        householdCount: 0,
      }),
    ).toMatchObject({
      recordCount: 3,
      avgPremiumPerHousehold: null,
      avgItemsPerHousehold: null,
    });
  });
});
