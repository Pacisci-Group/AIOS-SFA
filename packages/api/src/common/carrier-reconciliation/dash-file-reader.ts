import * as XLSX from 'xlsx';
import {
  normalizeBindId,
  normalizeSubProducerCode,
  policyNumberKey,
} from '@sfa/shared';
import { normalizeHeader } from '../mailers/mailer-row.mapper';
import {
  excelSerialToDate,
  parseMoney,
  parseInteger,
  parseText,
} from '../mailers/mailer-parse';
import { cellToPrimitive } from '../mailers/vendor-file-reader';

/**
 * Reads Allstate's Dash export "Sold — New Business Details (All)".
 *
 * The file is not a plain table, which is why `readVendorFile` cannot read it:
 *
 * - **Metadata rows come first.** The report title, `Download Date`,
 *   `Downloaded By`, `Agent` (`0B9049 - SMITH, BRIAN`), `Start Date`,
 *   `End Date` and two pivot-filter rows sit above the header. The header is
 *   the first row naming both `Policy No` and `Bind ID`.
 * - **The sheet is not always the first.** People add scratch sheets and
 *   pivots to the workbook before uploading it, sometimes in front of the
 *   report. The sheet is chosen by its header, never by position.
 * - **Headers carry stray spaces** (`Month `, `Product Description `), so they
 *   are matched through `normalizeHeader`. Two columns are both named
 *   `Channel` and carry the same value; the first one is read.
 * - **One date column holds three encodings**: an Excel serial, a
 *   `MM/DD/YYYY` string, and (from other tools) an ISO string. All three come
 *   out as a calendar date, `YYYY-MM-DD`, built from the **UTC** components —
 *   never `new Date('09/15/2026')`, which parses as local midnight and reads
 *   back a day early on any server east of UTC.
 * - **Blank text is a space** (`" "`, `"   "`), and `Sub Producer` is a
 *   3-digit code Excel may have turned into the number `34`.
 *
 * Pure: bytes in, rows out. No storage, no Mongo.
 */

export class DashFileError extends Error {
  constructor(
    readonly reason: 'no_report_sheet' | 'missing_columns' | 'too_many_rows',
    message: string,
  ) {
    super(message);
    this.name = 'DashFileError';
  }
}

/** One data line of the report, parsed. */
export interface DashRow {
  /** The spreadsheet row number, 1-based, as Excel shows it. */
  rowNumber: number;
  agentNumber: string | null;
  /** 3-digit sub-producer code; `000` and blanks read as `null`. */
  subProducerCode: string | null;
  subProducerName: string | null;
  /** As printed, trimmed. */
  bindId: string | null;
  /** Upper-cased {@link bindId}: the lookup key. */
  bindIdKey: string | null;
  bindIdName: string | null;
  policyNumber: string | null;
  /** {@link reconciliationPolicyKey}; `''` when the line has no number. */
  policyKey: string;
  customerName: string | null;
  issuedDate: string | null;
  dateWritten: string | null;
  product: string | null;
  productDescription: string | null;
  lineGroup: string | null;
  packageName: string | null;
  transactionType: string | null;
  dispositionCode: string | null;
  itemCount: number | null;
  writtenPremium: number | null;
  channel: string | null;
  channelIndicator: string | null;
  scenarioName: string | null;
}

export interface DashFileMeta {
  agentNumber: string | null;
  agentName: string | null;
  downloadedBy: string | null;
  /** ISO-8601 instant. */
  downloadedAt: string | null;
  startDate: string | null;
  endDate: string | null;
  sheetName: string;
  /** 1-based, as Excel shows it. */
  headerRowNumber: number;
}

export interface DashFile {
  meta: DashFileMeta;
  rows: DashRow[];
  warnings: string[];
}

/** The columns a file must carry to be reconciled at all. */
export const DASH_REQUIRED_COLUMNS = {
  policyno: 'Policy No',
  bindid: 'Bind ID',
  transactiontype: 'Transaction Type',
  dispositioncode: 'Disposition Code',
  writtenpremium: 'Written Premium',
} as const;

