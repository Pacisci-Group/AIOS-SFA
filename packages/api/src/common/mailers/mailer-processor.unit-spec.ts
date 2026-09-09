import { readFileSync } from 'fs';
import { join } from 'path';
import { parse } from 'csv-parse/sync';
import {
  APPENDED_COLUMNS,
  DEFAULT_MAILER_DISCOUNTS,
  campaignNumberForDate,
  discountPremium,
  homeAgeDiscount,
  isoWeekNumber,
  normalizeCampaignNumber,
  processMailerFile,
  shortControlNumber,
  squareFootageDiscount,
  type MailerProcessorSettings,
} from './mailer-processor';

/**
 * Ground truth for the SFA Processor port.
 *
 * The committed fixture is the **output** of the real week-29 run — the file
 * that went to print. It carries every input column plus the eight the
 * transform appends, and the three it overwrites. So the input can be
 * reconstructed by subtraction, run through the port, and the result compared
 * column by column with what ApexReports/Alteryx actually produced. This is
 * the same validation discipline ApexReports itself uses (row counts and
 * dollars to the penny against known-good output), applied to our port of it.
 *
 * Nothing below is asserted against a literal that could be typed wrong: the
 * floor, the ZIP→market table, the phones and the expected values all come
 * out of the fixture at run time.
 */
const FIXTURE = join(
  __dirname,
  '../../../test/fixtures/mailers/rtp-sample.csv',
);

const RUN_YEAR = 2026; // quoteDate 2026-07-13 — the year the offers were priced in

type Fixture = {
  headers: string[];
  rows: string[][];
  col: (name: string) => number;
};

function loadFixture(): Fixture {
  const table = parse(readFileSync(FIXTURE, 'utf8'), {
    columns: false,
    relax_column_count: false,
  }) as string[][];
  const [headers, ...rows] = table;
  return { headers, rows, col: (name) => headers.indexOf(name) };
}

/**
 * The vendor file, by subtraction: drop the appended columns, and blank the
 * three the transform overwrites. `yearlyprem` is restored from `totalpremi`
 * because that is what the vendor puts in both — see the module note on
 * `mailer-processor.ts`; this test is the proof of that claim.
 */
function reconstructInput(fx: Fixture): {
  headers: string[];
  rows: string[][];
} {
  const appended = new Set<string>(APPENDED_COLUMNS);
  const keep = fx.headers
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => !appended.has(h));
  const headers = keep.map(({ h }) => h);
  const rows = fx.rows.map((row) => {
    const out = keep.map(({ i }) => row[i]);
    out[headers.indexOf('yearlyprem')] = row[fx.col('totalpremi')];
    out[headers.indexOf('monthlypre')] = '';
    out[headers.indexOf('agencyphon')] = '';
    return out;
  });
  return { headers, rows };
}

/** What the week-29 run was configured with, read back off its own output. */
function settingsFromFixture(fx: Fixture): MailerProcessorSettings {
  const zipMarkets: Record<string, string> = {};
  const marketPhones: Record<string, string> = {};
  for (const row of fx.rows) {
    zipMarkets[row[fx.col('zip1')]] = row[fx.col('Right_Name')];
    marketPhones[row[fx.col('Right_Name')]] = row[fx.col('agencyphon')];
  }
  // Every floored row sits exactly at the floor and no un-floored row can be
  // below it, so the smallest offer in the file *is* the floor.
  const premiumFloor = Math.min(
    ...fx.rows.map((row) => Number(row[fx.col('New Yearly Premium 2')])),
  );
  // Apex's fallbacks are the OKC market and its phone; the fixture agrees.
  const defaultMarket = 'Oklahoma City';
  const { [defaultMarket]: defaultPhone, ...otherPhones } = marketPhones;
  return {
    campaignNumber: fx.rows[0][fx.col('Campaign Number')],
    fileName: fx.rows[0][fx.col('FileName')],
    premiumFloor,
    zipMarkets,
    defaultMarket,
    marketPhones: otherPhones,
    defaultPhone,
    runYear: RUN_YEAR,
  };
}

