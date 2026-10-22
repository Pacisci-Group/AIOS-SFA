import { Readable } from 'stream';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { DEFAULT_MAILER_DISCOUNTS } from './mailer-processor';
import { processMailerFile } from './mailer-processor';
import type { MailerProcessorSettings } from './mailer-processor';
import {
  cellToPrimitive,
  detectVendorFileKind,
  readVendorFile,
  writeVendorCsv,
} from './vendor-file-reader';

/**
 * The reader's contract is an **equivalence**, not a shape (PAC-71).
 *
 * The print file is compared byte for byte against what Alteryx produced, and
 * the transform that builds it was proven against a CSV fixture. So the only
 * thing worth asserting about the XLSX path is that it is indistinguishable from
 * the CSV one: the same data, in the two formats, must drive
 * `processMailerFile` to the same output. A test that merely checked "the
 * reader returns rows" would pass while `quotedate` arrived as
 * `Wed Jul 13 2026` and mailed the wrong date to 20,000 households.
 */

/** A miniature vendor file: the columns the transform actually prices. */
const HEADERS = [
  'controlno',
  'firstname',
  'lastname',
  'address',
  'city',
  'state',
  'zip',
  'squarefeet',
  'yearbuilt',
  'yearlyprem',
  'totalpremi',
  'quotedate',
  'pst_seq',
  'agencyid',
];

/**
 * `quotedate` as the CSV carries it — an Excel serial, 2026-07-13.
 *
 * The XLSX fixture below writes the same instant as a real `Date` cell, which is
 * the divergence `cellToPrimitive` exists to close.
 */
const QUOTE_SERIAL = 46216;
const QUOTE_DATE = new Date(Date.UTC(2026, 6, 13));

/** Values as strings — what `csv-parse` yields for every cell. */
const ROWS: string[][] = [
  [
    '#d3d00000-aaaa-aaaa-f00d-0000bbbbbbbb',
    'Ada',
    'Lovelace',
    '1 Analytical Way',
    'Tulsa',
    'OK',
    '74133-1234',
    '2600',
    '2001',
    '$2,260.53',
    '$2,260.53',
    String(QUOTE_SERIAL),
    '2',
    'A0B9049',
  ],
  [
    '#c0ffee00-1111-2222-3333-444455556666',
    'Grace',
    'Hopper',
    '2 Compiler Road',
    'Norman',
    'OK',
    '73071',
    '1200',
    '1974',
    '$1,900.00',
    '$1,900.00',
    String(QUOTE_SERIAL),
    '1',
    'A0B9049',
  ],
];

const SETTINGS: MailerProcessorSettings = {
  campaignNumber: '29',
  fileName: 'SFA-QBP',
  premiumFloor: 1886.15,
  zipMarkets: { '74133': 'Tulsa', '73071': 'Oklahoma City' },
  defaultMarket: 'Oklahoma City',
  marketPhones: { Tulsa: '918-984-6163' },
  defaultPhone: '405-803-7590',
  runYear: 2026,
  discounts: DEFAULT_MAILER_DISCOUNTS,
};

