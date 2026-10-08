import {
  bucketsBetween,
  fillBuckets,
  instantBucketExpr,
  ymdBucketExpr,
} from './time-buckets';

describe('bucketsBetween', () => {
  it('lists every day, inclusive of both ends', () => {
    const buckets = bucketsBetween(
      { from: '2026-02-27', to: '2026-03-02' },
      'day',
    );
    expect(buckets.map((b) => b.key)).toEqual([
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
      '2026-03-02',
    ]);
    expect(buckets[0]).toEqual({
      key: '2026-02-27',
      from: '2026-02-27',
      to: '2026-02-27',
    });
  });

  it('keys weeks by their Monday and clamps the ends to the window', () => {
    // 6 May 2026 is a Wednesday; 20 May is the following Wednesday.
    const buckets = bucketsBetween(
      { from: '2026-05-06', to: '2026-05-20' },
      'week',
    );
    expect(buckets).toEqual([
      { key: '2026-05-04', from: '2026-05-06', to: '2026-05-10' },
      { key: '2026-05-11', from: '2026-05-11', to: '2026-05-17' },
      { key: '2026-05-18', from: '2026-05-18', to: '2026-05-20' },
    ]);
  });

  it('treats a Sunday as the end of its week, not the start of the next', () => {
    const [bucket] = bucketsBetween(
      { from: '2026-05-10', to: '2026-05-10' },
      'week',
    );
    expect(bucket.key).toBe('2026-05-04');
  });

  it('keys months YYYY-MM across a year boundary, with real month ends', () => {
    const buckets = bucketsBetween(
      { from: '2025-11-15', to: '2026-02-10' },
      'month',
    );
    expect(buckets).toEqual([
      { key: '2025-11', from: '2025-11-15', to: '2025-11-30' },
      { key: '2025-12', from: '2025-12-01', to: '2025-12-31' },
      { key: '2026-01', from: '2026-01-01', to: '2026-01-31' },
      { key: '2026-02', from: '2026-02-01', to: '2026-02-10' },
    ]);
  });

  it('gives twelve buckets for twelve whole months', () => {
    expect(
      bucketsBetween({ from: '2025-09-01', to: '2026-08-31' }, 'month'),
    ).toHaveLength(12);
  });
});

describe('fillBuckets', () => {
  it('fills every bucket, zero where nothing landed', () => {
    const filled = fillBuckets(
      { from: '2026-05-01', to: '2026-05-03' },
      'day',
      new Map([['2026-05-02', 7]]),
      () => 0,
    );
    expect(filled.map((b) => b.value)).toEqual([0, 7, 0]);
  });
});

describe('bucket expressions', () => {
  it('builds a ymd field into a UTC date from its parts — no zone involved', () => {
    const expr = ymdBucketExpr('soldDateYmd', 'day');
    expect(expr.$dateToString.format).toBe('%Y-%m-%d');
    expect(JSON.stringify(expr)).toContain('$dateFromParts');
    expect(JSON.stringify(expr)).not.toContain('timezone');
  });

  it('truncates a week to Monday and formats a month without the day', () => {
    expect(JSON.stringify(ymdBucketExpr('soldDateYmd', 'week'))).toContain(
      '"startOfWeek":"monday"',
    );
    expect(ymdBucketExpr('soldDateYmd', 'month').$dateToString.format).toBe(
      '%Y-%m',
    );
  });

  it('cuts instants on the agency calendar', () => {
    const expr = instantBucketExpr('openedAt', 'week', 'America/Chicago');
    expect(expr.$dateToString.timezone).toBe('America/Chicago');
    expect(JSON.stringify(expr)).toContain('"timezone":"America/Chicago"');
  });

  it('refuses to bucket an instant without a zone', () => {
    expect(() => instantBucketExpr('openedAt', 'day', '')).toThrow();
  });
});
