import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { parse } from 'csv-parse';
import { stringify } from 'csv-stringify/sync';
import * as XLSX from 'xlsx';
import { dateToExcelSerial } from './mailer-parse';

/**
 * Read a vendor mail file, whatever shape it arrived in (PAC-71).
 *
 * The importer was CSV-only, because the file PAC-73 took was ApexReports'
 * *output* — a CSV somebody had already downloaded. PAC-71 takes the file one
 * stage earlier and the vendor's own file is **XLSX** (`SFA-QBP.xlsx`, one
 * sheet, ~20,000 rows × 124 columns). CSV stays supported: it is what "Import a
 * processed file" takes, and what the committed fixture is.
 *
 * ## One shape out, whatever went in
 *
 * Both readers return `{ headers, rows }` — a header row and positional cell
 * arrays, exactly what `processMailerFile` takes. **That equivalence is the
 * contract**, and `vendor-file-reader.unit-spec.ts` asserts it by running the
 * same data through both paths and comparing the transform's output. It matters
 * because the print file is compared byte for byte against Alteryx's, so a cell
 * that reads differently out of XLSX than out of CSV is a mail piece with the
 * wrong number on it.
 *
 * ## Why XLSX is read by SheetJS, and in memory (PAC-150)
 *
 * The reader was ExcelJS's streaming `WorkbookReader`, chosen for constant
 * memory. It then failed on the first vendor file production ever saw. That
 * file was written by .NET's OpenXML SDK, which binds the SpreadsheetML
 * namespace to a prefix — `<x:row>`, `<x:c>`, `<x:si>` — where Excel writes
 * the default namespace. Both are valid OOXML; ExcelJS switches on raw tag
 * names and read the sheet as **zero rows**, which surfaced as "the file is
 * empty". The streaming reader also needed two workarounds for its own
 * defects (unresolved shared strings on small files, a crash when the sheet
 * part precedes the workbook part). SheetJS parses the prefixed form natively
 * and needed neither.
 *
 * The price is memory: SheetJS has no streaming parser, so the workbook is
 * read whole. Measured on the two real files to hand (PAC-150), each in a
 * fresh process: 16,339 and 20,024 rows both read in ~2.4 s at 450–500 MB
 * RSS, ~650 MB once `processMailerFile` has run — against ~250 MB streaming.
 * That is acceptable because the file is read inside a **worker job**, never
 * a request, and `processMailerFile` sorts on `pst_seq` and dedupes across
 * the whole file, so every row had to be held in memory before the transform
 * could start anyway. A vendor file is ~20,000 rows a week by design; the
 * cost scales with rows, not with the week. The production app droplet is
 * 2 GB, shared with the API and web containers — if the vendor's file ever
 * grows several-fold, revisit this before the worker does.
 *
 * ⚠ **`xlsx` is not the npm registry package.** The registry copy is frozen
 * at 0.18.5 with published advisories; the maintained release is installed
 * from `cdn.sheetjs.com` as a URL dependency, pinned by integrity hash in the
 * lockfile. `npm ci` in the API image build fetches it from there.
 *
 * ## Import boundary
 *
 * `common/`, so the worker may import it (`eslint.config.mjs`). Takes a stream
 * and returns data; knows nothing about storage, Mongo or campaigns.
 */

/** How the bytes are encoded. Settled by {@link detectVendorFileKind}. */
export type VendorFileKind = 'xlsx' | 'csv';

/** A parsed file: the header row, and one positional array per data row. */
export interface VendorFileTable {
  headers: string[];
  rows: unknown[][];
}

/**
 * The first four bytes of every zip archive — and an XLSX **is** a zip.
 *
 * Content type is not evidence: `File.type` for a spreadsheet is variously
 * `application/vnd.openxmlformats-…`, `application/zip`, `application/x-zip`,
 * `application/octet-stream` or the empty string depending on the browser, the
 * OS and whether the file arrived from a cloud drive. See
 * `ALLOWED_MAILER_CONTENT_TYPES`, which is deliberately permissive for exactly
 * that reason.
 */
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/**
 * Decide how to parse, from the strongest available evidence.
 *
 * Order matters: **magic bytes beat everything**, because they describe the
 * file rather than what somebody said about it — a vendor mailing
 * `SFA-QBP.xls` that is really an XLSX is a real and unremarkable event.
 * Extension is next, content type last, and CSV is the fallback because that is
 * the format a hand-made file is overwhelmingly likely to be in.
 */
