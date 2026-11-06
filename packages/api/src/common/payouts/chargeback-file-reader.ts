import { parse as parseCsv } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import { normalizeBindId, type ChargebackFileErrorReason } from '@sfa/shared';
import { parseDashDate } from '../carrier-reconciliation/dash-file-reader';
import { normalizeHeader } from '../mailers/mailer-row.mapper';
import { parseMoney, parseText } from '../mailers/mailer-parse';
import { cellToPrimitive } from '../mailers/vendor-file-reader';

/**
 * Reads the monthly chargeback report (PAC-180) — bytes in, lines out.
 *
 * The report is the agency's list of **approved** chargebacks for a month: one
 * line per policy, the customer, who sold it, and the amount to take back. The
 * first sample (June 2026) is a CSV export of the agency's own sheet:
 *
 * ```
 * Keep or Remove, Customer, Policy Type, Carrier, Producer, Sold Date, Premium,
 * Zip Code, City, Report Month, Charge back (Y/N), Policy Number,
 * Prorated Amount, Termination Reason, Send to Smartsuite
 * ```
 *
 * The amount is **Prorated Amount** — the carrier's prorated premium, not
 * `Premium` (owner, 5 Nov 2026). Every line is an approved chargeback, so the
 * sheet's working columns (Keep or Remove, Charge back Y/N, Report Month, Send
 * to Smartsuite) are not read. That sample has no SOK number; a carrier's own
 * report may, so the SOK column is read when present.
 *
 * An amount is read as positive whatever its sign or brackets — a report may
 * print its chargebacks either way. But when a report **mixes** signs, the
 * lines with the less common sign are reversals of earlier charges, not
 * chargebacks, and are flagged (`oppositeSign`) so they are never charged by
 * accident.
 *
 * Columns are found by name, never by position: the header is the first row
 * — on any sheet, within the first {@link HEADER_SEARCH_ROWS} — that has a
 * policy-number column and an amount column. Names are compared through
 * `normalizeHeader` (lower-case, letters and digits only), so `Policy #`,
 * `policy number` and `POLICY_NUMBER` are one name.
 *
 * Pure: no database, no clock. The service matches the lines to people and
 * policies (`match-import-rows.ts`).
 */

/**
 * Header names per field, **in order of preference**: a field takes the
 * first of its names the header has. That is what keeps `Premium` from ever
 * being read as the amount (it is not listed), and `Prorated Amount` ahead of
 * a plain `Amount`. Adjust this table when a new report layout arrives — the
 * sample's own header names come first.
 */
export const CHARGEBACK_COLUMN_ALIASES = {
  policyNumber: ['Policy Number', 'Policy #', 'Policy No', 'Policy'],
  amount: [
    'Prorated Amount',
    'Prorated',
    'Chargeback Amount',
    'Chargeback Amt',
    'Charge Back Amount',
    'Chargeback',
    'Amount',
  ],
  bindId: [
    'SOK',
    'SOK Number',
    'SOK #',
    'SOK ID',
    'Bind ID',
    // Not "Producer Code" or "Agent ID": a sub-producer code or an agent
    // number is not the Bind ID, and a SOK match decides the person alone.
  ],
  producerName: ['Producer', 'Producer Name', 'Agent', 'Agent Name', 'Sold By'],
  customerName: [
    'Customer',
    'Customer Name',
    'Insured',
    'Insured Name',
    'Name',
  ],
  policyType: ['Policy Type', 'Product', 'Line', 'Line of Business', 'LOB'],
  carrier: ['Carrier', 'Carrier Name', 'Company'],
  soldDate: ['Sold Date', 'Date Sold'],
  occurredAt: [
    'Cancel Date',
    'Cancellation Date',
    'Termination Date',
    'Chargeback Date',
    'Transaction Date',
    'Date',
  ],
  terminationReason: [
    'Termination Reason',
    'Cancel Reason',
    'Cancellation Reason',
    'Reason',
  ],
} as const satisfies Record<string, readonly string[]>;

