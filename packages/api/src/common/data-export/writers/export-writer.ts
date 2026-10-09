import type { DataExportColumnDescriptor, DataExportFormat } from '@sfa/shared';
import { stringify, type Stringifier } from 'csv-stringify';
import ExcelJS from 'exceljs';
import { once } from 'events';
import { Transform, type TransformCallback, type Writable } from 'stream';
import type { CellValue } from '../engine/dataset.types';
import { csvCell, xlsxCell } from '../engine/cells';

/**
 * Writes one export to a stream, one row at a time.
 *
 * Both formats are driven by the same column list and the same `pick`
 * values; each column's `type` decides the encoding (`cells.ts`), so a value
 * cannot be a date in one format and text in the other.
 */
export interface ExportWriter {
  readonly contentType: string;
  readonly extension: string;
  writeRow(values: readonly CellValue[]): Promise<void>;
  /** Flushes and resolves once every byte has been handed to the sink. */
  end(): Promise<void>;
  /** Bytes written so far. */
  readonly bytes: number;
  /** Tears the internal streams down after a failure or a dropped client. */
  abort(): void;
}

/** Counts what passes through it — the export log records the size. */
class ByteCounter extends Transform {
  bytes = 0;

  _transform(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    this.bytes += Buffer.byteLength(chunk);
    callback(null, chunk);
  }
}

/**
 * Keeps an internal stream's error from becoming an uncaught exception. A
 * client that hangs up mid-download makes the pipe into the response error;
 * the service already learns of that from the response itself, and an
 * unhandled `'error'` would take the whole API process down with it.
 */
function contain(stream: NodeJS.EventEmitter): void {
  stream.on('error', () => undefined);
}

/** Resolves when `stream` can take more, rejecting if it errors first. */
async function drained(stream: Writable): Promise<void> {
  await once(stream, 'drain');
}

/**
 * CSV: UTF-8 **with a BOM**, so a double-clicked file opens in Excel with its
 * accents intact (Alteryx reads a BOM'd file without complaint).
 *
 * ⚠ **No formula escaping**, deliberately. Prefixing cells that start with
 * `=`/`+`/`-`/`@` would corrupt the very values the data team joins on — a
 * negative chargeback adjustment, a `+1` phone. Spreadsheet users are offered
 * XLSX, whose cells are typed and never evaluated.
 */
class CsvExportWriter implements ExportWriter {
  readonly contentType = 'text/csv; charset=utf-8';
  readonly extension = 'csv';
  private readonly counter = new ByteCounter();
  private readonly stringifier: Stringifier;

  constructor(
    private readonly columns: readonly DataExportColumnDescriptor[],
    sink: Writable,
  ) {
    this.stringifier = stringify({
      bom: true,
      header: true,
      columns: columns.map((column) => column.key),
    });
    contain(this.stringifier);
    contain(this.counter);
    this.stringifier.pipe(this.counter).pipe(sink);
  }

  abort(): void {
    this.stringifier.destroy();
    this.counter.destroy();
  }

  get bytes(): number {
    return this.counter.bytes;
  }

  async writeRow(values: readonly CellValue[]): Promise<void> {
    const record = this.columns.map((column, index) =>
      csvCell(values[index], column.type),
    );
    if (!this.stringifier.write(record)) await drained(this.stringifier);
  }

  async end(): Promise<void> {
    const done = once(this.counter, 'end');
    this.stringifier.end();
    await done;
  }
}

/** Number formats for the typed XLSX columns. */
const XLSX_FORMATS: Partial<
  Record<DataExportColumnDescriptor['type'], string>
> = {
  date: 'yyyy-mm-dd',
  datetime: 'yyyy-mm-dd hh:mm:ss',
  // Text format on ids, so Excel never re-reads `00123` as the number 123.
  id: '@',
};

/**
 * XLSX through exceljs's **streaming** writer: rows are committed as they are
 * written, so memory stays flat however long the sheet is. Dates are real date
 * cells (UTC — Excel has no zone, and the dictionary says so), numbers are
 * numbers, ids are text.
 */
class XlsxExportWriter implements ExportWriter {
  readonly contentType =
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  readonly extension = 'xlsx';
  private readonly counter = new ByteCounter();
  private readonly workbook: ExcelJS.stream.xlsx.WorkbookWriter;
  private readonly sheet: ExcelJS.Worksheet;
  private readonly finished: Promise<unknown>;

  constructor(
    private readonly columns: readonly DataExportColumnDescriptor[],
    sheetName: string,
    sink: Writable,
  ) {
    contain(this.counter);
    this.counter.pipe(sink);
    this.finished = once(this.counter, 'end');
    this.workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream: this.counter,
      useStyles: true,
      useSharedStrings: false,
    });
    // Sheet names are capped at 31 characters and may not contain []:*?/\.
    this.sheet = this.workbook.addWorksheet(
      sheetName.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31) || 'Export',
      { views: [{ state: 'frozen', ySplit: 1 }] },
    );
    this.sheet.columns = columns.map((column) => ({
      header: column.key,
      key: column.key,
      width: Math.min(Math.max(column.key.length + 2, 12), 40),
      style: XLSX_FORMATS[column.type]
        ? { numFmt: XLSX_FORMATS[column.type] }
        : {},
    }));
    this.sheet.getRow(1).font = { bold: true };
    this.sheet.getRow(1).commit();
  }

  get bytes(): number {
    return this.counter.bytes;
  }

  async writeRow(values: readonly CellValue[]): Promise<void> {
    const row = this.sheet.addRow(
      this.columns.map((column, index) => xlsxCell(values[index], column.type)),
    );
    row.commit();
    if (this.counter.writableNeedDrain) await drained(this.counter);
  }

  abort(): void {
    this.counter.destroy();
  }

  async end(): Promise<void> {
    this.sheet.commit();
    await this.workbook.commit();
    await this.finished;
  }
}

export function createExportWriter(
  format: DataExportFormat,
  columns: readonly DataExportColumnDescriptor[],
  sheetName: string,
  sink: Writable,
): ExportWriter {
  return format === 'xlsx'
    ? new XlsxExportWriter(columns, sheetName, sink)
    : new CsvExportWriter(columns, sink);
}
