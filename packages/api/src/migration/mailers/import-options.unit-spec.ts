import { parseBackfillOptions, parseFileAssignment } from './import-options';

const TABLE = 'Mailer_Test_Alteryx';
const parse = (...argv: string[]) => parseBackfillOptions(argv, TABLE);

describe('parseBackfillOptions', () => {
  it('defaults to a full, live upsert under the cutover run id', () => {
    expect(parse()).toMatchObject({
      dryRun: false,
      fresh: false,
      addOnly: false,
      linkLeads: false,
      batchSize: 1000,
      fileNames: [],
      runId: 'bigquery:Mailer_Test_Alteryx',
    });
  });

  it('reads a catch-up command', () => {
    const options = parse(
      '--dry-run',
      '--add-only',
      '--link-leads',
      '--run-id',
      'bigquery:catchup-2026-09',
      '--file',
      'April_P (3)',
      '--file',
      'Copy_oP',
      '--assign-file',
      'April_P (3)=SFA',
      '--assign-file',
      'Copy_oP=sfa',
      '--ingested-since',
      '2026-09-09T20:13:00Z',
      '--report',
      '../../temp/report.json',
    );

    expect(options).toMatchObject({
      dryRun: true,
      addOnly: true,
      linkLeads: true,
      runId: 'bigquery:catchup-2026-09',
      fileNames: ['April_P (3)', 'Copy_oP'],
      ingestedSince: '2026-09-09T20:13:00.000Z',
      reportPath: '../../temp/report.json',
    });
    expect([...options.assignments]).toEqual([
      ['April_P (3)', 'SFA'],
      ['Copy_oP', 'SFA'],
    ]);
  });

  it('refuses an unknown flag rather than ignoring it', () => {
    expect(() => parse('--add-onyl')).toThrow('Unknown argument: --add-onyl');
  });

  it('refuses a value flag with no value', () => {
    expect(() => parse('--file')).toThrow('--file needs a value.');
    expect(() => parse('--run-id', '--add-only')).toThrow(
      '--run-id needs a value.',
    );
  });

  it('refuses a single-valued flag given twice', () => {
    expect(() => parse('--run-id', 'a', '--run-id', 'b')).toThrow(
      /more than once/,
    );
  });

  it('requires an add-only run to carry its own run id', () => {
    // Rollback deletes by run id, so a shared one would delete the cutover.
    expect(() => parse('--add-only')).toThrow(/needs its own --run-id/);
    expect(() =>
      parse('--add-only', '--run-id', 'bigquery:Mailer_Test_Alteryx'),
    ).toThrow(/cutover run's id/);
  });

  it('refuses --fresh on anything but a full run', () => {
    expect(() => parse('--fresh', '--file', 'X')).toThrow(/--fresh/);
    expect(() => parse('--fresh', '--add-only', '--run-id', 'r')).toThrow(
      /--fresh/,
    );
  });

  it('refuses an assignment for a file the selection never reads', () => {
    expect(() => parse('--file', 'A', '--assign-file', 'B=SFA')).toThrow(
      /"B", but no --file selects it/,
    );
  });

  it('refuses one file assigned to two tickers', () => {
    expect(() =>
      parse('--assign-file', 'A=SFA', '--assign-file', 'A=LFI'),
    ).toThrow(/two tickers/);
  });

  it('refuses a time without a timezone', () => {
    expect(() => parse('--ingested-since', '2026-09-09T20:13:00')).toThrow(
      /timezone/,
    );
    expect(() => parse('--ingested-since', 'yesterdayZ')).toThrow(
      /not a valid date/,
    );
  });

  it('refuses a number that is not a positive integer', () => {
    expect(() => parse('--limit', 'ten')).toThrow(/--limit/);
    expect(() => parse('--batch-size', '0')).toThrow(/--batch-size/);
  });
});

describe('parseFileAssignment', () => {
  it('splits on the last equals sign and uppercases the ticker', () => {
    expect(parseFileAssignment(' 2025-QP = sfa ')).toEqual(['2025-QP', 'SFA']);
    expect(parseFileAssignment('a=b=SFA')).toEqual(['a=b', 'SFA']);
  });

  it('refuses anything that is not FileName=TICKER', () => {
    for (const raw of ['SFA', '=SFA', 'April_P (3)=', 'April_P (3)=S-F-A']) {
      expect(() => parseFileAssignment(raw)).toThrow(/--assign-file/);
    }
  });
});
