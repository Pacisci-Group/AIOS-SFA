import { readBigQueryConfig, tickerFromFileName } from './bigquery-rows';

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
