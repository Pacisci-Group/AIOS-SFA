import type { DataExportColumnDescriptor } from '@sfa/shared';
import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { PassThrough } from 'stream';
import { createExportWriter } from './export-writer';

const columns: DataExportColumnDescriptor[] = [
  { key: 'policy_number', type: 'id', description: '' },
  { key: 'sold_date', type: 'date', description: '' },
  { key: 'premium', type: 'number', description: '' },
  { key: 'active', type: 'boolean', description: '' },
  { key: 'members', type: 'list', description: '' },
  { key: 'notes', type: 'string', description: '' },
];

const rows = [
  [
    '00123',
    new Date('2026-03-05T00:00:00.000Z'),
    1500.25,
    true,
    ['Ann, Jr.', 'Bo'],
    'said "hi"\nthen left',
  ],
  ['ABC9', null, -40, false, [], null],
];

async function capture(
  format: 'csv' | 'xlsx',
): Promise<{ buffer: Buffer; bytes: number }> {
  const sink = new PassThrough();
  const chunks: Buffer[] = [];
  sink.on('data', (chunk: Buffer) => chunks.push(chunk));
  const writer = createExportWriter(format, columns, 'Sold deals', sink);
  for (const row of rows) await writer.writeRow(row);
  await writer.end();
  return { buffer: Buffer.concat(chunks), bytes: writer.bytes };
}

describe('export writers', () => {
  it('writes CSV with a BOM, a header row, and quoting that round-trips', async () => {
    const { buffer, bytes } = await capture('csv');
    expect(buffer.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    expect(bytes).toBe(buffer.length);

    const records = parse(buffer, { bom: true }) as string[][];
    expect(records[0]).toEqual(columns.map((column) => column.key));
    expect(records[1]).toEqual([
      '00123',
      '2026-03-05',
      '1500.25',
      'true',
      'Ann, Jr.; Bo',
      'said "hi"\nthen left',
    ]);
    expect(records[2]).toEqual(['ABC9', '', '-40', 'false', '', '']);
  });

  it('writes XLSX with typed cells: text ids, real dates, real numbers', async () => {
    const { buffer, bytes } = await capture('xlsx');
    expect(bytes).toBe(buffer.length);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = workbook.getWorksheet('Sold deals')!;
    expect(sheet.getRow(1).values).toEqual([
      undefined,
      ...columns.map((column) => column.key),
    ]);

    const first = sheet.getRow(2);
    expect(first.getCell(1).value).toBe('00123');
    expect(first.getCell(2).value).toEqual(
      new Date('2026-03-05T00:00:00.000Z'),
    );
    expect(first.getCell(3).value).toBe(1500.25);
    expect(first.getCell(4).value).toBe(true);
    expect(first.getCell(5).value).toBe('Ann, Jr.; Bo');

    const second = sheet.getRow(3);
    expect(second.getCell(2).value).toBeNull();
    expect(second.getCell(3).value).toBe(-40);
  });
});
