import { COLORS, CONTENT_WIDTH, FONTS, LAYOUT, PAGE, SIZES } from './theme';
import {
  contentBottom,
  currentPage,
  drawLine,
  type Doc,
} from './sections/primitives';

/**
 * A table that may run onto further pages, **with its header row repeated
 * on each** (PAC-181 acceptance: "40 chargebacks flow onto a second page
 * with the table header repeated").
 *
 * pdfkit's `doc.table()` moves a row that does not fit onto a new page, but
 * it never repeats a header. So the rows are cut into page-sized chunks here
 * and each chunk is drawn with its own header; pdfkit is never asked to
 * break a page. Every row's height is decided before it is drawn (a row
 * with a note is sized to it by `fittedRowHeight`), which makes a chunk's
 * height known in advance.
 */

export interface TableColumn {
  header: string;
  width: number;
  align?: 'left' | 'right';
}

export interface TableCell {
  text: string;
  /** A second, muted line under the text (the row must be a note row). */
  note?: string | null;
  bold?: boolean;
  muted?: boolean;
  strike?: boolean;
}

export interface TableRow {
  cells: TableCell[];
  /** A row with a note: `fittedRowHeight`; else the default. */
  height?: number;
  fill?: string;
}

/** Each cell's padding; its text gets the column width less left and right. */
export const CELL_PADDING = { top: 3, bottom: 2, left: 6, right: 6 } as const;

/**
 * The tallest a row may be: what fits on a fresh page under a section title,
 * the header row and "Continued on the next page.". Text past it is cut
 * with an ellipsis rather than overflow the page.
 */
export const MAX_ROW_HEIGHT =
  PAGE.height -
  PAGE.margins.top -
  PAGE.margins.bottom -
  LAYOUT.sectionTitleHeight -
  LAYOUT.tableHeadHeight -
  LAYOUT.continuedHeight -
  24;

/**
 * The height a row needs for every cell's text to show whole, wrapped to its
 * column (pdfkit cuts a cell's text with an ellipsis where it does not fit):
 * at least `minimum`, at most `MAX_ROW_HEIGHT`.
 */
export function fittedRowHeight(
  doc: Doc,
  columns: readonly TableColumn[],
  cells: readonly TableCell[],
  minimum: number,
): number {
  let needed = minimum;
  cells.forEach((cell, index) => {
    const column = columns[index];
    if (!column) return;
    doc.font(cell.bold ? FONTS.bold : FONTS.regular).fontSize(SIZES.table);
    const textHeight = doc.heightOfString(cellText(cell), {
      width: column.width - CELL_PADDING.left - CELL_PADDING.right,
    });
    needed = Math.max(
      needed,
      Math.ceil(textHeight + CELL_PADDING.top + CELL_PADDING.bottom),
    );
  });
  return Math.min(needed, MAX_ROW_HEIGHT);
}

function cellText(cell: TableCell): string {
  return cell.note ? `${cell.text}\n${cell.note}` : cell.text;
}

export interface DrawTableOptions {
  columns: readonly TableColumn[];
  rows: readonly TableRow[];
  /** Space kept free under the last row (a total box, a note). */
  after?: number;
  /** Drawn at the top of each page the table continues onto. */
  onContinue?: (doc: Doc) => void;
}

/** @returns the 1-based pages that carried the table's header row. */
export function drawTable(doc: Doc, options: DrawTableOptions): number[] {
  const { columns, rows } = options;
  const after = options.after ?? 0;
  const headerPages: number[] = [];
  const heightOf = (row: TableRow) => row.height ?? LAYOUT.tableRowHeight;
  let index = 0;
  let first = true;
  let freshPage = false;

  while (index < rows.length || first) {
    const available = contentBottom(doc) - doc.y;
    // How many of the remaining rows fit under a header on this page…
    let fit = 0;
    let used = LAYOUT.tableHeadHeight;
    while (
      index + fit < rows.length &&
      used + heightOf(rows[index + fit]) <=
        available - (index + fit + 1 < rows.length ? LAYOUT.continuedHeight : 0)
    ) {
      used += heightOf(rows[index + fit]);
      fit += 1;
    }
    const last = index + fit >= rows.length;
    // …and the final chunk must leave room for what follows the table. A
    // chunk that cannot is shortened by one row, so the total never sits on
    // a page of its own.
    if (last && fit > 0 && used + after > available) {
      fit -= 1;
    }
    if (fit === 0 && rows.length > 0) {
      // A row taller than a whole page cannot happen at these heights; never
      // loop on it.
      if (freshPage) {
        fit = 1;
      } else {
        newPage(doc, options);
        freshPage = true;
        continue;
      }
    }
    first = false;
    freshPage = false;

    headerPages.push(currentPage(doc));
    const chunk = rows.slice(index, index + fit);
    drawChunk(doc, columns, chunk);
    index += fit;

    if (index < rows.length) {
      drawLine(
        doc,
        'Continued on the next page.',
        PAGE.margins.left,
        doc.y + 2,
        CONTENT_WIDTH,
        { size: SIZES.label + 0.5, color: COLORS.muted, align: 'right' },
      );
      newPage(doc, options);
      freshPage = true;
    }
  }
  return headerPages;
}

function newPage(doc: Doc, options: DrawTableOptions): void {
  doc.addPage();
  doc.x = PAGE.margins.left;
  doc.y = PAGE.margins.top;
  options.onContinue?.(doc);
}

function drawChunk(
  doc: Doc,
  columns: readonly TableColumn[],
  rows: readonly TableRow[],
): void {
  const x = PAGE.margins.left;
  const y = doc.y;
  type Cell = PDFKit.Mixins.CellOptions;
  const header = columns.map((column): Cell => ({
    text: column.header.toUpperCase(),
    backgroundColor: COLORS.navy,
    textColor: COLORS.white,
    font: { src: FONTS.bold, size: SIZES.tableHead },
    align: { x: column.align ?? 'left', y: 'center' },
  }));
  const body = rows.map((row, rowIndex) =>
    row.cells.map((cell, columnIndex): Cell => {
      const column = columns[columnIndex];
      return {
        text: cellText(cell),
        backgroundColor:
          row.fill ?? (rowIndex % 2 === 1 ? COLORS.zebra : COLORS.white),
        textColor: cell.muted ? COLORS.muted : COLORS.text,
        font: {
          src: cell.bold ? FONTS.bold : FONTS.regular,
          size: SIZES.table,
        },
        align: {
          x: column.align ?? 'left',
          y: cell.note ? 'top' : 'center',
        },
        textOptions: { strike: cell.strike ?? false },
      };
    }),
  );
  const heights = [
    LAYOUT.tableHeadHeight,
    ...rows.map((row) => row.height ?? LAYOUT.tableRowHeight),
  ];
  doc.table({
    position: { x, y },
    maxWidth: CONTENT_WIDTH,
    columnStyles: columns.map((column) => column.width),
    rowStyles: (i: number) => ({ height: heights[i] }),
    defaultStyle: {
      border: 0.5,
      borderColor: COLORS.border,
      padding: { ...CELL_PADDING },
    },
    data: [header, ...body],
  });
  doc.x = x;
  doc.y = y + heights.reduce((sum, h) => sum + h, 0);
}