/** Normalized header → the field it fills. Aliases cover renamed exports. */
const COLUMN_ALIASES: Record<string, keyof DashRowCells> = {
  agentnumber: 'agentNumber',
  subproducer: 'subProducer',
  subproducercode: 'subProducer',
  subproducername: 'subProducerName',
  bindid: 'bindId',
  bindidname: 'bindIdName',
  policyno: 'policyNumber',
  policynumber: 'policyNumber',
  customername: 'customerName',
  issueddate: 'issuedDate',
  datewritten: 'dateWritten',
  product: 'product',
  productdescription: 'productDescription',
  linegroup: 'lineGroup',
  package: 'packageName',
  transactiontype: 'transactionType',
  dispositioncode: 'dispositionCode',
  itemcount: 'itemCount',
  writtenpremium: 'writtenPremium',
  channel: 'channel',
  channelindicator: 'channelIndicator',
  scenarioname: 'scenarioName',
};

type DashRowCells = {
  agentNumber: unknown;
  subProducer: unknown;
  subProducerName: unknown;
  bindId: unknown;
  bindIdName: unknown;
  policyNumber: unknown;
  customerName: unknown;
  issuedDate: unknown;
  dateWritten: unknown;
  product: unknown;
  productDescription: unknown;
  lineGroup: unknown;
  packageName: unknown;
  transactionType: unknown;
  dispositionCode: unknown;
  itemCount: unknown;
  writtenPremium: unknown;
  channel: unknown;
  channelIndicator: unknown;
  scenarioName: unknown;
};

/** How far down a sheet the header may sit before we stop looking. */
const HEADER_SEARCH_ROWS = 40;

/** Parse a workbook's bytes. @throws DashFileError */
export function parseDashWorkbook(
  bytes: Buffer,
  { maxRows }: { maxRows?: number } = {},
): DashFile {
  const workbook = XLSX.read(bytes, {
    type: 'buffer',
    dense: true,
    // A date cell stays its serial; `parseDashDate` turns it into a calendar
    // date from UTC components. Same options as `readVendorFile`.
    cellDates: false,
    cellFormula: false,
    cellNF: false,
    cellStyles: false,
    cellHTML: false,
    cellText: false,
  });

  const found = findDashSheet(workbook);
  if (!found) {
    throw new DashFileError(
      'no_report_sheet',
      'This does not look like a Dash "New Business Details" report: no sheet has a header row with "Policy No" and "Bind ID".',
    );
  }
  const { sheetName, data, headerIndex } = found;

  const header = rowValues(data[headerIndex]).map((cell) =>
    normalizeHeader(String(cell)),
  );
  const missing = Object.entries(DASH_REQUIRED_COLUMNS)
    .filter(([key]) => !header.includes(key))
    .map(([, label]) => label);
  if (missing.length) {
    throw new DashFileError(
      'missing_columns',
      `The report is missing ${missing.length === 1 ? 'a column' : 'columns'}: ${missing.join(', ')}.`,
    );
  }

  // First occurrence wins: the export repeats `Channel`, with the same value.
  const index = new Map<keyof DashRowCells, number>();
  header.forEach((name, i) => {
    const field = COLUMN_ALIASES[name];
    if (field && !index.has(field)) index.set(field, i);
  });

  const meta: DashFileMeta = {
    // `Array.from`, not `.map`: a blank row is a hole in SheetJS's dense
    // array, and `.map` skips holes, leaving `undefined` behind.
    ...parseDashMeta(Array.from(data.slice(0, headerIndex), rowValues)),
    sheetName,
    headerRowNumber: headerIndex + 1,
  };

  const rows: DashRow[] = [];
  for (let r = headerIndex + 1; r < data.length; r += 1) {
    const values = rowValues(data[r]);
    if (!values.some((value) => parseText(value) !== undefined)) continue;
    const cell = (field: keyof DashRowCells): unknown => {
      const i = index.get(field);
      return i === undefined ? undefined : values[i];
    };
    const row = toDashRow(r + 1, cell);
    // A totals or footnote line has no policy number and no transaction.
    if (!row.policyNumber && !row.transactionType) continue;
    rows.push(row);
    if (maxRows !== undefined && rows.length > maxRows) {
      throw new DashFileError(
        'too_many_rows',
        `The report has more than ${maxRows.toLocaleString('en-US')} lines. Upload one month at a time.`,
      );
    }
  }

  const warnings: string[] = [];
  if (!meta.startDate || !meta.endDate) {
    warnings.push(
      'The report period (Start Date / End Date) was not found above the header; the period is taken from the lines’ issue dates.',
    );
  }
  if (!meta.agentNumber) {
    warnings.push(
      'The agent number was not found above the header; the Agent Number column is used instead.',
    );
  }
  if (!index.has('subProducer')) {
    warnings.push(
      'The report has no Sub Producer column; producer credit is read from the Bind ID.',
    );
  }

  return { meta, rows, warnings };
}