describe('processMailerFile against the week-29 output', () => {
  const fx = loadFixture();
  const input = reconstructInput(fx);
  const settings = settingsFromFixture(fx);
  const result = processMailerFile(input.headers, input.rows, settings);
  const out = (name: string) => result.headers.indexOf(name);

  const controlAt = fx.col('controlno');
  const realRows = fx.rows.filter((row) => row[controlAt]);
  const byControl = new Map(
    result.rows.map((row) => [String(row[out('controlno')]), row]),
  );

  it('reads a floor off the fixture that is not the app default', () => {
    // Apex's form default today is 1916.44. The run that printed this file
    // used something else, which is exactly why the floor must be a
    // per-campaign setting and not a constant.
    expect(settings.premiumFloor).toBeCloseTo(1886.15, 2);
  });

  it('emits the exact header set and order of the real output', () => {
    expect(result.headers).toEqual(fx.headers);
  });

  it('keeps every row — the vendor file has no duplicates', () => {
    expect(result.stats.inputRows).toBe(fx.rows.length);
    expect(result.stats.outputRows).toBe(fx.rows.length);
    expect(result.stats.duplicatesRemoved).toBe(0);
  });

  it.each([
    'zip1',
    'zip2',
    'Zip Codes',
    'Right_Name',
    'agencyphon',
    'FileName',
    'New Control Number',
    'Campaign Number',
    'yearlyprem',
    'monthlypre',
  ])('reproduces %s on every row', (column) => {
    for (const expected of realRows) {
      const actual = byControl.get(expected[controlAt]);
      expect(actual).toBeDefined();
      expect(String(actual![out(column)])).toBe(expected[fx.col(column)]);
    }
  });

  it('reproduces New Yearly Premium 2 to the cent on every row', () => {
    // Four fixture rows carry the unrounded float (1973.4413999999997); the
    // printed `yearlyprem` is the rounded one. Both are asserted: this one to
    // the cent, the string above exactly.
    for (const expected of realRows) {
      const actual = byControl.get(expected[controlAt])!;
      expect(actual[out('New Yearly Premium 2')] as number).toBeCloseTo(
        Number(expected[fx.col('New Yearly Premium 2')]),
        2,
      );
    }
  });

  it('raises most offers to the floor', () => {
    // Over every row, synthetic one included: it has no control number but it
    // still has a home to price.
    const atFloor = fx.rows.filter(
      (row) =>
        Math.abs(
          Number(row[fx.col('New Yearly Premium 2')]) - settings.premiumFloor,
        ) < 0.005,
    ).length;
    expect(result.stats.floorRaised).toBe(atFloor);
    // The finding worth keeping in front of the product owner: the discount
    // table decides the offer for a small minority of homes.
    expect(atFloor / fx.rows.length).toBeGreaterThan(0.9);
  });

  it('matches every ZIP the table knows', () => {
    expect(result.stats.zipUnmatched).toBe(0);
    expect(result.unmatchedZips).toEqual({});
    expect(result.stats.zipMatched + result.stats.zipEmpty).toBe(
      fx.rows.length,
    );
  });

  it('orders by postal sequence and renumbers recordid from 1', () => {
    const seqs = result.rows.map((row) => Number(row[out('pst_seq')]));
    const sorted = [...seqs].sort((a, b) => a - b);
    expect(seqs).toEqual(sorted);
    expect(result.rows.map((row) => row[out('recordid')])).toEqual(
      result.rows.map((_, i) => i + 1),
    );
  });

  it('leaves the synthetic control-number-less row with an empty short form', () => {
    const synthetic = result.rows.find((row) => !row[out('controlno')]);
    expect(synthetic).toBeDefined();
    expect(synthetic![out('New Control Number')]).toBe('');
  });

  it('reports the premium spread Apex shows on its run card', () => {
    expect(result.stats.premium).not.toBeNull();
    expect(result.stats.premium!.count).toBe(fx.rows.length);
    expect(result.stats.premium!.min).toBeCloseTo(settings.premiumFloor, 2);
  });
});

