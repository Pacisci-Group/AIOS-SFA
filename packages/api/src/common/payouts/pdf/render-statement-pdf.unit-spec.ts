import { writeFileSync } from 'fs';
import { join } from 'path';
import PDFDocument from 'pdfkit';
import { buildPng } from './__fixtures__/png';
import { chargebackRow, storedStatement } from './__fixtures__/statement';
import { sha256Hex } from './hash';
import { renderStatementPdf } from './render-statement-pdf';
import { chargebackNoteRowHeight } from './sections/chargeback-table';
import { MAX_ROW_HEIGHT } from './table';
import { LAYOUT } from './theme';
import {
  buildStatementPdfModel,
  type StatementForPdf,
  type StatementPdfContext,
} from './statement-pdf-model';

const ISSUED: StatementPdfContext = {
  agencyName: 'Smith Family Agency',
  logo: null,
  issue: { kind: 'issued', at: new Date('2026-11-06T15:00:00.000Z') },
};

/** Page dictionaries — never compressed, unlike the page contents. */
function pageObjects(pdf: Buffer): number {
  return (pdf.toString('latin1').match(/\/Type \/Page[^s]/g) ?? []).length;
}

/** `PDF_OUT_DIR=… npm run test:unit` writes the renders for a look. */
function keep(name: string, pdf: Buffer): void {
  const dir = process.env.PDF_OUT_DIR;
  if (dir) writeFileSync(join(dir, `${name}.pdf`), pdf);
}

async function render(statement: StatementForPdf, ctx = ISSUED) {
  return renderStatementPdf(buildStatementPdfModel(statement, ctx));
}

/** The smallest valid PNG: one white pixel. */
const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
  'base64',
);