/** The sheet and row holding the report's header, or `null`. */
export function findDashSheet(workbook: XLSX.WorkBook): {
  sheetName: string;
  data: XLSX.CellObject[][];
  headerIndex: number;
} | null {
  for (const sheetName of workbook.SheetNames) {
    const data = workbook.Sheets[sheetName]?.['!data'] ?? [];
    const limit = Math.min(data.length, HEADER_SEARCH_ROWS);
    for (let r = 0; r < limit; r += 1) {
      const names = new Set(
        rowValues(data[r]).map((cell) => normalizeHeader(String(cell))),
      );
      if (names.has('policyno') && names.has('bindid')) {
        return { sheetName, data, headerIndex: r };
      }
    }
  }
  return null;
}

/** `[label, value]` lines above the header. Unknown labels are ignored. */
export function parseDashMeta(
  lines: unknown[][],
): Omit<DashFileMeta, 'sheetName' | 'headerRowNumber'> {
  const meta: Omit<DashFileMeta, 'sheetName' | 'headerRowNumber'> = {
    agentNumber: null,
    agentName: null,
    downloadedBy: null,
    downloadedAt: null,
    startDate: null,
    endDate: null,
  };
  for (const line of lines) {
    const cells = line.filter((value) => parseText(value) !== undefined);
    if (cells.length < 2) continue;
    const label = normalizeHeader(String(cells[0]));
    const value = cells[1];
    switch (label) {
      case 'agent': {
        const [code, name] = splitCodeAndName(value);
        meta.agentNumber = dashAgentNumberKey(code);
        meta.agentName = name;
        break;
      }
      case 'downloadedby':
        meta.downloadedBy = splitCodeAndName(value)[0];
        break;
      case 'downloaddate':
        meta.downloadedAt = parseInstant(value);
        break;
      case 'startdate':
        meta.startDate = parseDashDate(value);
        break;
      case 'enddate':
        meta.endDate = parseDashDate(value);
        break;
      default:
        break;
    }
  }
  return meta;
}

function toDashRow(
  rowNumber: number,
  cell: (field: keyof DashRowCells) => unknown,
): DashRow {
  const policyNumber = parseText(cell('policyNumber')) ?? null;
  const bindId = parseText(cell('bindId')) ?? null;
  return {
    rowNumber,
    agentNumber: dashAgentNumberKey(cell('agentNumber')),
    // The same normalisation the user's codes get, so `34` matches `034`.
    subProducerCode: normalizeSubProducerCode(cell('subProducer')),
    subProducerName: dashName(cell('subProducerName')),
    bindId,
    bindIdKey: normalizeBindId(bindId),
    bindIdName: dashName(cell('bindIdName')),
    policyNumber,
    policyKey: reconciliationPolicyKey(policyNumber),
    customerName: parseText(cell('customerName')) ?? null,
    issuedDate: parseDashDate(cell('issuedDate')),
    dateWritten: parseDashDate(cell('dateWritten')),
    product: parseText(cell('product')) ?? null,
    productDescription: parseText(cell('productDescription')) ?? null,
    lineGroup: parseText(cell('lineGroup')) ?? null,
    packageName: parseText(cell('packageName')) ?? null,
    transactionType: parseText(cell('transactionType')) ?? null,
    dispositionCode: parseText(cell('dispositionCode')) ?? null,
    itemCount: parseInteger(cell('itemCount')) ?? null,
    writtenPremium: parseMoney(cell('writtenPremium')) ?? null,
    channel: parseText(cell('channel')) ?? null,
    channelIndicator: parseText(cell('channelIndicator')) ?? null,
    scenarioName: parseText(cell('scenarioName')) ?? null,
  };
}

