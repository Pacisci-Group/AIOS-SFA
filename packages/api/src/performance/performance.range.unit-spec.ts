import {
  addDays,
  chicagoParts,
  currentChicagoMonth,
  isValidIsoDate,
  resolveRange,
  spanDays,
  toIsoDate,
  toYmd,
} from './performance.range';

/** Chicago is UTC-5 in summer (CDT) and UTC-6 in winter (CST). */
describe('chicagoParts', () => {
  it('reads the Chicago calendar date, not the UTC one', () => {
    // 01:00Z on Aug 6 is still 20:00 on Aug 5 in Chicago. This is the case that
    // silently files an evening sale on tomorrow's scorecard if you use UTC.
    expect(chicagoParts(new Date('2026-08-06T01:00:00.000Z'))).toEqual({
      year: 2026,
      month: 8,
      day: 5,
    });
  });

  it('agrees with UTC once the Chicago day has caught up', () => {
    expect(chicagoParts(new Date('2026-08-06T12:00:00.000Z'))).toEqual({
      year: 2026,
      month: 8,
      day: 6,
    });
  });

  it('handles the winter offset, which is an hour larger', () => {
    // 05:30Z in January is 23:30 the previous day in Chicago (CST, UTC-6).
    expect(chicagoParts(new Date('2026-01-15T05:30:00.000Z'))).toEqual({
      year: 2026,
      month: 1,
      day: 14,
    });
  });
});

describe('addDays', () => {
  it('walks across a month boundary', () => {
    expect(addDays({ year: 2026, month: 1, day: 31 }, 1)).toEqual({
      year: 2026,
      month: 2,
      day: 1,
    });
  });

  it('walks backwards across a year boundary', () => {
    expect(addDays({ year: 2026, month: 1, day: 1 }, -1)).toEqual({
      year: 2025,
      month: 12,
      day: 31,
    });
  });

  it('knows February in a leap year', () => {
    expect(addDays({ year: 2028, month: 2, day: 28 }, 1)).toEqual({
      year: 2028,
      month: 2,
      day: 29,
    });
  });

  // The whole reason arithmetic runs on the bare triple: a DST transition day
  // is 23 or 25 hours long, so millisecond arithmetic on instants would drift.
  it('is unaffected by the spring-forward day', () => {
    // 2026-03-08 is the US spring-forward date; that Chicago day has 23 hours.
    expect(addDays({ year: 2026, month: 3, day: 7 }, 1)).toEqual({
      year: 2026,
      month: 3,
      day: 8,
    });
    expect(addDays({ year: 2026, month: 3, day: 8 }, 1)).toEqual({
      year: 2026,
      month: 3,
      day: 9,
    });
  });

  it('is unaffected by the fall-back day', () => {
    // 2026-11-01 is the US fall-back date; that Chicago day has 25 hours.
    expect(addDays({ year: 2026, month: 10, day: 31 }, 1)).toEqual({
      year: 2026,
      month: 11,
      day: 1,
    });
    expect(addDays({ year: 2026, month: 11, day: 1 }, 1)).toEqual({
      year: 2026,
      month: 11,
      day: 2,
    });
  });
});

describe('toYmd / toIsoDate', () => {
  it('zero-pads single-digit months and days', () => {
    const date = { year: 2026, month: 3, day: 7 };
    expect(toYmd(date)).toBe(20260307);
    expect(toIsoDate(date)).toBe('2026-03-07');
  });

  it('orders monotonically across a month boundary, which the range relies on', () => {
    expect(toYmd({ year: 2026, month: 1, day: 31 })).toBeLessThan(
      toYmd({ year: 2026, month: 2, day: 1 }),
    );
  });
});

describe('isValidIsoDate', () => {
  it('accepts a real date', () => {
    expect(isValidIsoDate('2026-02-28')).toBe(true);
    expect(isValidIsoDate('2028-02-29')).toBe(true); // leap year
  });

  it('rejects an overflowing date the regex alone would let through', () => {
    expect(isValidIsoDate('2026-02-31')).toBe(false);
    expect(isValidIsoDate('2026-02-29')).toBe(false); // not a leap year
    expect(isValidIsoDate('2026-13-01')).toBe(false);
  });

  it('rejects a malformed string', () => {
    expect(isValidIsoDate('2026-1-1')).toBe(false);
    expect(isValidIsoDate('not-a-date')).toBe(false);
    expect(isValidIsoDate('')).toBe(false);
  });
});