export type ChargebackField = keyof typeof CHARGEBACK_COLUMN_ALIASES;

/** The columns a report cannot do without, named as the error message reads. */
const REQUIRED_FIELDS: Record<'policyNumber' | 'amount', string> = {
  policyNumber: 'Policy Number',
  amount: 'Prorated Amount (or Chargeback Amount)',
};

/** How far down a sheet the header may sit before we stop looking. */
export const HEADER_SEARCH_ROWS = 40;

/** Normalised header name → its aliases' order, per field. */
const ALIAS_KEYS = {} as Record<ChargebackField, string[]>;
for (const field of Object.keys(
  CHARGEBACK_COLUMN_ALIASES,
) as ChargebackField[]) {
  const names: readonly string[] = CHARGEBACK_COLUMN_ALIASES[field];
  ALIAS_KEYS[field] = names.map((name) => normalizeHeader(name));
}

export class ChargebackFileError extends Error {
  constructor(
    readonly reason: ChargebackFileErrorReason,
    message: string,
  ) {
    super(message);
    this.name = 'ChargebackFileError';
  }
}

/** One line of the report, as read. */
export interface ChargebackFileRow {
  /** The line's row in the sheet (or CSV), 1-based. */
  rowNumber: number;
  /** The SOK number (Allstate Bind ID), normalised; `null` when blank or absent. */
  bindId: string | null;
  producerName: string | null;
  policyNumber: string;
  customerName: string | null;
  policyType: string | null;
  carrier: string | null;
  /** `YYYY-MM-DD`. */
  soldDay: string | null;
  occurredDay: string | null;
  terminationReason: string | null;
  /** Premium dollars, positive, two decimals — whatever the sign or brackets. */
  amount: number;
  /**
   * The report mixes signs and this line has the less common one: a reversal
   * of an earlier charge rather than a chargeback. The matcher leaves it out.
   */
  oppositeSign: boolean;
}

export interface ChargebackFile {
  /** `null` for a CSV. */
  sheetName: string | null;
  headerRowNumber: number;
  /** Each field read, and the header it was read from. */
  columns: { field: ChargebackField; header: string }[];
  rows: ChargebackFileRow[];
  /** Lines left out, and columns the report lacks. */
  warnings: string[];
}

export type ChargebackFileFormat = 'xlsx' | 'csv';