function rowValues(cells: XLSX.CellObject[] | undefined): unknown[] {
  if (!cells) return [];
  return Array.from(cells, (cell) => cellToPrimitive(cell));
}

/**
 * A calendar date as `YYYY-MM-DD`, or `null`.
 *
 * Accepts an Excel serial, `M/D/YYYY`, `YYYY-MM-DD…` and a `Date`. Every path
 * reads UTC components, so the answer does not depend on the server's zone.
 */
export function parseDashDate(raw: unknown): string | null {
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? null : raw.toISOString().slice(0, 10);
  }
  if (typeof raw === 'number') {
    const date = excelSerialToDate(raw);
    return date ? date.toISOString().slice(0, 10) : null;
  }
  const text = parseText(raw);
  if (!text) return null;

  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (us) return isoFromParts(Number(us[3]), Number(us[1]), Number(us[2]));

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return isoFromParts(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  // A serial that arrived as text (a CSV re-save).
  if (/^\d{5}(\.\d+)?$/.test(text)) return parseDashDate(Number(text));
  return null;
}

function isoFromParts(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

/** `Mon, 12 Oct 2026 03:39:31 GMT` → ISO instant. Carries its own zone. */
function parseInstant(raw: unknown): string | null {
  if (typeof raw === 'number') {
    return excelSerialToDate(raw)?.toISOString() ?? null;
  }
  const text = parseText(raw);
  if (!text) return null;
  const at = Date.parse(text);
  return Number.isNaN(at) ? null : new Date(at).toISOString();
}

/** `0B9049 - SMITH, BRIAN` → `['0B9049', 'SMITH, BRIAN']`. */
function splitCodeAndName(raw: unknown): [string | null, string | null] {
  const text = parseText(raw);
  if (!text) return [null, null];
  // `SOK35W0D - ` arrives trimmed as `SOK35W0D -`: the name may be empty.
  const parts = /^(.*?)\s+-(?:\s+(.*))?$/.exec(text);
  if (!parts) return [text, null];
  return [parts[1].trim() || null, parts[2]?.trim() || null];
}

/** A name column, with the carrier's "No Code" placeholder read as blank. */
function dashName(raw: unknown): string | null {
  const text = parseText(raw);
  if (!text || /^no code$/i.test(text)) return null;
  return text;
}

/** The agent number as a key: trimmed, upper-cased. */
export function dashAgentNumberKey(raw: unknown): string | null {
  const text = parseText(raw);
  return text ? text.toUpperCase() : null;
}

/**
 * The key a policy number is matched on, applied to **both** sides.
 *
 * `policyNumberKey` (upper-case, alphanumerics only), after dropping a
 * trailing 1–2 digit term suffix: National General numbers are printed bare
 * in Dash (`2037692470`) but often typed with their term (`2037692470-00`).
 * Only a *short* suffix goes — `875-933-180` is a number typed with
 * separators, not a term.
 */
export function reconciliationPolicyKey(raw: unknown): string {
  const text =
    typeof raw === 'number' && Number.isFinite(raw)
      ? String(Math.trunc(raw))
      : parseText(raw);
  if (!text) return '';
  return policyNumberKey(text.replace(/-\s*\d{1,2}\s*$/, ''));
}