export function detectVendorFileKind(input: {
  filename?: string | null;
  contentType?: string | null;
  /** The first few bytes, when the caller has them. */
  head?: Buffer | null;
}): VendorFileKind {
  if (input.head && input.head.length >= 4) {
    if (input.head.subarray(0, 4).equals(ZIP_MAGIC)) return 'xlsx';
    return 'csv';
  }

  const name = (input.filename ?? '').toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xlsm')) return 'xlsx';
  if (name.endsWith('.csv') || name.endsWith('.txt')) return 'csv';

  const type = (input.contentType ?? '').toLowerCase();
  if (type.includes('spreadsheetml') || type === 'application/zip') {
    return 'xlsx';
  }
  return 'csv';
}

/**
 * One XLSX cell as the value the CSV path would have produced.
 *
 * SheetJS hands back a cell object whose `t` says what `v` is: `s` string,
 * `n` number, `b` boolean, `d` Date, `e` error, `z` blank stub. Rich text and
 * formulas are not separate shapes — a rich-text cell's `v` is its plain
 * concatenated text, and a formula cell's `v` is the cached result Excel
 * wrote — so both already read as the value the CSV carries.
 *
 * ⚠ **`Date` → Excel serial is the load-bearing case.** Everything downstream —
 * `parseSourceDate`, and the print file itself — expects `quotedate` in the
 * serial form the CSV carries. The workbook is read with `cellDates: false`,
 * so a date-formatted number normally arrives as the raw serial and never
 * becomes a `Date` at all; this branch is belt and braces for a workbook
 * that stores a true ISO date cell (`t: 'd'`). See {@link dateToExcelSerial}.
 *
 * Empty is `''`, not `null`, because that is what `csv-parse` yields for a
 * blank cell and the whole point of this function is that the two agree. An
 * error cell (`#N/A`, `#DIV/0!`) is not a value either: `''`, never its code.
 */
export function cellToPrimitive(
  cell: XLSX.CellObject | undefined,
): string | number | boolean {
  if (cell === undefined || cell.v === undefined || cell.t === 'e') return '';
  if (cell.v instanceof Date) return dateToExcelSerial(cell.v);
  return cell.v;
}

/**
 * Parse a vendor file into `{ headers, rows }`.
 *
 * A short row is padded to the header width and a long one is kept whole — the
 * transform indexes by header position, so a missing trailing cell must read as
 * empty rather than shifting every column after it. A trailing short row is a
 * hand-trimmed-file artifact, not a reason to refuse 20,000 good ones; the
 * *required column* check in the preview is where a genuinely wrong file is
 * caught.
 *
 * @throws Error when the file carries no header row at all.
 */
export async function readVendorFile(
  body: Readable,
  kind: VendorFileKind,
): Promise<VendorFileTable> {
  const table = kind === 'xlsx' ? await readXlsx(body) : await readCsv(body);
  if (table.headers.length === 0) {
    throw new Error('The file is empty — no header row was found.');
  }
  return table;
}

/**
 * The first worksheet, as positional rows.
 *
 * Only the first sheet is read: real vendor files carry one. Rows with no
 * cells at all are skipped, which is what `skip_empty_lines` does on the CSV
 * path — a blank line in the middle of a file is not a mailer.
 */
