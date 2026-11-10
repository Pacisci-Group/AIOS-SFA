import type { StatementPdfModel } from '../statement-pdf-model';
import {
  drawTable,
  fittedRowHeight,
  type TableCell,
  type TableColumn,
  type TableRow,
} from '../table';
import { COLORS, CONTENT_WIDTH, FONTS, LAYOUT, PAGE, SIZES } from '../theme';
import {
  box,
  drawLine,
  ensureSpace,
  sectionTitle,
  type Doc,
} from './primitives';

/** The amount column's header comes from the model (`chargebackAmountHeader`). */
function columns(amountHeader: string): TableColumn[] {
  return [
    { header: 'Customer', width: 170 },
    { header: 'Policy number', width: 100 },
    { header: 'Carrier', width: 90 },
    { header: 'Policy type', width: 80 },
    { header: amountHeader, width: 100, align: 'right' },
  ];
}
/** Widths only: what row heights are measured against. */
const COLUMNS = columns('');

const TOTAL_HEIGHT = 18;
const TOTAL_VALUE_WIDTH = 100;

/** A row carrying a note: two lines at least, more when the note wraps. */
export function chargebackNoteRowHeight(
  doc: Doc,
  cells: readonly TableCell[],
): number {
  return fittedRowHeight(doc, COLUMNS, cells, LAYOUT.tableNoteRowHeight);
}

/**
 * Chargeback detail: each chargeback and the premium charged back (on a
 * statement calculated before 10 Nov 2026, the commission it cost), excluded
 * ones struck through with the manager's note. A long list continues on the
 * next page with the header row repeated; the total box always follows the
 * last row.
 *
 * @returns the 1-based pages that carried the table's header row.
 */
export function drawChargebackDetail(
  doc: Doc,
  model: StatementPdfModel,
): number[] {
  // The title, the header and at least one row go together.
  ensureSpace(
    doc,
    LAYOUT.sectionTitleHeight +
      2 +
      LAYOUT.tableHeadHeight +
      LAYOUT.tableRowHeight,
  );
  sectionTitle(doc, 'Chargeback detail');

  let headerPages: number[] = [];
  if (model.chargebackRows.length === 0) {
    drawLine(
      doc,
      model.chargebackEmpty,
      PAGE.margins.left,
      doc.y + 2,
      CONTENT_WIDTH,
      {
        size: SIZES.table,
        color: COLORS.muted,
      },
    );
    doc.y += 16;
  } else {
    const rows: TableRow[] = model.chargebackRows.map((row) => {
      const cells: TableCell[] = [
        { text: row.customer, note: row.note, muted: row.excluded },
        { text: row.policyNumber, muted: row.excluded },
        { text: row.carrier, muted: row.excluded },
        { text: row.policyType, muted: row.excluded },
        { text: row.deduction, muted: row.excluded, strike: row.excluded },
      ];
      // The "Left out: …" note is on a permanent document: the row grows
      // to show all of it.
      return {
        height: row.note ? chargebackNoteRowHeight(doc, cells) : undefined,
        cells,
      };
    });
    headerPages = drawTable(doc, {
      columns: columns(model.chargebackAmountHeader),
      rows,
      after: TOTAL_HEIGHT + 6,
      onContinue: (d) => sectionTitle(d, 'Chargeback detail (continued)'),
    });
    doc.y += 4;
  }

  ensureSpace(doc, TOTAL_HEIGHT);
  const y = doc.y;
  const valueX = PAGE.margins.left + CONTENT_WIDTH - TOTAL_VALUE_WIDTH;
  drawLine(
    doc,
    model.chargebackTotalLabel,
    PAGE.margins.left,
    y + 5,
    CONTENT_WIDTH - TOTAL_VALUE_WIDTH - 10,
    {
      font: FONTS.bold,
      size: SIZES.tableHead + 0.5,
      color: COLORS.text,
      align: 'right',
      spacing: 0.3,
    },
  );
  box(doc, valueX, y, TOTAL_VALUE_WIDTH, TOTAL_HEIGHT - 2, COLORS.debit);
  drawLine(
    doc,
    model.chargebackTotal,
    valueX + 4,
    y + 4.5,
    TOTAL_VALUE_WIDTH - 8,
    {
      font: FONTS.bold,
      size: SIZES.table,
      align: 'right',
    },
  );
  doc.y = y + TOTAL_HEIGHT + LAYOUT.sectionGap;
  return headerPages;
}