describe('processMailerFile with an unmapped ZIP', () => {
  const fx = loadFixture();
  const input = reconstructInput(fx);
  const settings = settingsFromFixture(fx);
  const victimZip = fx.rows[0][fx.col('zip1')];
  const zipMarkets = { ...settings.zipMarkets };
  delete zipMarkets[victimZip];
  const result = processMailerFile(input.headers, input.rows, {
    ...settings,
    zipMarkets,
  });
  const out = (name: string) => result.headers.indexOf(name);

  it('counts the ZIP and the rows it affects', () => {
    const affected = fx.rows.filter(
      (row) => row[fx.col('zip1')] === victimZip,
    ).length;
    expect(result.unmatchedZips).toEqual({ [victimZip]: affected });
    expect(result.stats.zipUnmatched).toBe(affected);
  });

  it('falls back to the default market and its phone rather than dropping the row', () => {
    const rows = result.rows.filter((row) => row[out('zip1')] === victimZip);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row[out('Right_Name')]).toBe(settings.defaultMarket);
      expect(row[out('agencyphon')]).toBe(settings.defaultPhone);
    }
  });
});

describe('squareFootageDiscount', () => {
  it.each([
    [999, 0],
    [1000, 0.29],
    [1499, 0.29],
    [1500, 0.32],
    [1999, 0.32],
    [2000, 0.36],
    [2499, 0.36],
    [2500, 0.44],
    [4744, 0.44],
    [0, 0],
  ])('%d sq ft → %d', (squareFeet, expected) => {
    expect(squareFootageDiscount(squareFeet)).toBe(expected);
  });
});

describe('homeAgeDiscount', () => {
  it('gives 4% to a home nine years old or newer, 10% otherwise', () => {
    expect(homeAgeDiscount(2017, 2026)).toBe(0.04);
    expect(homeAgeDiscount(2016, 2026)).toBe(0.1);
    expect(homeAgeDiscount(2026, 2026)).toBe(0.04);
  });

  it('depends on the run year — re-pricing a past campaign must pass it', () => {
    expect(homeAgeDiscount(2017, 2026)).toBe(0.04);
    expect(homeAgeDiscount(2017, 2027)).toBe(0.1);
  });

  it('treats a missing year as an old home, as the mailed offers did', () => {
    expect(homeAgeDiscount(0, 2026)).toBe(0.1);
  });
});

describe('discountPremium', () => {
  it('adds the two discounts rather than compounding them', () => {
    // 2,464 sq ft, built 1974: 36% + 10% = 54% off $1,920.24 → $883.31
    const { premium, discount, floored } = discountPremium(
      1920.24,
      2464,
      1974,
      2026,
      0,
    );
    expect(discount).toBeCloseTo(0.46, 10);
    expect(premium).toBeCloseTo(1920.24 * 0.54, 6);
    expect(floored).toBe(false);
  });

  it('raises a discounted premium below the floor to the floor', () => {
    const { premium, floored } = discountPremium(
      1920.24,
      2464,
      1974,
      2026,
      1886.15,
    );
    expect(premium).toBe(1886.15);
    expect(floored).toBe(true);
  });

  it('leaves a premium at or above the floor alone', () => {
    // 1,256 sq ft, built 2025, $9,000 → 29% + 4% off = $6,030
    const { premium, floored } = discountPremium(
      9000,
      1256,
      2025,
      2026,
      1886.15,
    );
    expect(premium).toBeCloseTo(6030, 6);
    expect(floored).toBe(false);
  });
});