/** Parse a report's bytes. @throws ChargebackFileError */
export function parseChargebackFile(
  bytes: Buffer,
  { format, maxRows }: { format: ChargebackFileFormat; maxRows?: number },
): ChargebackFile {
  const sheets = format === 'csv' ? csvSheets(bytes) : workbookSheets(bytes);

  if (!sheets.some((sheet) => sheet.rows.some(hasValue))) {
    throw new ChargebackFileError('no_rows', 'The file is empty.');
  }

  const found = findHeader(sheets);
  if (!found) {
    throw new ChargebackFileError(
      'no_header',
      `No header row with a ${REQUIRED_FIELDS.policyNumber} and a ${REQUIRED_FIELDS.amount} column was found in the first ${HEADER_SEARCH_ROWS} rows.`,
    );
  }
  const { sheet, headerIndex, header } = found;
  const index = columnIndex(header);

  const missing = (
    Object.keys(REQUIRED_FIELDS) as (keyof typeof REQUIRED_FIELDS)[]
  )
    .filter((field) => !index.has(field))
    .map((field) => REQUIRED_FIELDS[field]);
  if (missing.length) {
    throw new ChargebackFileError(
      'missing_columns',
      `The report is missing ${missing.length === 1 ? 'a column' : 'columns'}: ${missing.join(', ')}.`,
    );
  }

  const rows: ChargebackFileRow[] = [];
  const negative = new Set<number>();
  const noPolicy: number[] = [];
  const noAmount: number[] = [];
  for (let r = headerIndex + 1; r < sheet.rows.length; r += 1) {
    const values = sheet.rows[r] ?? [];
    if (!hasValue(values)) continue;
    const cell = (field: ChargebackField): unknown => {
      const i = index.get(field);
      return i === undefined ? undefined : values[i];
    };
    const rowNumber = r + 1;
    const policyNumber = parseText(cell('policyNumber'));
    const parsed = parseMoney(cell('amount'));
    if (!policyNumber) {
      // A totals or footnote line. Said out loud only when it carries money,
      // so a total is not mistaken for a lost chargeback.
      if (parsed) noPolicy.push(rowNumber);
      continue;
    }
    const amount = parsed === undefined ? 0 : roundCents(Math.abs(parsed));
    if (amount === 0) {
      noAmount.push(rowNumber);
      continue;
    }
    if (isNegative(cell('amount'), parsed)) negative.add(rowNumber);
    rows.push({
      rowNumber,
      bindId: normalizeBindId(parseText(cell('bindId'))),
      producerName: parseText(cell('producerName')) ?? null,
      policyNumber,
      customerName: parseText(cell('customerName')) ?? null,
      policyType: parseText(cell('policyType')) ?? null,
      carrier: parseText(cell('carrier')) ?? null,
      soldDay: parseDashDate(cell('soldDate')),
      occurredDay: parseDashDate(cell('occurredAt')),
      terminationReason: parseText(cell('terminationReason')) ?? null,
      amount,
      oppositeSign: false,
    });
    if (maxRows !== undefined && rows.length > maxRows) {
      throw new ChargebackFileError(
        'too_many_rows',
        `The report has more than ${maxRows.toLocaleString('en-US')} chargebacks. Upload one month at a time.`,
      );
    }
  }

  if (!rows.length) {
    throw new ChargebackFileError(
      'no_rows',
      'The report has a header row but no chargebacks under it.',
    );
  }

  // A report states its chargebacks one way — all positive, or all negative
  // or bracketed. A line with the other sign reverses an earlier charge; on a
  // tie the negatives are taken as the reversals.
  const reversals: number[] = [];
  if (negative.size > 0 && negative.size < rows.length) {
    const reversedAreNegative = negative.size <= rows.length - negative.size;
    for (const row of rows) {
      if (negative.has(row.rowNumber) === reversedAreNegative) {
        row.oppositeSign = true;
        reversals.push(row.rowNumber);
      }
    }
  }

  const warnings: string[] = [];
  if (reversals.length) {
    warnings.push(
      `${linesLabel(reversals)} ${reversals.length === 1 ? 'has' : 'have'} the opposite sign to the rest (${rowsLabel(reversals)}) — read as reversals and left out. Charge one only if it really is a chargeback.`,
    );
  }
  if (noAmount.length) {
    warnings.push(
      `${linesLabel(noAmount)} with no amount ${noAmount.length === 1 ? 'was' : 'were'} left out (${rowsLabel(noAmount)}).`,
    );
  }
  if (noPolicy.length) {
    warnings.push(
      `${linesLabel(noPolicy)} with an amount but no policy number ${noPolicy.length === 1 ? 'was' : 'were'} left out (${rowsLabel(noPolicy)}) — a total line?`,
    );
  }
  if (!index.has('bindId') && !index.has('producerName')) {
    warnings.push(
      'The report names no producer (no SOK or Producer column), so each line is charged to whoever sold the policy in the app.',
    );
  }

  return {
    sheetName: sheet.name,
    headerRowNumber: headerIndex + 1,
    columns: [...index.entries()].map(([field, i]) => ({
      field,
      header: parseText(sheet.rows[headerIndex]?.[i]) ?? '',
    })),
    rows,
    warnings,
  };
}

interface Sheet {
  name: string | null;
  rows: unknown[][];
}

