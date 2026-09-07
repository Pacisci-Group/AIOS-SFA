import { readFileSync } from 'fs';
import { join } from 'path';
import { parseZipMarketCsv } from './zip-markets.seed';

/**
 * The committed export, parsed.
 *
 * Asserted against the **real file** rather than a hand-written sample, because
 * both things this parser exists to catch are properties of that file: a
 * four-digit typo, and six ZIPs the sheet maps to two different markets. A
 * synthetic fixture would prove the regex works and nothing about the data.
 */
const CSV = readFileSync(join(__dirname, 'data', 'zip-markets.csv'), 'utf8');

describe('parseZipMarketCsv', () => {
  const result = parseZipMarketCsv(CSV);

  it('accepts 557 usable mappings and rejects 8 rows', () => {
    // The file holds 565 data rows. Six are contradictory repeats, one is a
    // four-digit typo and one names the market "Unknown" — see the docblock. If
    // a re-export changes these numbers, look at the rejections before changing
    // the assertion.
    expect(result.rows).toHaveLength(557);
    expect(result.rejected).toHaveLength(8);
  });

  it('rejects the placeholder "Unknown" market rather than storing it', () => {
    // Stored, it would count as a match — so the preview's unmatched-ZIP
    // resolver would never surface it and the transform would print the literal
    // string on every piece.
    expect(result.rejected).toContainEqual({
      zip: '73554',
      reason: 'market is literally "Unknown"',
    });
    expect(result.rows.some((r) => r.zip5 === '73554')).toBe(false);
  });

  it('rejects the four-digit typo rather than zero-padding it', () => {
    // `04031` is Freeport, Maine. A "helpful" pad would map it to Tulsa.
    const typo = result.rejected.find((r) => r.zip === '4031');
    expect(typo?.reason).toBe('not a 5-digit ZIP');
    expect(result.rows.some((r) => r.zip5 === '04031')).toBe(false);
  });

  it('keeps the correct 74031 that sits beside the typo', () => {
    expect(result.rows.find((r) => r.zip5 === '74031')?.market).toBe('Tulsa');
  });

  it('reports a ZIP mapped to two markets, naming both', () => {
    // The market decides which local-presence number is printed on the piece, so
    // this is a data question for whoever owns the sheet — reported, not absorbed.
    const conflict = result.rejected.find((r) => r.zip === '74062');
    expect(conflict?.reason).toBe(
      'conflicting market (kept "Tulsa", ignored "Oklahoma City")',
    );
  });

  it('resolves every conflict to the first occurrence, deterministically', () => {
    for (const zip of ['74062', '74834', '74850', '74855', '74864', '74880']) {
      expect(result.rows.filter((r) => r.zip5 === zip)).toHaveLength(1);
      expect(result.rows.find((r) => r.zip5 === zip)?.market).toBe('Tulsa');
    }
  });

  it('drops the header row', () => {
    expect(result.rows.some((r) => r.zip5 === 'zip')).toBe(false);
    expect(result.rejected.some((r) => r.zip === 'zip')).toBe(false);
  });

  it('carries the three real markets and nothing else', () => {
    expect(new Set(result.rows.map((r) => r.market))).toEqual(
      new Set(['Tulsa', 'Oklahoma City', '580 Group']),
    );
  });

  it('rejects a row with a ZIP but no market', () => {
    const { rows, rejected } = parseZipMarketCsv('zip,market\n74133,\n');
    expect(rows).toHaveLength(0);
    expect(rejected).toEqual([{ zip: '74133', reason: 'no market' }]);
  });
});
