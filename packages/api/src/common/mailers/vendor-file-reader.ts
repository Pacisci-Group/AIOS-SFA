import { createWriteStream } from 'fs';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { parse } from 'csv-parse';
import { stringify } from 'csv-stringify/sync';
import ExcelJS from 'exceljs';
import { dateToExcelSerial } from './mailer-parse';

/**
 * Read a vendor mail file, whatever shape it arrived in (PAC-71).
 *
 * The importer was CSV-only, because the file PAC-73 took was ApexReports'
 * *output* — a CSV somebody had already downloaded. PAC-71 takes the file one
 * stage earlier and the vendor's own file is **XLSX** (`SFA-QBP.xlsx`, one
 * sheet, 20,024 rows × 124 columns). CSV stays supported: it is what "Import a
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
 * ## Why rows are collected in memory
 *
 * The *parse* streams; the result does not. `processMailerFile` sorts on
 * `pst_seq` and dedupes across the whole file, so it cannot start until every
 * row is read — there is no streaming formulation of it. 20,024 rows take
 * 179 ms and a few hundred MB peak, inside a worker job with no request
 * attached. Streaming the parse still matters: it is what keeps the *zip
 * inflation* off the heap all at once.
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
 * ExcelJS returns a *model* per cell — rich text as a run array, a formula as
 * `{formula, result}`, a hyperlink as `{text, hyperlink}`, an error as
 * `{error}`. None of those are data the transform can price, and every one of
 * them stringifies to `[object Object]` if passed through, which reads as a
 * blank column rather than as a fault.
 *
 * ⚠ **`Date` → Excel serial is the load-bearing case.** Everything downstream —
 * `parseSourceDate`, and the print file itself — expects `quotedate` in the
 * serial form the CSV carries. See {@link dateToExcelSerial}.
 *
 * Empty is `''`, not `null`, because that is what `csv-parse` yields for a
 * blank cell and the whole point of this function is that the two agree.
 */