function workbookSheets(bytes: Buffer): Sheet[] {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(bytes, {
      type: 'buffer',
      dense: true,
      // Same options as `readVendorFile`: a date stays its serial and is read
      // from UTC components by `parseDashDate`.
      cellDates: false,
      cellFormula: false,
      cellNF: false,
      cellStyles: false,
      cellHTML: false,
      cellText: false,
    });
  } catch {
    throw new ChargebackFileError(
      'unreadable',
      'The file could not be read as a spreadsheet.',
    );
  }
  return workbook.SheetNames.map((name) => ({
    name,
    // `Array.from`, not `.map`: a blank row is a hole in SheetJS's dense
    // array, and `.map` skips holes.
    rows: Array.from(workbook.Sheets[name]?.['!data'] ?? [], (cells) =>
      cells ? Array.from(cells, (cell) => cellToPrimitive(cell)) : [],
    ),
  }));
}

/**
 * A CSV as one sheet of text cells. Read as text — never through SheetJS's
 * CSV guessing — so a policy number keeps its digits and an amount its
 * brackets for `parseMoney` to read.
 */
function csvSheets(bytes: Buffer): Sheet[] {
  try {
    const rows = parseCsv(bytes, {
      bom: true,
      relax_column_count: true,
      relax_quotes: true,
      skip_empty_lines: false,
    }) as string[][];
    return [{ name: null, rows }];
  } catch {
    throw new ChargebackFileError(
      'unreadable',
      'The file could not be read as a CSV.',
    );
  }
}

/**
 * The report's header row: the first with a policy-number **and** an amount
 * column. Failing that, the first row that is plainly a header — two or more
 * columns this reader knows — so the refusal can name the column it lacks
 * rather than say no header was found.
 */
function findHeader(
  sheets: Sheet[],
): { sheet: Sheet; headerIndex: number; header: string[] } | null {
  let fallback: { sheet: Sheet; headerIndex: number; header: string[] } | null =
    null;
  for (const sheet of sheets) {
    const limit = Math.min(sheet.rows.length, HEADER_SEARCH_ROWS);
    for (let r = 0; r < limit; r += 1) {
      const header = (sheet.rows[r] ?? []).map((cell) =>
        normalizeHeader(parseText(cell) ?? ''),
      );
      const names = new Set(header);
      const has = (field: ChargebackField) =>
        ALIAS_KEYS[field].some((key) => names.has(key));
      if (has('policyNumber') && has('amount')) {
        return { sheet, headerIndex: r, header };
      }
      if (!fallback) {
        const known = (Object.keys(ALIAS_KEYS) as ChargebackField[]).filter(
          has,
        );
        if (known.length >= 2) fallback = { sheet, headerIndex: r, header };
      }
    }
  }
  return fallback;
}

/**
 * Each field's column: the first of its aliases (in preference order) the
 * header has, at that name's first occurrence. A column serves one field.
 */
function columnIndex(header: string[]): Map<ChargebackField, number> {
  const index = new Map<ChargebackField, number>();
  const taken = new Set<number>();
  for (const field of Object.keys(ALIAS_KEYS) as ChargebackField[]) {
    for (const key of ALIAS_KEYS[field]) {
      const i = header.findIndex((name, at) => name === key && !taken.has(at));
      if (i !== -1) {
        index.set(field, i);
        taken.add(i);
        break;
      }
    }
  }
  return index;
}

/** `-12.50`, `($12.50)`, `$(12.50)`: a negative amount, as reports print one. */
function isNegative(raw: unknown, parsed: number | undefined): boolean {
  if (parsed !== undefined && parsed < 0) return true;
  return typeof raw === 'string' && /\(\s*\$?\s*[\d.,]+\s*\)/.test(raw);
}

function hasValue(values: readonly unknown[] | undefined): boolean {
  return (values ?? []).some((value) => parseText(value) !== undefined);
}

function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

function linesLabel(rows: number[]): string {
  return rows.length === 1 ? '1 line' : `${rows.length} lines`;
}

/** `row 4` / `rows 4, 9 and 12` / `rows 4, 9, 12 and 7 more`. */
function rowsLabel(rows: number[]): string {
  if (rows.length === 1) return `row ${rows[0]}`;
  const shown = rows.slice(0, 5);
  const rest = rows.length - shown.length;
  if (rest > 0) return `rows ${shown.join(', ')} and ${rest} more`;
  return `rows ${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
}
