import { stringify } from 'csv-stringify/sync';
import * as XLSX from 'xlsx';

/**
 * Builds chargeback reports in memory for the parser's unit spec, the import
 * e2e and the Bruno fixture.
 *
 * The header is the first sample's (the agency's June 2026 "Chargebacks"
 * sheet, exported as CSV) — its columns in its order, with synthetic values:
 * no real customer is ever committed.
 */
export const SAMPLE_HEADER = [
  'Keep or Remove',
  'Customer',
  'Policy Type',
  'Carrier',
  'Producer',
  'Sold Date',
  'Premium',
  'Zip Code',
  'City',
  'Report Month',
  'Charge back (Y/N)',
  'Policy Number',
  'Prorated Amount',
  'Termination Reason',
  'Send to Smartsuite',
] as const;

export interface ReportLine {
  customer?: string;
  policyType?: string;
  carrier?: string;
  producer?: string;
  /** As the sheet prints it, e.g. `4/17/2026`. */
  soldDate?: string | number;
  premium?: string | number;
  policyNumber?: string | number;
  /** The chargeback amount, as the sheet prints it. */
  prorated?: string | number;
  reason?: string;
  /** Only written when the report is built `withSok`. */
  sok?: string;
}

/** The sample's header, plus a `SOK` column at the end when asked for. */
export function reportHeader({ withSok = false } = {}): string[] {
  return withSok ? [...SAMPLE_HEADER, 'SOK'] : [...SAMPLE_HEADER];
}

/** One line in the sample's column order. */
export function reportRow(
  line: ReportLine,
  { withSok = false } = {},
): unknown[] {
  const row: unknown[] = [
    'Keep',
    line.customer ?? 'Pat Example',
    line.policyType ?? 'Homeowners',
    line.carrier ?? 'Allstate',
    line.producer ?? '',
    line.soldDate ?? '4/17/2026',
    line.premium ?? 1999.81,
    '74008',
    'Bixby',
    'May',
    'Y',
    line.policyNumber ?? '',
    line.prorated ?? 1829.93,
    line.reason ?? 'Insured Request',
    '',
  ];
  if (withSok) row.push(line.sok ?? '');
  return row;
}

/** A report's rows: the header, then one row per line. */
export function reportRows(
  lines: ReportLine[],
  { withSok = false } = {},
): unknown[][] {
  return [
    reportHeader({ withSok }),
    ...lines.map((line) => reportRow(line, { withSok })),
  ];
}

/**
 * An .xlsx holding `rows` on one sheet. `scratchFirst` puts an unrelated
 * sheet before it, as a workbook somebody worked in would have.
 */
export function chargebackWorkbook(
  rows: unknown[][],
  { scratchFirst = false, sheetName = 'June Chargebacks' } = {},
): Buffer {
  const workbook = XLSX.utils.book_new();
  if (scratchFirst) {
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([['Notes'], ['Check Keep/Remove with David']]),
      'Scratch',
    );
  }
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(rows),
    sheetName,
  );
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/** The same rows as a CSV export. */
export function chargebackCsv(rows: unknown[][]): Buffer {
  return Buffer.from(
    stringify(rows.map((row) => row.map((cell) => cell ?? ''))),
    'utf8',
  );
}