describe('renderStatementPdf', () => {
  it('renders a typical month on one page', async () => {
    const pdf = await render(storedStatement());
    keep('typical', pdf.buffer);
    expect(pdf.buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.buffer.length).toBeGreaterThan(2000);
    expect(pdf.pageCount).toBe(1);
    expect(pageObjects(pdf.buffer)).toBe(1);
    expect(pdf.chargebackHeaderPages).toEqual([1]);
  });

  it('flows 40 chargebacks onto a second page with the header repeated', async () => {
    const pdf = await render(storedStatement({ chargebacks: 40 }));
    keep('forty-chargebacks', pdf.buffer);
    expect(pdf.pageCount).toBe(2);
    expect(pageObjects(pdf.buffer)).toBe(2);
    expect(pdf.chargebackHeaderPages).toEqual([1, 2]);
  });

  it('keeps going across more pages for a very long list', async () => {
    const pdf = await render(storedStatement({ chargebacks: 150 }));
    expect(pdf.pageCount).toBeGreaterThanOrEqual(3);
    expect(pdf.chargebackHeaderPages).toEqual(
      Array.from({ length: pdf.chargebackHeaderPages.length }, (_, i) => i + 1),
    );
  });

  it('renders a statement computed before the 2026 comp plans', async () => {
    const pdf = await render(storedStatement({ legacy: true }));
    keep('legacy', pdf.buffer);
    expect(pdf.pageCount).toBe(1);
  });

  it('renders no chargebacks, excluded ones, and a draft preview', async () => {
    const empty = await render(storedStatement({ chargebacks: 0 }));
    expect(empty.pageCount).toBe(1);
    expect(empty.chargebackHeaderPages).toEqual([]);

    const excluded = await render(
      storedStatement({
        chargebackRows: [
          chargebackRow(1),
          chargebackRow(2, {
            excluded: true,
            excludedNote: 'Rewritten in house',
          }),
        ],
      }),
      { ...ISSUED, issue: { kind: 'draft' } },
    );
    keep('draft-excluded', excluded.buffer);
    expect(excluded.pageCount).toBe(1);
  });

  it('embeds a PNG logo, and falls back when the bytes are not an image', async () => {
    const withLogo = await render(storedStatement(), {
      ...ISSUED,
      logo: { bytes: ONE_PIXEL_PNG, contentType: 'image/png' },
    });
    expect(withLogo.buffer.toString('latin1')).toContain('/Subtype /Image');

    const broken = await render(storedStatement(), {
      ...ISSUED,
      logo: { bytes: Buffer.from('<svg/>'), contentType: 'image/png' },
    });
    expect(broken.pageCount).toBe(1);
    expect(broken.buffer.toString('latin1')).not.toContain('/Subtype /Image');
  });

  // A "Left out: …" note sat in a fixed 25pt row and was cut with an
  // ellipsis on the permanent PDF; the row now grows to the wrapped note.
  describe('a long "Left out" note', () => {
    const LONG_NOTE =
      'Rewritten in house the same week with a new policy number, so the ' +
      'carrier charged the old one back while the customer never left; the ' +
      'manager confirmed it with the service team and the carrier rep.';

    it('gets a row tall enough to show all of it', () => {
      const doc = new PDFDocument({ size: 'LETTER' });
      const cells = (note: string) => [
        { text: 'Jordan Rivera', note: `Left out: ${note}` },
        { text: 'POL-1' },
        { text: 'Allstate' },
        { text: 'Auto' },
        { text: '($120.00)', strike: true },
      ];
      const short = chargebackNoteRowHeight(doc, cells('Rewritten'));
      const long = chargebackNoteRowHeight(doc, cells(LONG_NOTE));
      expect(short).toBe(LAYOUT.tableNoteRowHeight);
      // Four or more lines of 7.5pt text: far past the old fixed row.
      expect(long).toBeGreaterThan(LAYOUT.tableNoteRowHeight + 15);
      expect(long).toBeLessThanOrEqual(MAX_ROW_HEIGHT);
      expect(chargebackNoteRowHeight(doc, cells(LONG_NOTE.repeat(40)))).toBe(
        MAX_ROW_HEIGHT,
      );
    });

    it('keeps the table paging with its header repeated', async () => {
      const rows = Array.from({ length: 40 }, (_, i) =>
        chargebackRow(
          i + 1,
          i % 3 === 0 ? { excluded: true, excludedNote: LONG_NOTE } : {},
        ),
      );
      const pdf = await render(storedStatement({ chargebackRows: rows }));
      keep('long-notes', pdf.buffer);
      expect(pdf.pageCount).toBeGreaterThanOrEqual(2);
      expect(pageObjects(pdf.buffer)).toBe(pdf.pageCount);
      expect(pdf.chargebackHeaderPages).toEqual(
        Array.from(
          { length: pdf.chargebackHeaderPages.length },
          (_, i) => i + 1,
        ),
      );
      expect(pdf.chargebackHeaderPages.length).toBeGreaterThanOrEqual(2);
    });
  });

  // pdfkit decodes an RGBA PNG in a zlib callback: bad image data there threw
  // out of reach of any try/catch, crashed the process and left the render
  // pending for ever. The logo is now checked first and the name stands in.
  it('falls back to the name for an RGBA PNG whose image data is corrupt', async () => {
    const corrupt = buildPng({
      colorType: 6,
      idat: Buffer.from('this is not deflate data at all'),
    });
    const pdf = await render(storedStatement(), {
      ...ISSUED,
      logo: { bytes: corrupt, contentType: 'image/png' },
    });
    keep('corrupt-logo', pdf.buffer);
    expect(pdf.pageCount).toBe(1);
    expect(pdf.buffer.toString('latin1')).not.toContain('/Subtype /Image');
  });

  it('still embeds a valid RGBA PNG', async () => {
    const pdf = await render(storedStatement(), {
      ...ISSUED,
      logo: { bytes: buildPng({ colorType: 6 }), contentType: 'image/png' },
    });
    expect(pdf.buffer.toString('latin1')).toContain('/Subtype /Image');
  });

  it('is stable byte for byte apart from the creation date', async () => {
    const a = await render(storedStatement());
    expect(sha256Hex(a.buffer)).toMatch(/^[a-f0-9]{64}$/);
  });
});
