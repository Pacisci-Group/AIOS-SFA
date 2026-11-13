import {
  dashLine,
  dashWorkbook,
  DASH_HEADER,
} from './__fixtures__/dash-workbook';
import {
  DashFileError,
  parseDashDate,
  parseDashWorkbook,
  reconciliationPolicyKey,
} from './dash-file-reader';

describe('parseDashWorkbook', () => {
  it('finds the report sheet behind a scratch sheet and reads the metadata rows', () => {
    const file = parseDashWorkbook(
      dashWorkbook({ lines: [dashLine({})], scratchFirst: true }),
    );
    expect(file.meta).toEqual({
      agentNumber: '0X1234',
      agentName: 'OWNER, OLIVE',
      downloadedBy: 'SOKOWNER',
      downloadedAt: '2026-10-12T03:39:31.000Z',
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      sheetName: 'New Business Details',
      headerRowNumber: 9,
    });
    expect(file.warnings).toEqual([]);
    expect(file.rows).toHaveLength(1);
    expect(file.rows[0].rowNumber).toBe(10);
  });

  it('reads every column through headers with stray spaces, first Channel winning', () => {
    const line = dashLine({
      sub: 34,
      bindId: 'sok5pe0t',
      policyNo: '2037692470',
      issued: 46267,
      written: '09/03/2026',
      premium: '$1,886.15',
      items: 2,
      channel: '1-800',
    });
    line[24] = 'Agency'; // the second `Channel` column disagrees
    const [row] = parseDashWorkbook(dashWorkbook({ lines: [line] })).rows;
    expect(row).toMatchObject({
      subProducerCode: '034',
      bindId: 'sok5pe0t',
      bindIdKey: 'SOK5PE0T',
      policyNumber: '2037692470',
      policyKey: '2037692470',
      issuedDate: '2026-09-02',
      dateWritten: '2026-09-03',
      writtenPremium: 1886.15,
      itemCount: 2,
      productDescription: 'Standard Auto',
      channel: '1-800',
    });
  });

  it('reads blank-looking cells and the "No Code" placeholder as null', () => {
    const [row] = parseDashWorkbook(
      dashWorkbook({
        lines: [
          dashLine({
            sub: '   ',
            subName: ' ',
            bindId: ' ',
            bindName: 'No Code',
          }),
        ],
      }),
    ).rows;
    expect(row).toMatchObject({
      subProducerCode: null,
      subProducerName: null,
      bindId: null,
      bindIdKey: null,
      bindIdName: null,
    });
  });

  it('skips empty and footnote lines', () => {
    const file = parseDashWorkbook(
      dashWorkbook({
        lines: [
          dashLine({}),
          [],
          ['', '', '', '* ID above for automated systems'],
        ],
      }),
    );
    expect(file.rows).toHaveLength(1);
  });

  it('reads past a completely blank row above the header', () => {
    const bytes = dashWorkbook({ lines: [dashLine({})], blankRowInMeta: true });
    const file = parseDashWorkbook(bytes);
    expect(file.meta.startDate).toBe('2026-09-01');
    expect(file.rows).toHaveLength(1);
  });

  it('warns, rather than fails, when the metadata rows are missing', () => {
    const file = parseDashWorkbook(
      dashWorkbook({ lines: [dashLine({})], meta: false }),
    );
    expect(file.meta.startDate).toBeNull();
    expect(file.warnings).toHaveLength(2);
  });

  it('refuses a workbook with no report sheet', () => {
    expect(() =>
      parseDashWorkbook(dashWorkbook({ lines: [], header: ['Name', 'Value'] })),
    ).toThrow(DashFileError);
  });

  it('names the required columns a report lacks', () => {
    const header = DASH_HEADER.filter((name) => name !== 'Written Premium');
    try {
      parseDashWorkbook(dashWorkbook({ lines: [], header }));
      fail('expected a DashFileError');
    } catch (error) {
      expect(error).toBeInstanceOf(DashFileError);
      expect((error as DashFileError).reason).toBe('missing_columns');
      expect((error as Error).message).toContain('Written Premium');
    }
  });

  it('refuses a file over the row cap', () => {
    const bytes = dashWorkbook({
      lines: [dashLine({}), dashLine({}), dashLine({})],
    });
    expect(() => parseDashWorkbook(bytes, { maxRows: 2 })).toThrow(
      /more than 2 lines/,
    );
  });
});

describe('parseDashDate', () => {
  const originalTz = process.env.TZ;
  beforeAll(() => {
    // East of UTC: where `new Date('09/15/2026')` reads back a day early.
    process.env.TZ = 'Asia/Karachi';
  });
  afterAll(() => {
    process.env.TZ = originalTz;
  });

  it.each([
    [46280, '2026-09-15'],
    ['09/15/2026', '2026-09-15'],
    ['9/5/2026', '2026-09-05'],
    ['2026-09-15', '2026-09-15'],
    ['46280', '2026-09-15'],
    [new Date(Date.UTC(2026, 8, 15)), '2026-09-15'],
  ])('reads %p as %s', (raw, expected) => {
    expect(parseDashDate(raw)).toBe(expected);
  });

  it.each([['02/31/2026'], [' '], ['soon'], [null], [12]])(
    'rejects %p',
    (raw) => {
      expect(parseDashDate(raw)).toBeNull();
    },
  );
});

// Bind ID and sub-producer keys are `@sfa/shared`'s `normalizeBindId` /
// `normalizeSubProducerCode`, tested in `allstate-codes.spec.ts`.
describe('keys', () => {
  it('drops a National General term suffix but not separators', () => {
    expect(reconciliationPolicyKey('2037692470-00')).toBe('2037692470');
    expect(reconciliationPolicyKey('2037614765 - 01')).toBe('2037614765');
    expect(reconciliationPolicyKey('875-933-180')).toBe('875933180');
    expect(reconciliationPolicyKey(' 879 100 129 ')).toBe('879100129');
    expect(reconciliationPolicyKey(879100129)).toBe('879100129');
    expect(reconciliationPolicyKey(null)).toBe('');
  });
});
