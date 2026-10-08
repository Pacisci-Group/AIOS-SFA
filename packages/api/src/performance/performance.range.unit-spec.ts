import {
  addDays,
  currentMonthIn,
  customRange,
  fromYmd,
  isValidIsoDate,
  recentMonthsIn,
  resolveComparison,
  resolveRange,
  spanDays,
  toIsoDate,
  toYmd,
  zonedDate,
  zonedDayStart,
} from './performance.range';

/** Chicago is UTC-5 in summer (CDT) and UTC-6 in winter (CST). */
const CHICAGO = 'America/Chicago';
/** A half-hour zone, UTC+5:30 all year — the cheapest proof no offset is assumed. */
const KOLKATA = 'Asia/Kolkata';

describe('zonedDate', () => {
  it('reads the Chicago calendar date, not the UTC one', () => {
    // 01:00Z on Aug 6 is still 20:00 on Aug 5 in Chicago. This is the case that
    // silently files an evening sale on tomorrow's scorecard if you use UTC.
    expect(zonedDate(new Date('2026-08-06T01:00:00.000Z'), CHICAGO)).toEqual({
      year: 2026,
      month: 8,
      day: 5,
    });
  });

  it('agrees with UTC once the Chicago day has caught up', () => {
    expect(zonedDate(new Date('2026-08-06T12:00:00.000Z'), CHICAGO)).toEqual({
      year: 2026,
      month: 8,
      day: 6,
    });
  });

  it('handles the winter offset, which is an hour larger', () => {
    // 05:30Z in January is 23:30 the previous day in Chicago (CST, UTC-6).
    expect(zonedDate(new Date('2026-01-15T05:30:00.000Z'), CHICAGO)).toEqual({
      year: 2026,
      month: 1,
      day: 14,
    });
  });

  it('is already tomorrow east of UTC when it is still today in Chicago', () => {
    // 19:00Z on Aug 5 is 00:30 on Aug 6 in Kolkata and 14:00 on Aug 5 in Chicago.
    const at = new Date('2026-08-05T19:00:00.000Z');
    expect(zonedDate(at, KOLKATA)).toEqual({ year: 2026, month: 8, day: 6 });
    expect(zonedDate(at, CHICAGO)).toEqual({ year: 2026, month: 8, day: 5 });
  });

  it('refuses to run without a zone rather than falling back to the host', () => {
    const at = new Date('2026-08-06T12:00:00.000Z');
    expect(() => zonedDate(at, undefined as unknown as string)).toThrow(
      /time zone is required/i,
    );
    expect(() => zonedDate(at, '')).toThrow(/time zone is required/i);
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

  it('today is a single agency day', () => {
    expect(resolveRange('today', CHICAGO, {}, now)).toEqual({
      startYmd: 20260806,
      endYmd: 20260807,
      from: '2026-08-06',
      to: '2026-08-06',
    });
  });

  it('resolves today from the agency date, not the UTC one', () => {
    // 01:00Z on Aug 6 is still Aug 5 in Chicago, so "today" must be Aug 5.
    const lateEvening = new Date('2026-08-06T01:00:00.000Z');
    expect(resolveRange('today', CHICAGO, {}, lateEvening)).toMatchObject({
      startYmd: 20260805,
      endYmd: 20260806,
    });
  });

  it('cuts today on the zone it is given, not on Central', () => {
    // 19:00Z on Aug 5: still Aug 5 in Chicago, already Aug 6 in Kolkata.
    const at = new Date('2026-08-05T19:00:00.000Z');
    expect(resolveRange('today', CHICAGO, {}, at)).toMatchObject({
      from: '2026-08-05',
      to: '2026-08-05',
    });
    expect(resolveRange('today', KOLKATA, {}, at)).toMatchObject({
      from: '2026-08-06',
      to: '2026-08-06',
    });
  });

  it('week is the trailing 7 days INCLUDING today, not a calendar week', () => {
    const range = resolveRange('week', CHICAGO, {}, now);
    expect(range).toMatchObject({ from: '2026-07-31', to: '2026-08-06' });
    expect(spanDays(range.from, range.to)).toBe(7);
  });

  it('mtd stops at today, not at month end', () => {
    // The divergence from legacy: a producer can type a future soldDate, and
    // "month to date" must not count next week's sales.
    expect(resolveRange('mtd', CHICAGO, {}, now)).toMatchObject({
      startYmd: 20260801,
      endYmd: 20260807,
      from: '2026-08-01',
      to: '2026-08-06',
    });
  });

  it('mtd rolls into the new month on the zone its agency keeps', () => {
    // 19:30Z on Aug 31 is already Sep 1 in Kolkata: a one-day MTD there, while
    // Chicago is still finishing August.
    const at = new Date('2026-08-31T19:30:00.000Z');
    expect(resolveRange('mtd', KOLKATA, {}, at)).toMatchObject({
      from: '2026-09-01',
      to: '2026-09-01',
    });
    expect(resolveRange('mtd', CHICAGO, {}, at)).toMatchObject({
      from: '2026-08-01',
      to: '2026-08-31',
    });
  });

  it('lastMonth is the whole previous calendar month', () => {
    expect(resolveRange('lastMonth', CHICAGO, {}, now)).toEqual({
      startYmd: 20260701,
      endYmd: 20260801,
      from: '2026-07-01',
      to: '2026-07-31',
    });
  });

  it('lastMonth crosses a year boundary into December', () => {
    const january = new Date('2026-01-15T17:00:00.000Z');
    expect(resolveRange('lastMonth', CHICAGO, {}, january)).toEqual({
      startYmd: 20251201,
      endYmd: 20260101,
      from: '2025-12-01',
      to: '2025-12-31',
    });
  });

  it('lastMonth handles a short February', () => {
    const march = new Date('2026-03-15T17:00:00.000Z');
    expect(resolveRange('lastMonth', CHICAGO, {}, march)).toMatchObject({
      from: '2026-02-01',
      to: '2026-02-28',
      endYmd: 20260301,
    });
  });

  it('week spans a month boundary correctly', () => {
    const earlyMonth = new Date('2026-08-03T17:00:00.000Z');
    const range = resolveRange('week', CHICAGO, {}, earlyMonth);
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
      resolveRange(
        'custom',
        CHICAGO,
        { from: '2026-01-01', to: '2026-01-31' },
        now,
      ),
    ).toEqual({
      startYmd: 20260101,
      endYmd: 20260201,
      from: '2026-01-01',
      to: '2026-01-31',
    });
  });

  it('custom covering a single day still spans that day', () => {
    expect(
      resolveRange(
        'custom',
        CHICAGO,
        { from: '2026-08-06', to: '2026-08-06' },
        now,
      ),
    ).toMatchObject({ startYmd: 20260806, endYmd: 20260807 });
  });

  it('custom throws without both bounds — the DTO rejects this first', () => {
    expect(() =>
      resolveRange('custom', CHICAGO, { from: '2026-01-01' }, now),
    ).toThrow();
    expect(() => resolveRange('custom', CHICAGO, {}, now)).toThrow();
  });

  it('custom still insists on a zone, so a stale call site cannot hide there', () => {
    expect(() =>
      resolveRange(
        'custom',
        { from: '2026-01-01', to: '2026-01-31' } as unknown as string,
        {},
        now,
      ),
    ).toThrow(/time zone is required/i);
  });
});

describe('customRange', () => {
  it('is the custom window without a zone', () => {
    expect(customRange('2026-02-01', '2026-02-28')).toEqual({
      startYmd: 20260201,
      endYmd: 20260301,
      from: '2026-02-01',
      to: '2026-02-28',
    });
  });
});

// PAC-135: the Owner dashboard's longer presets.
describe('resolveRange — owner presets', () => {
  // Noon Chicago on Mon 21 Sep 2026.
  const now = new Date('2026-09-21T17:00:00.000Z');
  const window = (
    key: Parameters<typeof resolveRange>[0],
    at = now,
    timeZone = CHICAGO,
  ) => {
    const { from, to } = resolveRange(key, timeZone, {}, at);
    return { from, to };
  };

  it('last3Months is the three complete months before this one', () => {
    expect(window('last3Months')).toEqual({
      from: '2026-06-01',
      to: '2026-08-31',
    });
  });

  it('last12Months is the twelve complete months before this one', () => {
    expect(window('last12Months')).toEqual({
      from: '2025-09-01',
      to: '2026-08-31',
    });
  });

  it('last3Months crosses a year boundary', () => {
    expect(window('last3Months', new Date('2026-02-10T17:00:00.000Z'))).toEqual(
      { from: '2025-11-01', to: '2026-01-31' },
    );
  });

  it('ytd runs from Jan 1 to today, not to year end', () => {
    expect(window('ytd')).toEqual({ from: '2026-01-01', to: '2026-09-21' });
  });

  it('ytd starts a new year when the agency does, not when UTC does', () => {
    // 19:00Z on Dec 31 is 00:30 on Jan 1 in Kolkata and 13:00 Dec 31 in Chicago.
    const at = new Date('2026-12-31T19:00:00.000Z');
    expect(window('ytd', at, KOLKATA)).toEqual({
      from: '2027-01-01',
      to: '2027-01-01',
    });
    expect(window('ytd', at, CHICAGO)).toEqual({
      from: '2026-01-01',
      to: '2026-12-31',
    });
  });

  it('lastYear is the whole previous calendar year', () => {
    expect(window('lastYear')).toEqual({
      from: '2025-01-01',
      to: '2025-12-31',
    });
  });

  it('is half-open like every other window', () => {
    const range = resolveRange('lastYear', CHICAGO, {}, now);
    expect(range.startYmd).toBe(20250101);
    expect(range.endYmd).toBe(20260101);
  });
});

describe('resolveComparison', () => {
  const now = new Date('2026-09-21T17:00:00.000Z');
  const compare = (
    key: Parameters<typeof resolveComparison>[0],
    custom: { from?: string; to?: string } = {},
    at = now,
    timeZone = CHICAGO,
  ) => {
    const { from, to } = resolveComparison(key, timeZone, custom, at);
    return { from, to };
  };

  it('mtd compares the same elapsed days of last month — not all of it', () => {
    // Sep 1–21 against Aug 1–21. Against *all* of August the badge would read
    // red until the 30th; against "the preceding 21 days" it would be Aug 11–31.
    expect(compare('mtd')).toEqual({ from: '2026-08-01', to: '2026-08-21' });
  });

  it('mtd counts the elapsed days on the agency calendar', () => {
    // 19:00Z on Sep 21 is already Sep 22 in Kolkata: one more elapsed day.
    const at = new Date('2026-09-21T19:00:00.000Z');
    expect(compare('mtd', {}, at, KOLKATA)).toEqual({
      from: '2026-08-01',
      to: '2026-08-22',
    });
    expect(compare('mtd', {}, at, CHICAGO)).toEqual({
      from: '2026-08-01',
      to: '2026-08-21',
    });
  });

  it('mtd clamps to a shorter previous month', () => {
    // Mar 31 has no Feb 31: the whole of February is the honest comparison.
    expect(compare('mtd', {}, new Date('2026-03-31T17:00:00.000Z'))).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
  });

  it('mtd in January reaches back into December of the year before', () => {
    expect(compare('mtd', {}, new Date('2026-01-15T17:00:00.000Z'))).toEqual({
      from: '2025-12-01',
      to: '2025-12-15',
    });
  });

  it('lastMonth compares with the month before it, whatever their lengths', () => {
    // August (31 days) against July (31) here; in March it is Feb against Jan.
    expect(compare('lastMonth')).toEqual({
      from: '2026-07-01',
      to: '2026-07-31',
    });
    expect(
      compare('lastMonth', {}, new Date('2026-03-10T17:00:00.000Z')),
    ).toEqual({ from: '2026-01-01', to: '2026-01-31' });
  });

  it('last12Months compares with the twelve months before those', () => {
    expect(compare('last12Months')).toEqual({
      from: '2024-09-01',
      to: '2025-08-31',
    });
  });

  it('last3Months compares with the three months before those', () => {
    expect(compare('last3Months')).toEqual({
      from: '2026-03-01',
      to: '2026-05-31',
    });
  });

  it('ytd compares with the same dates last year, not the 264 days before Jan 1', () => {
    expect(compare('ytd')).toEqual({ from: '2025-01-01', to: '2025-09-21' });
  });

  it('ytd on a leap day clamps to Feb 28', () => {
    expect(compare('ytd', {}, new Date('2028-02-29T17:00:00.000Z'))).toEqual({
      from: '2027-01-01',
      to: '2027-02-28',
    });
  });

  it('lastYear compares with the year before it', () => {
    expect(compare('lastYear')).toEqual({
      from: '2024-01-01',
      to: '2024-12-31',
    });
  });

  it('custom compares with the preceding span of equal length', () => {
    // 13 days, Sep 1–13 → the 13 days before: Aug 19–31.
    const custom = { from: '2026-09-01', to: '2026-09-13' };
    expect(compare('custom', custom)).toEqual({
      from: '2026-08-19',
      to: '2026-08-31',
    });
    expect(spanDays('2026-08-19', '2026-08-31')).toBe(
      spanDays(custom.from, custom.to),
    );
  });

  it('a one-day custom window compares with the day before', () => {
    expect(compare('custom', { from: '2026-09-21', to: '2026-09-21' })).toEqual(
      { from: '2026-09-20', to: '2026-09-20' },
    );
  });

  it('never overlaps the window it is compared with', () => {
    for (const key of [
      'mtd',
      'lastMonth',
      'last3Months',
      'last12Months',
      'ytd',
      'lastYear',
    ] as const) {
      const current = resolveRange(key, CHICAGO, {}, now);
      const previous = resolveComparison(key, CHICAGO, {}, now);
      expect(previous.endYmd).toBeLessThanOrEqual(current.startYmd);
    }
  });
});

describe('currentMonthIn', () => {
  it('zero-pads the month', () => {
    expect(currentMonthIn(CHICAGO, new Date('2026-03-15T17:00:00.000Z'))).toBe(
      '2026-03',
    );
  });

  it('uses the agency date at a month boundary', () => {
    // 02:00Z on Sep 1 is still 21:00 on Aug 31 in Chicago.
    expect(currentMonthIn(CHICAGO, new Date('2026-09-01T02:00:00.000Z'))).toBe(
      '2026-08',
    );
  });

  it('rolls over at the agency midnight, not at Central midnight', () => {
    // 19:00Z on Aug 31 is 00:30 Sep 1 in Kolkata.
    const at = new Date('2026-08-31T19:00:00.000Z');
    expect(currentMonthIn(KOLKATA, at)).toBe('2026-09');
    expect(currentMonthIn(CHICAGO, at)).toBe('2026-08');
  });
});

describe('recentMonthsIn', () => {
  it('lists this month and the ones before it, newest first', () => {
    expect(
      recentMonthsIn(3, CHICAGO, new Date('2026-03-15T17:00:00.000Z')),
    ).toEqual(['2026-03', '2026-02', '2026-01']);
  });

  it('walks back across a year boundary', () => {
    expect(
      recentMonthsIn(2, CHICAGO, new Date('2026-01-15T17:00:00.000Z')),
    ).toEqual(['2026-01', '2025-12']);
  });

  it('starts from the agency month, which can differ from the UTC one', () => {
    const at = new Date('2026-08-31T19:00:00.000Z');
    expect(recentMonthsIn(2, KOLKATA, at)).toEqual(['2026-09', '2026-08']);
    expect(recentMonthsIn(2, CHICAGO, at)).toEqual(['2026-08', '2026-07']);
  });
});

describe('zonedDayStart', () => {
  it('is 05:00Z in summer (CDT)', () => {
    expect(
      zonedDayStart({ year: 2026, month: 8, day: 6 }, CHICAGO).toISOString(),
    ).toBe('2026-08-06T05:00:00.000Z');
  });

  it('is 06:00Z in winter (CST)', () => {
    expect(
      zonedDayStart({ year: 2026, month: 1, day: 15 }, CHICAGO).toISOString(),
    ).toBe('2026-01-15T06:00:00.000Z');
  });

  it('round-trips through zonedDate', () => {
    const date = { year: 2026, month: 11, day: 1 }; // DST ends that day
    const start = zonedDayStart(date, CHICAGO);
    expect(zonedDate(start, CHICAGO)).toEqual(date);
    expect(zonedDate(new Date(start.getTime() - 1), CHICAGO)).not.toEqual(date);
  });

  it('lands on the half hour for a half-hour zone', () => {
    // The hourly walk this replaced answered 19:00Z here — 00:30 local.
    expect(
      zonedDayStart({ year: 2026, month: 8, day: 6 }, KOLKATA).toISOString(),
    ).toBe('2026-08-05T18:30:00.000Z');
  });

  it('lands on the quarter hour for Kathmandu (UTC+5:45)', () => {
    expect(
      zonedDayStart(
        { year: 2026, month: 8, day: 6 },
        'Asia/Kathmandu',
      ).toISOString(),
    ).toBe('2026-08-05T18:15:00.000Z');
  });

  it('is right past UTC+12, where the day starts before noon UTC the day before', () => {
    // Auckland in southern summer is UTC+13; Kiritimati is UTC+14 all year.
    expect(
      zonedDayStart(
        { year: 2026, month: 1, day: 15 },
        'Pacific/Auckland',
      ).toISOString(),
    ).toBe('2026-01-14T11:00:00.000Z');
    expect(
      zonedDayStart(
        { year: 2026, month: 8, day: 6 },
        'Pacific/Kiritimati',
      ).toISOString(),
    ).toBe('2026-08-05T10:00:00.000Z');
  });

  it('is right at the far western edge too', () => {
    // Etc/GMT+12 is UTC−12: the day starts at noon UTC.
    expect(
      zonedDayStart(
        { year: 2026, month: 8, day: 6 },
        'Etc/GMT+12',
      ).toISOString(),
    ).toBe('2026-08-06T12:00:00.000Z');
  });

  it('returns the first instant that exists when midnight is skipped by DST', () => {
    // Cairo springs forward from 00:00 to 01:00 on the last Friday of April:
    // 2026-04-24 has no midnight, and its first instant is 01:00 EEST = 22:00Z.
    const start = zonedDayStart(
      { year: 2026, month: 4, day: 24 },
      'Africa/Cairo',
    );
    expect(start.toISOString()).toBe('2026-04-23T22:00:00.000Z');
    expect(zonedDate(start, 'Africa/Cairo')).toEqual({
      year: 2026,
      month: 4,
      day: 24,
    });
    expect(zonedDate(new Date(start.getTime() - 1), 'Africa/Cairo')).toEqual({
      year: 2026,
      month: 4,
      day: 23,
    });
  });
});

describe('fromYmd', () => {
  it('inverts toYmd', () => {
    const date = { year: 2026, month: 9, day: 23 };
    expect(fromYmd(toYmd(date))).toEqual(date);
  });
});
