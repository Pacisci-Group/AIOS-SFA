import {
  chargebackCsv,
  chargebackWorkbook,
  reportRows,
  SAMPLE_HEADER,
} from './__fixtures__/chargeback-workbook';
import {
  ChargebackFileError,
  parseChargebackFile,
} from './chargeback-file-reader';

function refusal(read: () => unknown): ChargebackFileError {
  try {
    read();
  } catch (error) {
    if (error instanceof ChargebackFileError) return error;
    throw error;
  }
  throw new Error('expected a ChargebackFileError');
}

describe('parseChargebackFile', () => {
  const lines = [
    {
      customer: 'Pat Example',
      producer: 'Jessica Yates',
      policyNumber: 885671703,
      premium: 1999.81,
      prorated: 1829.93,
      soldDate: '4/17/2026',
      reason: 'Property - Property Sold - Other',
    },
    {
      customer: 'Sam Sample',
      policyType: 'Auto Private Passenger Voluntary',
      producer: 'Shawna Adams',
      policyNumber: '954157598',
      premium: 303.85,
      prorated: 303.85,
      soldDate: '3/10/2026',
      reason: 'Duplicate Coverage',
    },
  ];

  it.each([
    ['xlsx', () => chargebackWorkbook(reportRows(lines))],
    ['csv', () => chargebackCsv(reportRows(lines))],
  ] as const)('reads the sample layout (%s)', (format, build) => {
    const file = parseChargebackFile(build(), { format });
    expect(file.headerRowNumber).toBe(1);
    expect(file.rows).toEqual([
      {
        rowNumber: 2,
        bindId: null,
        producerName: 'Jessica Yates',
        policyNumber: '885671703',
        customerName: 'Pat Example',
        policyType: 'Homeowners',
        carrier: 'Allstate',
        soldDay: '2026-04-17',
        occurredDay: null,
        terminationReason: 'Property - Property Sold - Other',
        amount: 1829.93,
        oppositeSign: false,
      },
      expect.objectContaining({
        rowNumber: 3,
        producerName: 'Shawna Adams',
        policyNumber: '954157598',
        policyType: 'Auto Private Passenger Voluntary',
        soldDay: '2026-03-10',
        amount: 303.85,
      }),
    ]);
    expect(file.columns).toEqual(
      expect.arrayContaining([
        { field: 'amount', header: 'Prorated Amount' },
        { field: 'policyNumber', header: 'Policy Number' },
        { field: 'producerName', header: 'Producer' },
      ]),
    );
    // Premium is never the amount, and the working columns are not read.
    expect(file.columns.map((column) => column.header)).not.toEqual(
      expect.arrayContaining(['Premium', 'Keep or Remove', 'Report Month']),
    );
    expect(file.warnings).toEqual([]);
  });

  it.each([
    ['($123.45)', 123.45],
    ['-123.45', 123.45],
    ['$123.45', 123.45],
    ['$1,234.50', 1234.5],
    ['-$5', 5],
  ])('reads %s as %d (csv)', (printed, amount) => {
    const file = parseChargebackFile(
      chargebackCsv(reportRows([{ policyNumber: 'P1', prorated: printed }])),
      { format: 'csv' },
    );
    expect(file.rows[0].amount).toBe(amount);
  });

  it('reads negative and bracketed amounts from a workbook as positive', () => {
    const file = parseChargebackFile(
      chargebackWorkbook(
        reportRows([
          { policyNumber: 'P1', prorated: -123.45 },
          { policyNumber: 'P2', prorated: '($123.45)' },
        ]),
      ),
      { format: 'xlsx' },
    );
    expect(file.rows.map((row) => row.amount)).toEqual([123.45, 123.45]);
  });

  it('reads a report printed all in brackets or minus signs as chargebacks', () => {
    const file = parseChargebackFile(
      chargebackCsv(
        reportRows([
          { policyNumber: 'P1', prorated: '($10.00)' },
          { policyNumber: 'P2', prorated: '-20' },
        ]),
      ),
      { format: 'csv' },
    );
    expect(file.rows.map((row) => row.oppositeSign)).toEqual([false, false]);
    expect(file.warnings).toEqual([]);
  });

  it('flags lines whose sign differs from the rest as reversals', () => {
    const file = parseChargebackFile(
      chargebackCsv(
        reportRows([
          { policyNumber: 'P1', prorated: '100.00' },
          { policyNumber: 'P2', prorated: '($75.50)' },
          { policyNumber: 'P3', prorated: '40' },
          { policyNumber: 'P4', prorated: '-75.50' },
          { policyNumber: 'P5', prorated: '$60' },
        ]),
      ),
      { format: 'csv' },
    );
    expect(
      file.rows.map((row) => [row.policyNumber, row.amount, row.oppositeSign]),
    ).toEqual([
      ['P1', 100, false],
      ['P2', 75.5, true],
      ['P3', 40, false],
      ['P4', 75.5, true],
      ['P5', 60, false],
    ]);
    expect(file.warnings).toEqual([
      '2 lines have the opposite sign to the rest (rows 3 and 5) — read as reversals and left out. Charge one only if it really is a chargeback.',
    ]);
  });

  it('takes the negatives as the reversals on a tie', () => {
    const file = parseChargebackFile(
      chargebackCsv(
        reportRows([
          { policyNumber: 'P1', prorated: '10' },
          { policyNumber: 'P2', prorated: '-10' },
        ]),
      ),
      { format: 'csv' },
    );
    expect(file.rows.map((row) => row.oppositeSign)).toEqual([false, true]);
  });

  it('does not read a producer code or an agent id as the SOK number', () => {
    const file = parseChargebackFile(
      chargebackCsv([
        ['Policy Number', 'Prorated Amount', 'Producer Code', 'Agent ID'],
        ['P1', '10', '034', 'A1B2'],
      ]),
      { format: 'csv' },
    );
    expect(file.rows[0].bindId).toBeNull();
    expect(file.columns.map((column) => column.field)).toEqual([
      'policyNumber',
      'amount',
    ]);
  });

  it('reads the SOK number when the report has one, normalised', () => {
    const file = parseChargebackFile(
      chargebackWorkbook(
        reportRows([{ policyNumber: 'P1', sok: ' sokdemop ' }], {
          withSok: true,
        }),
      ),
      { format: 'xlsx' },
    );
    expect(file.rows[0].bindId).toBe('SOKDEMOP');
  });

  it('finds a header below a title, on a sheet after a scratch one', () => {
    const rows = [
      ['June Chargebacks'],
      [],
      ...reportRows([{ policyNumber: 'P1' }]),
    ];
    const file = parseChargebackFile(
      chargebackWorkbook(rows, { scratchFirst: true }),
      { format: 'xlsx' },
    );
    expect(file.sheetName).toBe('June Chargebacks');
    expect(file.headerRowNumber).toBe(3);
    expect(file.rows[0].rowNumber).toBe(4);
  });

  it('matches headers loosely and prefers the chargeback amount', () => {
    const rows = [
      ['POLICY_NO', 'Amount', 'Chargeback Amount', 'sok #', 'Cancel Date'],
      ['A-1', 999, '50.00', 'x1', '10/02/2026'],
    ];
    const file = parseChargebackFile(chargebackCsv(rows), { format: 'csv' });
    expect(file.rows[0]).toMatchObject({
      policyNumber: 'A-1',
      amount: 50,
      bindId: 'X1',
      occurredDay: '2026-10-02',
    });
  });

  it('reads a date stored as a spreadsheet date', () => {
    const file = parseChargebackFile(
      chargebackWorkbook([
        ['Policy Number', 'Chargeback', 'Sold Date'],
        ['P1', 10, 46129],
      ]),
      { format: 'xlsx' },
    );
    expect(file.rows[0].soldDay).toBe('2026-04-17');
  });

  it('leaves out lines with no amount and totals with no policy number, and says so', () => {
    const rows = [
      ...reportRows([
        { policyNumber: 'P1', prorated: 10 },
        { policyNumber: 'P2', prorated: '' },
        { policyNumber: 'P3', prorated: 0 },
      ]),
      ['', '', '', '', '', '', '', '', '', '', '', '', '2,500.00'],
      [],
    ];
    const file = parseChargebackFile(chargebackCsv(rows), { format: 'csv' });
    expect(file.rows.map((row) => row.policyNumber)).toEqual(['P1']);
    expect(file.warnings).toEqual([
      '2 lines with no amount were left out (rows 3 and 4).',
      '1 line with an amount but no policy number was left out (row 5) — a total line?',
    ]);
  });

  it('warns when the report names nobody to charge', () => {
    const file = parseChargebackFile(
      chargebackCsv([
        ['Policy Number', 'Prorated Amount'],
        ['P1', '10'],
      ]),
      { format: 'csv' },
    );
    expect(file.warnings).toEqual([
      expect.stringMatching(/charged to whoever sold the policy/),
    ]);
  });

  it('names a missing amount column', () => {
    const error = refusal(() =>
      parseChargebackFile(
        chargebackCsv([
          ['Customer', 'Policy Number', 'Premium'],
          ['Pat', 'P1', '100'],
        ]),
        { format: 'csv' },
      ),
    );
    expect(error.reason).toBe('missing_columns');
    expect(error.message).toBe(
      'The report is missing a column: Prorated Amount (or Chargeback Amount).',
    );
  });

  it('names a missing policy-number column', () => {
    const header = SAMPLE_HEADER.filter((name) => name !== 'Policy Number');
    const error = refusal(() =>
      parseChargebackFile(chargebackWorkbook([header, header.map(() => 'x')]), {
        format: 'xlsx',
      }),
    );
    expect(error.reason).toBe('missing_columns');
    expect(error.message).toBe(
      'The report is missing a column: Policy Number.',
    );
  });

  it('refuses a sheet with no header row', () => {
    const error = refusal(() =>
      parseChargebackFile(
        chargebackCsv([
          ['Notes for June'],
          ['Ask David about the Keep/Remove column'],
        ]),
        { format: 'csv' },
      ),
    );
    expect(error.reason).toBe('no_header');
  });

  it('refuses an empty sheet', () => {
    const error = refusal(() =>
      parseChargebackFile(chargebackWorkbook([]), { format: 'xlsx' }),
    );
    expect(error.reason).toBe('no_rows');
    expect(error.message).toBe('The file is empty.');
  });

  it('refuses a header with nothing under it', () => {
    const error = refusal(() =>
      parseChargebackFile(chargebackCsv(reportRows([])), { format: 'csv' }),
    );
    expect(error.reason).toBe('no_rows');
  });

  it('refuses more lines than the cap', () => {
    const error = refusal(() =>
      parseChargebackFile(
        chargebackCsv(
          reportRows([
            { policyNumber: 'P1' },
            { policyNumber: 'P2' },
            { policyNumber: 'P3' },
          ]),
        ),
        { format: 'csv', maxRows: 2 },
      ),
    );
    expect(error.reason).toBe('too_many_rows');
    expect(error.message).toMatch(/more than 2 chargebacks/);
  });

  it('refuses bytes that are not a spreadsheet', () => {
    const error = refusal(() =>
      parseChargebackFile(Buffer.from('%PDF-1.7 not a sheet'), {
        format: 'xlsx',
      }),
    );
    expect(['unreadable', 'no_header']).toContain(error.reason);
  });
});