export function cellToPrimitive(value: unknown): string | number | boolean {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return dateToExcelSerial(value);

  const model = value as {
    richText?: { text?: string }[];
    result?: unknown;
    formula?: unknown;
    text?: unknown;
    hyperlink?: unknown;
    error?: unknown;
  };

  if (Array.isArray(model.richText)) {
    return model.richText.map((run) => run.text ?? '').join('');
  }
  // A formula's *result* — a cached value written by Excel. `undefined` when
  // the workbook was never recalculated, which is an empty cell, not a zero.
  if (model.formula !== undefined) {
    return model.result === undefined ? '' : cellToPrimitive(model.result);
  }
  if (model.hyperlink !== undefined) {
    return typeof model.text === 'string' ? model.text : '';
  }
  // `{ error: '#N/A' }` and anything unrecognised. An error cell is not a value.
  return '';
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
 * An XLSX worksheet's rows, with a fallback for the case ExcelJS gets wrong.
 *
 * ## Why a temp file rather than the stream we were handed
 *
 * The bytes are read **twice** in the fallback case, and the stream from object
 * storage can only be read once. Spooling to disk first keeps memory flat
 * (nothing is buffered) and makes the fallback free — no second download.
 * ExcelJS is handed the path, which is also the shape its streaming reader is
 * least fragile with; see below.
 */
async function readXlsx(body: Readable): Promise<VendorFileTable> {
  const dir = await mkdtemp(join(tmpdir(), 'sfa-vendor-'));
  const path = join(dir, 'vendor.xlsx');
  try {
    await pipeline(body, createWriteStream(path));
    try {
      return await readXlsxStreaming(path);
    } catch (error) {
      if (!(error instanceof UnresolvedSharedStringsError)) throw error;
      // Measured, not defensive: a 19 MB / 20k-row workbook streams in 3.6 s at
      // ~250 MB, while the buffered read of the same file takes 6.1 s at ~1 GB.
      // The fallback only ever fires on files small enough for that not to
      // matter — see the error's own note.
      return readXlsxBuffered(path);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Thrown when the streaming reader hands back shared-string **indices**.
 *
 * ⚠ This is a real ExcelJS defect, and the reason this module does not simply
 * trust its streaming reader. In an XLSX every repeated string lives in one
 * table (`xl/sharedStrings.xml`) and each cell holds an index into it. ExcelJS
 * buffers zip entries through a `data` listener while unzipper drains the ones
 * nobody has consumed yet, so when the whole archive arrives faster than the
 * reader walks it — which is exactly what happens with a *small* file — the
 * shared-string part is passed over and never parsed. Every text cell then
 * comes back as `{ sharedString: 7 }`.
 *
 * What makes it dangerous is the failure mode: an unrecognised object flattens
 * to `''`, so the import would succeed and write 20,000 mailers with **every
 * name and address blank**. Detecting it and re-reading is the difference
 * between a slower import and a silently wrong mail drop.
 *
 * Deterministic by size in every run measured — small files always fail, the
 * 19 MB reference file always succeeds — so the fallback path is cheap by
 * construction.
 */
class UnresolvedSharedStringsError extends Error {
  constructor() {
    super('ExcelJS returned unresolved shared strings.');
  }
}

/** `{ sharedString: n }` — an index ExcelJS never got round to resolving. */
function isUnresolvedSharedString(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'sharedString' in (value as Record<string, unknown>)
  );
}

/** The fast path: one forward pass over the zip, constant memory. */
async function readXlsxStreaming(path: string): Promise<VendorFileTable> {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(path, {
    // Shared strings must be cached — see `UnresolvedSharedStringsError`.
    sharedStrings: 'cache',
    // Neither is data. Ignoring styles also means a date-formatted number
    // arrives as the raw serial, which is both what we want and what the CSV
    // path carries — and, unlike the cached-styles path, it is stable across
    // timezones. `cellToPrimitive` still normalizes a real `Date`.
    hyperlinks: 'ignore',
    styles: 'ignore',
    worksheets: 'emit',
    entries: 'ignore',
  });

  // ⚠ Works around a second ExcelJS crash, and must not be removed as dead code.
  //
  // `_parseWorksheet` dereferences `this.model.sheets`, which is only assigned
  // once `xl/workbook.xml` has gone past. Any writer that puts the sheet before
  // the workbook part — ExcelJS's own does exactly that — therefore throws
  // `Cannot read properties of undefined (reading 'sheets')` before a single
  // row is read. Seeding an empty model makes that lookup miss instead of
  // throw; the only thing it costs is the worksheet's *name*, which nothing
  // here reads. A real model, when one arrives, simply overwrites this.
  const seeded = reader as unknown as { model?: { sheets?: unknown[] } };
  seeded.model ??= { sheets: [] };

  let headers: string[] = [];
  const rows: unknown[][] = [];
  let sheetIndex = 0;

  for await (const worksheet of reader) {
    sheetIndex += 1;
    // ⚠ Every worksheet is iterated even though only the first is kept, and the
    // loop is never `break`-ed out of. The workbook reader is a single forward
    // pass over the zip: abandoning it mid-file leaves the underlying stream
    // unconsumed, which in a worker is a job that hangs rather than one that
    // fails. Real vendor files carry one sheet, so this costs nothing.
    for await (const row of worksheet) {
      if (sheetIndex > 1) continue;
      const values: unknown[] = Array.isArray(row.values) ? row.values : [];
      // Checked on the raw values, before flattening: `cellToPrimitive` would
      // turn the marker into `''` and hide the very thing we are looking for.
      if (values.some(isUnresolvedSharedString)) {
        throw new UnresolvedSharedStringsError();
      }
      if (headers.length === 0) {
        headers = readHeaderRow(values);
        continue;
      }
      rows.push(readDataRow(values, headers.length));
    }
  }

  return { headers, rows };
}

/** The correct-but-heavier path. Only reached for files small enough to afford it. */
async function readXlsxBuffered(path: string): Promise<VendorFileTable> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);

  const worksheet = workbook.worksheets[0];
  let headers: string[] = [];
  const rows: unknown[][] = [];
  if (!worksheet) return { headers, rows };

  worksheet.eachRow((row) => {
    const values: unknown[] = Array.isArray(row.values) ? row.values : [];
    if (headers.length === 0) {
      headers = readHeaderRow(values);
      return;
    }
    rows.push(readDataRow(values, headers.length));
  });

  return { headers, rows };
}

/**
 * `row.values` is 1-based with a hole at index 0 — an ExcelJS quirk, so that
 * `values[n]` is column n.
 */
function readHeaderRow(values: unknown[]): string[] {
  return trimTrailingEmpty(
    values.slice(1).map((cell) => String(cellToPrimitive(cell))),
  );
}

function readDataRow(values: unknown[], width: number): unknown[] {
  const cells: unknown[] = [];
  const end = Math.max(width, values.length - 1);
  for (let i = 1; i <= end; i += 1) {
    cells.push(cellToPrimitive(values[i]));
  }
  return cells;
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
