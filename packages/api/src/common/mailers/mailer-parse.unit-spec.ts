import {
  excelSerialToDate,
  parseInteger,
  parseMoney,
  parseSourceDate,
  parseText,
  parseWeekNumber,
  parseYesNo,
  splitZip,
} from './mailer-parse';

describe('parseMoney', () => {
  // Every literal below was taken off the reference file / BigQuery table.
  it.each([
    ['$1886.15/year*', 1886.15],
    ['$1,000.00/person', 1000],
    ['$100,000.00/occurrence', 100000],
    ['$899,675.00', 899675],
    ['157.18', 157.18],
    ['$1962.87/year*', 1962.87],
    ['2704.915', 2704.915],
  ])('parses %s', (input, expected) => {
    expect(parseMoney(input)).toBeCloseTo(expected, 3);
  });

  it('returns undefined rather than 0 for absent or unparseable input', () => {
    // The distinction matters: 0 is a real premium and would show a producer a
    // free policy. `migration/helpers/value-utils.ts#toNumber` returns 0 here,
    // which is exactly why it is not reused.
    expect(parseMoney('')).toBeUndefined();
    expect(parseMoney(null)).toBeUndefined();
    expect(parseMoney(undefined)).toBeUndefined();
    expect(parseMoney('n/a')).toBeUndefined();
    expect(parseMoney('$')).toBeUndefined();
    expect(parseMoney('-')).toBeUndefined();
  });

  it('never returns NaN', () => {
    for (const input of [
      '',
      'abc',
      '$',
      '.',
      '-',
      '/year',
      null,
      undefined,
      {},
    ]) {
      const result = parseMoney(input);
      expect(result === undefined || Number.isFinite(result)).toBe(true);
    }
  });

  it('passes finite numbers through and rejects non-finite ones', () => {
    expect(parseMoney(42.5)).toBe(42.5);
    expect(parseMoney(Number.NaN)).toBeUndefined();
    expect(parseMoney(Number.POSITIVE_INFINITY)).toBeUndefined();
  });
});

describe('parseSourceDate / excelSerialToDate', () => {
  it('converts the reference quotedate serial to 2026-07-13', () => {
    // 46216 under the 1899-12-30 epoch. Verified against that row's
    // mail_drop_date, and consistent with the file's week number (29).
    expect(parseSourceDate('46216')?.toISOString().slice(0, 10)).toBe(
      '2026-07-13',
    );
    expect(excelSerialToDate(46216)?.toISOString().slice(0, 10)).toBe(
      '2026-07-13',
    );
  });

  it('rejects implausible serials instead of returning a date in 1899', () => {
    // A stray 0 or a column that turned out to be a row counter must read as a
    // mapping bug, not as real data.
    expect(excelSerialToDate(0)).toBeUndefined();
    expect(excelSerialToDate(1)).toBeUndefined();
    expect(excelSerialToDate(20405)).toBeUndefined();
    expect(parseSourceDate('1')).toBeUndefined();
  });

  it('accepts the BigQuery shapes as well as the CSV one', () => {
    expect(parseSourceDate('2026-07-13')?.toISOString().slice(0, 10)).toBe(
      '2026-07-13',
    );
    expect(
      parseSourceDate({ value: '2026-07-13' })?.toISOString().slice(0, 10),
    ).toBe('2026-07-13');
    const date = new Date('2026-07-13T00:00:00.000Z');
    expect(parseSourceDate(date)).toBe(date);
  });

  it('returns undefined for empty and unparseable input', () => {
    expect(parseSourceDate('')).toBeUndefined();
    expect(parseSourceDate(null)).toBeUndefined();
    expect(parseSourceDate('not a date')).toBeUndefined();
    expect(parseSourceDate(new Date('nope'))).toBeUndefined();
  });
});

describe('parseInteger', () => {
  it('handles square footage with and without a thousands separator', () => {
    // `squarefeet` is '4195'; `filler` is '4,195' — a column named filler that
    // is not filler.
    expect(parseInteger('4195')).toBe(4195);
    expect(parseInteger('4,195')).toBe(4195);
  });

  it('returns undefined for empty input', () => {
    expect(parseInteger('')).toBeUndefined();
  });
});

describe('parseText', () => {
  it('preserves zero-padded FIPS county codes', () => {
    // Number('017') is 17, which destroys the padding legacy also mangled.
    expect(parseText('017')).toBe('017');
    expect(parseText(' 083 ')).toBe('083');
  });

  it('drops empty and whitespace-only values', () => {
    expect(parseText('')).toBeUndefined();
    expect(parseText('   ')).toBeUndefined();
    expect(parseText(null)).toBeUndefined();
  });
});

describe('parseYesNo', () => {
  it('reads the suppression flags', () => {
    expect(parseYesNo('Yes')).toBe(true);
    expect(parseYesNo('No')).toBe(false);
    expect(parseYesNo('')).toBe(false);
    expect(parseYesNo(true)).toBe(true);
  });
});

describe('parseWeekNumber', () => {
  it('derives the week from a Campaign Number', () => {
    // Every value in both sources is `Week_Number-NN` — a restatement of the
    // week number, not a campaign id.
    expect(parseWeekNumber('Week_Number-29')).toBe(29);
    expect(parseWeekNumber('Week_Number-7')).toBe(7);
  });

  it('returns undefined when there is no trailing number', () => {
    expect(parseWeekNumber('Week_Number-')).toBeUndefined();
    expect(parseWeekNumber('')).toBeUndefined();
  });
});

describe('splitZip', () => {
  it('splits ZIP+4', () => {
    expect(splitZip('74003-5807')).toEqual({
      zip: '74003-5807',
      zip5: '74003',
      zip4: '5807',
    });
  });

  it('tolerates a bare 5-digit zip', () => {
    expect(splitZip('74003')).toEqual({ zip: '74003', zip5: '74003' });
  });

  it('keeps an unrecognised value rather than discarding it', () => {
    expect(splitZip('K1A 0B1')).toEqual({ zip: 'K1A 0B1' });
  });
});