describe('spanDays', () => {
  it('counts a single day as 1', () => {
    expect(spanDays('2026-08-06', '2026-08-06')).toBe(1);
  });

  it('counts inclusively across a month boundary', () => {
    expect(spanDays('2026-01-31', '2026-02-01')).toBe(2);
  });

  it('counts a full leap year as 366, the cap exactly', () => {
    expect(spanDays('2028-01-01', '2028-12-31')).toBe(366);
  });

  it('is unaffected by DST transitions inside the window', () => {
    // March 2026 contains the spring-forward day; the month is still 31 days.
    expect(spanDays('2026-03-01', '2026-03-31')).toBe(31);
    // November 2026 contains the fall-back day.
    expect(spanDays('2026-11-01', '2026-11-30')).toBe(30);
  });
});

describe('resolveRange', () => {
  /** Midday UTC on Aug 6 — unambiguously Aug 6 in Chicago too. */
  const now = new Date('2026-08-06T17:00:00.000Z');

  it('today is a single Chicago day', () => {
    expect(resolveRange('today', {}, now)).toEqual({
      startYmd: 20260806,
      endYmd: 20260807,
      from: '2026-08-06',
      to: '2026-08-06',
    });
  });

  it('resolves today from the Chicago date, not the UTC one', () => {
    // 01:00Z on Aug 6 is still Aug 5 in Chicago, so "today" must be Aug 5.
    const lateEvening = new Date('2026-08-06T01:00:00.000Z');
    expect(resolveRange('today', {}, lateEvening)).toMatchObject({
      startYmd: 20260805,
      endYmd: 20260806,
    });
  });

  it('week is the trailing 7 days INCLUDING today, not a calendar week', () => {
    const range = resolveRange('week', {}, now);
    expect(range).toMatchObject({ from: '2026-07-31', to: '2026-08-06' });
    expect(spanDays(range.from, range.to)).toBe(7);
  });

  it('mtd stops at today, not at month end', () => {
    // The divergence from legacy: a producer can type a future soldDate, and
    // "month to date" must not count next week's sales.
    expect(resolveRange('mtd', {}, now)).toMatchObject({
      startYmd: 20260801,
      endYmd: 20260807,
      from: '2026-08-01',
      to: '2026-08-06',
    });
  });

  it('lastMonth is the whole previous calendar month', () => {
    expect(resolveRange('lastMonth', {}, now)).toEqual({
      startYmd: 20260701,
      endYmd: 20260801,
      from: '2026-07-01',
      to: '2026-07-31',
    });
  });

  it('lastMonth crosses a year boundary into December', () => {
    const january = new Date('2026-01-15T17:00:00.000Z');
    expect(resolveRange('lastMonth', {}, january)).toEqual({
      startYmd: 20251201,
      endYmd: 20260101,
      from: '2025-12-01',
      to: '2025-12-31',
    });
  });

  it('lastMonth handles a short February', () => {
    const march = new Date('2026-03-15T17:00:00.000Z');
    expect(resolveRange('lastMonth', {}, march)).toMatchObject({
      from: '2026-02-01',
      to: '2026-02-28',
      endYmd: 20260301,
    });
  });

  it('week spans a month boundary correctly', () => {
    const earlyMonth = new Date('2026-08-03T17:00:00.000Z');
    const range = resolveRange('week', {}, earlyMonth);
    expect(range).toMatchObject({
      from: '2026-07-28',
      to: '2026-08-03',
      startYmd: 20260728,
      endYmd: 20260804,
    });
    expect(spanDays(range.from, range.to)).toBe(7);
  });

  it('custom takes an inclusive `to` and emits an exclusive endYmd', () => {
    expect(
      resolveRange('custom', { from: '2026-01-01', to: '2026-01-31' }, now),
    ).toEqual({
      startYmd: 20260101,
      endYmd: 20260201,
      from: '2026-01-01',
      to: '2026-01-31',
    });
  });

  it('custom covering a single day still spans that day', () => {
    expect(
      resolveRange('custom', { from: '2026-08-06', to: '2026-08-06' }, now),
    ).toMatchObject({ startYmd: 20260806, endYmd: 20260807 });
  });

  it('custom throws without both bounds — the DTO rejects this first', () => {
    expect(() => resolveRange('custom', { from: '2026-01-01' }, now)).toThrow();
    expect(() => resolveRange('custom', {}, now)).toThrow();
  });
});

describe('currentChicagoMonth', () => {
  it('zero-pads the month', () => {
    expect(currentChicagoMonth(new Date('2026-03-15T17:00:00.000Z'))).toBe(
      '2026-03',
    );
  });

  it('uses the Chicago date at a month boundary', () => {
    // 02:00Z on Sep 1 is still 21:00 on Aug 31 in Chicago.
    expect(currentChicagoMonth(new Date('2026-09-01T02:00:00.000Z'))).toBe(
      '2026-08',
    );
  });
});