async function readXlsx(body: Readable): Promise<VendorFileTable> {
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Buffer | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8'));
  }
  const bytes: Buffer = Buffer.concat(chunks);

  const workbook = XLSX.read(bytes, {
    type: 'buffer',
    // Cells in `!data[row][col]` rather than keyed by `A1` — the only shape
    // SheetJS recommends for a sheet this size, and the one we walk below.
    dense: true,
    // A date-formatted number stays the raw serial, which is both what we
    // want and what the CSV path carries. `cellToPrimitive` still normalizes
    // a true `Date` if one ever arrives.
    cellDates: false,
    // None of these are data. Formula *text* is skipped; the cached result
    // still lands in `v`. Number formats, styles and HTML/text renderings
    // would only cost memory on a 124-column sheet.
    cellFormula: false,
    cellNF: false,
    cellStyles: false,
    cellHTML: false,
    cellText: false,
  });

  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = sheet?.['!data'] ?? [];

  let headers: string[] = [];
  const rows: unknown[][] = [];
  for (const cells of data) {
    if (!cells || cells.length === 0) continue;
    if (headers.length === 0) {
      headers = trimTrailingEmpty(
        Array.from(cells, (cell) => String(cellToPrimitive(cell))),
      );
      continue;
    }
    const width = Math.max(headers.length, cells.length);
    const row: unknown[] = [];
    for (let i = 0; i < width; i += 1) row.push(cellToPrimitive(cells[i]));
    rows.push(row);
  }

  return { headers, rows };
}

/** The same CSV wiring the import engine uses, minus the header mapping. */
async function readCsv(body: Readable): Promise<VendorFileTable> {
  // `columns: false` — positional arrays, because `processMailerFile` matches
  // headers itself (case-insensitively, and it echoes them back in order to
  // build the print file). Mapping to objects here would lose column order and
  // silently collapse a file carrying two columns of the same name.
  const parser = parse({
    bom: true,
    columns: false,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  });

  // `pipeline`, never `body.pipe(parser)`: `pipe` does not forward a source
  // error to its destination, so an object-storage read aborted mid-file left
  // the consumer awaiting a row that could never arrive — a job that hangs
  // forever instead of one that fails and retries. Same note as the deleted
  // `import-mailers.fn.ts` carried, and the same reason.
  const done = pipeline(body, parser);

  let headers: string[] = [];
  const rows: unknown[][] = [];
  for await (const record of parser) {
    const cells = record as string[];
    if (headers.length === 0) {
      headers = trimTrailingEmpty(cells.map((cell) => String(cell ?? '')));
      continue;
    }
    rows.push(padTo(cells, headers.length));
  }
  await done;

  return { headers, rows };
}

/**
 * Serialise the transform's output as the print vendor's CSV.
 *
 * `null`/`undefined` become empty fields, numbers their plain decimal form —
 * both matching what Alteryx wrote, which is what the fixture is compared
 * against. Quoting is `csv-stringify`'s default (only where a field needs it),
 * again matching the reference print file.
 */
export function writeVendorCsv(
  headers: string[],
  rows: readonly (readonly unknown[])[],
): Buffer {
  // Headers as the first record rather than through `header: true`, which needs
  // a `columns` definition and only applies to object records. These rows are
  // positional by construction.
  const csv = stringify([headers, ...(rows as unknown[][])], {
    cast: {
      // `csv-stringify` would render a `Date` as ISO-8601. Nothing should reach
      // here as one — `cellToPrimitive` converts on the way in — but the print
      // file is a contract with an outside party, so this is belt and braces.
      date: (value) => String(dateToExcelSerial(value)),
    },
  });
  return Buffer.from(csv, 'utf8');
}

/** Right-pad a short row so cell `i` is always column `i`. */
function padTo(cells: unknown[], width: number): unknown[] {
  if (cells.length >= width) return cells;
  return [...cells, ...Array<string>(width - cells.length).fill('')];
}

/**
 * Drop empty trailing headers.
 *
 * Excel reports a used range that often runs past the last real column, and an
 * unnamed column would become a header the transform matches nothing against
 * and the print file carries as a stray comma.
 */
function trimTrailingEmpty(headers: string[]): string[] {
  let end = headers.length;
  while (end > 0 && headers[end - 1].trim() === '') end -= 1;
  return headers.slice(0, end);
}
