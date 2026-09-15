import {
  buildMailerRowQuery,
  campaignYear,
  readBigQueryConfig,
  resolveRowTicker,
  tickerFromFileName,
} from './bigquery-rows';

describe('tickerFromFileName', () => {
  it('takes the leading letters of the pipeline FileName', () => {
    expect(tickerFromFileName('SFA-20P')).toBe('SFA');
    expect(tickerFromFileName('LFI-14Q')).toBe('LFI');
    expect(tickerFromFileName('  sfa-20p ')).toBe('SFA');
  });

  it('returns null rather than guessing when there is nothing to read', () => {
    // A null here means the row is skipped and counted. Filing one agency's
    // prospects under another is worse than leaving them out.
    expect(tickerFromFileName('')).toBeNull();
    expect(tickerFromFileName('20P-SFA')).toBeNull();
    expect(tickerFromFileName(null)).toBeNull();
    expect(tickerFromFileName(42)).toBeNull();
  });
});

describe('resolveRowTicker', () => {
  const assignments = new Map([
    ['April_P (3)', 'SFA'],
    ['2025-QP', 'SFA'],
  ]);

  it('prefers an assignment for the exact FileName', () => {
    expect(resolveRowTicker('April_P (3)', assignments)).toBe('SFA');
    expect(resolveRowTicker(' April_P (3) ', assignments)).toBe('SFA');
    // The digit prefix yields no ticker at all without the assignment.
    expect(resolveRowTicker('2025-QP', assignments)).toBe('SFA');
  });

  it('never widens an assignment into a prefix match', () => {
    expect(resolveRowTicker('April_P (1)', assignments)).toBe('APRIL');
    expect(resolveRowTicker('2025-QP (2)', assignments)).toBeNull();
  });

  it('falls back to the leading letters for everything else', () => {
    expect(resolveRowTicker('SFA-QBP-2026-32', assignments)).toBe('SFA');
    expect(resolveRowTicker(undefined, assignments)).toBeNull();
  });
});

describe('campaignYear', () => {
  it('reads an Excel serial that arrives as a string as a date, not a year', () => {
    // BigQuery ships `quotedate` as STRING, and `new Date('46123')` is the
    // year 46122. The cutover run filed 18 campaigns under years like that.
    expect(campaignYear('46123')).toBe(2026);
    expect(campaignYear(46123)).toBe(2026);
  });

  it('reads a date string', () => {
    expect(campaignYear('11/21/2025')).toBe(2025);
  });

  it('returns null rather than inventing a year', () => {
    expect(campaignYear('')).toBeNull();
    expect(campaignYear(undefined)).toBeNull();
    expect(campaignYear('not a date')).toBeNull();
  });
});

describe('buildMailerRowQuery', () => {
  const config = { projectId: 'p', datasetId: 'd', tableId: 't' };

  it('reads the whole table, oldest first, when nothing is selected', () => {
    expect(buildMailerRowQuery(config)).toEqual({
      query: 'SELECT * FROM `p.d.t` ORDER BY last_updated ASC',
    });
  });

  it('selects named files and recent uploads together, through parameters', () => {
    const { query, params } = buildMailerRowQuery(config, {
      fileNames: ['April_P (3)', "O'Brien"],
      ingestedSince: '2026-09-09T20:13:00.000Z',
    });

    expect(query).toBe(
      'SELECT * FROM `p.d.t` WHERE TRIM(FileName) IN UNNEST(@fileNames) ' +
        'OR ingest_uploaded_at >= TIMESTAMP(@ingestedSince) ' +
        'ORDER BY last_updated ASC',
    );
    // Never interpolated: a quote in a file name must not reach the SQL.
    expect(query).not.toContain('Brien');
    expect(params).toEqual({
      fileNames: ['April_P (3)', "O'Brien"],
      ingestedSince: '2026-09-09 20:13:00.000+00',
    });
  });

  it('puts the newest row first when asked, and honours a limit', () => {
    // An add-only run keeps the first row it sees for a control number.
    expect(
      buildMailerRowQuery(config, {
        fileNames: ['x'],
        newestFirst: true,
        limit: 500.7,
      }).query,
    ).toBe(
      'SELECT * FROM `p.d.t` WHERE TRIM(FileName) IN UNNEST(@fileNames) ' +
        'ORDER BY last_updated DESC LIMIT 500',
    );
  });
});

describe('readBigQueryConfig', () => {
  const valid = {
    BQ_PROJECT_ID: 'allstate123',
    BQ_DATASET_ID: 'smartsuite_data',
    GOOGLE_APPLICATION_CREDENTIALS_JSON: '{"type":"service_account"}',
  };

  it('defaults to the base table, not a view', () => {
    // `_Parallel` exists so users would not touch the base table; legacy
    // pointed at it for that reason, not because it was canonical.
    expect(readBigQueryConfig(valid).tableId).toBe('Mailer_Test_Alteryx');
  });

  it('honours an explicit table id', () => {
    expect(
      readBigQueryConfig({ ...valid, BQ_MAILERS_TABLE_ID: 'Other' }).tableId,
    ).toBe('Other');
  });

  it('names the missing variable rather than failing deep in the SDK', () => {
    expect(() => readBigQueryConfig({ ...valid, BQ_PROJECT_ID: '' })).toThrow(
      /BQ_PROJECT_ID/,
    );
    expect(() =>
      readBigQueryConfig({ ...valid, GOOGLE_APPLICATION_CREDENTIALS_JSON: '' }),
    ).toThrow(/GOOGLE_APPLICATION_CREDENTIALS_JSON/);
  });

  it('rejects credentials that are not JSON, with a usable message', () => {
    expect(() =>
      readBigQueryConfig({
        ...valid,
        GOOGLE_APPLICATION_CREDENTIALS_JSON: '/path/to/key.json',
      }),
    ).toThrow(/not valid JSON/);
  });
});