/** The same data as a CSV file, built the way the fixture is. */
function csvBytes(): Buffer {
  const lines = [HEADERS, ...ROWS].map((row) =>
    row.map((cell) => (/[",]/.test(cell) ? `"${cell}"` : cell)).join(','),
  );
  return Buffer.from(`${lines.join('\r\n')}\r\n`, 'utf8');
}

/**
 * The same data as a real XLSX, exercising every cell model the reader has to
 * flatten: a `Date`, a rich-text run, a formula with a cached result, a numeric
 * cell, and trailing blanks past the last real column.
 */
async function xlsxBytes(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Sheet1');
  sheet.addRow([...HEADERS, '', '']);

  ROWS.forEach((row, index) => {
    const cells: unknown[] = [...row];
    // `quotedate` as a real date cell, not the serial string.
    cells[HEADERS.indexOf('quotedate')] = QUOTE_DATE;
    // Numbers as numbers, the way Excel actually stores them.
    cells[HEADERS.indexOf('squarefeet')] = Number(
      row[HEADERS.indexOf('squarefeet')],
    );
    cells[HEADERS.indexOf('pst_seq')] = Number(row[HEADERS.indexOf('pst_seq')]);
    if (index === 0) {
      // Rich text: what a cell someone hand-edited in Excel looks like.
      cells[HEADERS.indexOf('city')] = {
        richText: [{ text: 'Tul' }, { font: { bold: true }, text: 'sa' }],
      };
      // A formula whose cached result is the value that matters.
      cells[HEADERS.indexOf('state')] = {
        formula: 'UPPER("ok")',
        result: 'OK',
      };
    }
    sheet.addRow([...cells, null, null]);
  });

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

const SPREADSHEETML =
  'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

/**
 * The same workbook as .NET's OpenXML SDK writes it: the SpreadsheetML
 * namespace bound to `x:` instead of the default, so every tag is `<x:row>`,
 * `<x:c>`, `<x:si>`. Valid OOXML — and the form that read as "empty" under
 * ExcelJS, which is why the reader is SheetJS (PAC-150). Tags already in
 * another namespace (`mc:`, `x14ac:`) keep their own prefix, as they do in
 * the real file. The fixture is still *built* with ExcelJS, which writes the
 * Excel form; this rewrites it into the OpenXML-SDK form.
 */
async function prefixedXlsxBytes(): Promise<Buffer> {
  const zip = await JSZip.loadAsync(await xlsxBytes());
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || !entry.name.endsWith('.xml')) continue;
    const xml = await entry.async('string');
    if (!xml.includes(`xmlns="${SPREADSHEETML}"`)) continue;
    zip.file(
      entry.name,
      xml
        .replace(`xmlns="${SPREADSHEETML}"`, `xmlns:x="${SPREADSHEETML}"`)
        .replace(/<(\/?)([A-Za-z]\w*)(?=[\s/>])/g, '<$1x:$2'),
    );
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

describe('detectVendorFileKind', () => {
  it('trusts magic bytes over the filename and the content type', () => {
    const zipHead = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
    expect(
      detectVendorFileKind({
        filename: 'SFA-QBP.csv',
        contentType: 'text/csv',
        head: zipHead,
      }),
    ).toBe('xlsx');
  });

  it('falls back to the extension, then the content type, then CSV', () => {
    expect(detectVendorFileKind({ filename: 'SFA-QBP.xlsx' })).toBe('xlsx');
    expect(detectVendorFileKind({ filename: 'rtp.CSV' })).toBe('csv');
    expect(
      detectVendorFileKind({
        filename: 'download',
        contentType: 'application/zip',
      }),
    ).toBe('xlsx');
    expect(detectVendorFileKind({ filename: 'download' })).toBe('csv');
  });
});

describe('cellToPrimitive', () => {
  it('turns a Date back into the Excel serial the CSV path carries', () => {
    expect(cellToPrimitive({ t: 'd', v: QUOTE_DATE })).toBe(QUOTE_SERIAL);
  });

  it('passes strings, numbers and booleans through untouched', () => {
    expect(cellToPrimitive({ t: 's', v: 'Oklahoma' })).toBe('Oklahoma');
    expect(cellToPrimitive({ t: 'n', v: 42 })).toBe(42);
    expect(cellToPrimitive({ t: 'b', v: true })).toBe(true);
    // A formula cell is its cached result; the formula text is not data.
    expect(cellToPrimitive({ t: 'n', v: 42, f: 'A1+A2' })).toBe(42);
  });

  it('reads an error, a blank stub and a missing cell as empty', () => {
    // SheetJS carries the error as a numeric code with `#N/A` in `w`; neither
    // is a value a mail piece can carry.
    expect(cellToPrimitive({ t: 'e', v: 42, w: '#N/A' })).toBe('');
    expect(cellToPrimitive({ t: 'z' })).toBe('');
    expect(cellToPrimitive(undefined)).toBe('');
  });
});

describe('readVendorFile', () => {
  it('reads a CSV into positional rows', async () => {
    const table = await readVendorFile(Readable.from(csvBytes()), 'csv');
    expect(table.headers).toEqual(HEADERS);
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0][HEADERS.indexOf('firstname')]).toBe('Ada');
  });

  it('drops trailing empty header columns from an XLSX', async () => {
    const table = await readVendorFile(
      Readable.from(await xlsxBytes()),
      'xlsx',
    );
    expect(table.headers).toEqual(HEADERS);
  });

  it('reads a namespace-prefixed XLSX exactly as Excel’s own', async () => {
    const prefixed = await prefixedXlsxBytes();
    // Guard the fixture: it must really carry the prefix it claims to.
    const sheet = await (
      await JSZip.loadAsync(prefixed)
    )
      .file('xl/worksheets/sheet1.xml')!
      .async('string');
    expect(sheet).toContain('<x:row');

    const fromPrefixed = await readVendorFile(Readable.from(prefixed), 'xlsx');
    const fromExcel = await readVendorFile(
      Readable.from(await xlsxBytes()),
      'xlsx',
    );
    expect(fromPrefixed).toEqual(fromExcel);
    expect(fromPrefixed.rows).toHaveLength(2);
  });

  it('refuses an empty file rather than importing nothing', async () => {
    await expect(
      readVendorFile(Readable.from(Buffer.from('', 'utf8')), 'csv'),
    ).rejects.toThrow(/no header row/i);
  });

  /**
   * ⚠ The assertion the whole module exists for.
   *
   * Same data, two formats, one transform output — headers, every derived
   * column, and the stats. If this ever fails, the print file for an XLSX
   * campaign differs from the one Alteryx would have produced.
   */
  it('produces the same processed file from XLSX as from CSV', async () => {
    const fromCsv = await readVendorFile(Readable.from(csvBytes()), 'csv');
    const fromXlsx = await readVendorFile(
      Readable.from(await xlsxBytes()),
      'xlsx',
    );

    const csvOut = processMailerFile(fromCsv.headers, fromCsv.rows, SETTINGS);
    const xlsxOut = processMailerFile(
      fromXlsx.headers,
      fromXlsx.rows,
      SETTINGS,
    );

    expect(xlsxOut.headers).toEqual(csvOut.headers);
    expect(xlsxOut.stats).toEqual(csvOut.stats);
    // Cell by cell, as strings: the XLSX path legitimately carries a number
    // where the CSV path carries its decimal form, and the print file is text.
    expect(xlsxOut.rows.map((row) => row.map(String))).toEqual(
      csvOut.rows.map((row) => row.map(String)),
    );
  });
});

describe('writeVendorCsv', () => {
  it('round-trips through the reader', async () => {
    const table = await readVendorFile(Readable.from(csvBytes()), 'csv');
    const out = processMailerFile(table.headers, table.rows, SETTINGS);

    const bytes = writeVendorCsv(out.headers, out.rows);
    const reread = await readVendorFile(Readable.from(bytes), 'csv');

    expect(reread.headers).toEqual(out.headers);
    expect(reread.rows.map((row) => row.map(String))).toEqual(
      out.rows.map((row) => row.map(String)),
    );
  });

  it('writes an empty field for a missing value, never "null"', () => {
    const csv = writeVendorCsv(['a', 'b'], [[null, undefined]]).toString(
      'utf8',
    );
    expect(csv.trim().split('\n')[1].trim()).toBe(',');
  });
});