describe('per-campaign discount rules', () => {
  it('defaults to the table every run so far has used', () => {
    expect(squareFootageDiscount(2500)).toBe(
      squareFootageDiscount(2500, DEFAULT_MAILER_DISCOUNTS.squareFootage),
    );
    expect(homeAgeDiscount(2017, 2026)).toBe(
      homeAgeDiscount(2017, 2026, DEFAULT_MAILER_DISCOUNTS.homeAge),
    );
  });

  it("applies a campaign's own bands, whatever order they are given in", () => {
    const bands = [
      { minSquareFeet: 1000, rate: 0.1 },
      { minSquareFeet: 3000, rate: 0.5 },
    ];
    expect(squareFootageDiscount(999, bands)).toBe(0);
    expect(squareFootageDiscount(1000, bands)).toBe(0.1);
    expect(squareFootageDiscount(2999, bands)).toBe(0.1);
    expect(squareFootageDiscount(3000, bands)).toBe(0.5);
  });

  it("applies a campaign's own age rule", () => {
    const rule = { maxNewYears: 20, newRate: 0.02, oldRate: 0.2 };
    expect(homeAgeDiscount(2006, 2026, rule)).toBe(0.02);
    expect(homeAgeDiscount(2005, 2026, rule)).toBe(0.2);
  });

  it("prices a file with the campaign's rules, not the defaults", () => {
    const fx = loadFixture();
    const input = reconstructInput(fx);
    const settings = settingsFromFixture(fx);
    const noDiscount = processMailerFile(input.headers, input.rows, {
      ...settings,
      premiumFloor: 0,
      discounts: {
        squareFootage: [],
        homeAge: { maxNewYears: 0, newRate: 0, oldRate: 0 },
      },
    });
    const out = (name: string) => noDiscount.headers.indexOf(name);
    // With no discount and no floor the offer is the quote itself.
    for (const row of noDiscount.rows) {
      const quote = Number(
        String(row[out('totalpremi')]).replace(/[^\d.]/g, ''),
      );
      expect(row[out('New Yearly Premium 2')] as number).toBeCloseTo(quote, 6);
    }
    expect(noDiscount.stats.floorRaised).toBe(0);
  });
});

describe('normalizeCampaignNumber', () => {
  it.each([
    ['29', 'Week_Number-29'],
    ['week 29', 'Week_Number-29'],
    ['Week-Number 29', 'Week_Number-29'],
    ['week_number-29', 'Week_Number-29'],
    ['WEEK_NUMBER:29', 'Week_Number-29'],
    ['Week_Number-29', 'Week_Number-29'],
    ['  Week_Number-29  ', 'Week_Number-29'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeCampaignNumber(input)).toBe(expected);
  });

  it('passes anything that is not a week number through, trimmed', () => {
    expect(normalizeCampaignNumber(' Spring-Home-2026 ')).toBe(
      'Spring-Home-2026',
    );
    expect(normalizeCampaignNumber('')).toBe('');
    expect(normalizeCampaignNumber('   ')).toBe('');
  });
});

describe('campaign week', () => {
  it('uses ISO weeks — the comment in Apex pins 2026-06-14 to week 24', () => {
    expect(isoWeekNumber(new Date(2026, 5, 14))).toBe(24);
    expect(campaignNumberForDate(new Date(2026, 5, 14))).toBe('Week_Number-24');
  });

  it('puts the fixture quote date, 2026-07-13, in week 29', () => {
    expect(campaignNumberForDate(new Date(2026, 6, 13))).toBe('Week_Number-29');
  });
});

describe('shortControlNumber', () => {
  it('is the last twelve characters of controlno', () => {
    expect(shortControlNumber('#3fd0c7f6-0d5d-4a9d-a7b2-1f1f8672b2e1')).toBe(
      '1f1f8672b2e1',
    );
  });

  it('is empty for a missing control number', () => {
    expect(shortControlNumber('')).toBe('');
    expect(shortControlNumber(null)).toBe('');
    expect(shortControlNumber(undefined)).toBe('');
  });
});
