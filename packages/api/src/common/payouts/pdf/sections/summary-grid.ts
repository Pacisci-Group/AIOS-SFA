import type { PdfSummaryLine, StatementPdfModel } from '../statement-pdf-model';
import { COLORS, CONTENT_WIDTH, FONTS, LAYOUT, PAGE, SIZES } from '../theme';
import {
  box,
  drawLine,
  ensureSpace,
  sectionTitle,
  type Doc,
} from './primitives';

const COLUMN_GAP = 20;
const COLUMN_WIDTH = (CONTENT_WIDTH - COLUMN_GAP) / 2;
const VALUE_WIDTH = 108;
const VALUE_HEIGHT = 14;

const TONE_FILL: Record<PdfSummaryLine['tone'], string> = {
  plain: COLORS.white,
  credit: COLORS.credit,
  debit: COLORS.debit,
};

/**
 * The commission summary: commission and bonuses on the left; base pay,
 * SPIFFs and every deduction or adjustment on the right; and the NET PAY
 * box under them — net pay is base pay + stipend + net commission
 * (`statementNetPay`).
 */
export function drawCommissionSummary(
  doc: Doc,
  model: StatementPdfModel,
): void {
  const rows = Math.max(
    model.summaryLeft.length,
    model.summaryRight.length + 1,
  );
  ensureSpace(
    doc,
    LAYOUT.sectionTitleHeight + 2 + rows * LAYOUT.summaryRowHeight,
  );
  sectionTitle(doc, 'Commission summary');
  const top = doc.y;
  const leftX = PAGE.margins.left;
  const rightX = leftX + COLUMN_WIDTH + COLUMN_GAP;

  model.summaryLeft.forEach((line, index) =>
    summaryLine(doc, line, leftX, top + index * LAYOUT.summaryRowHeight),
  );
  model.summaryRight.forEach((line, index) =>
    summaryLine(doc, line, rightX, top + index * LAYOUT.summaryRowHeight),
  );

  // NET PAY, under the right column.
  const netY = top + model.summaryRight.length * LAYOUT.summaryRowHeight;
  const netHeight = VALUE_HEIGHT + 4;
  doc
    .save()
    .rect(rightX, netY, COLUMN_WIDTH, netHeight)
    .fill(COLORS.navy)
    .restore();
  drawLine(
    doc,
    'NET PAY',
    rightX + 8,
    netY + 5,
    COLUMN_WIDTH - VALUE_WIDTH - 16,
    {
      font: FONTS.bold,
      size: SIZES.value,
      color: COLORS.white,
      spacing: 0.3,
    },
  );
  const valueX = rightX + COLUMN_WIDTH - VALUE_WIDTH - 2;
  box(
    doc,
    valueX,
    netY + 2,
    VALUE_WIDTH,
    VALUE_HEIGHT,
    COLORS.white,
    COLORS.white,
  );
  drawLine(doc, model.netPay, valueX + 4, netY + 5.5, VALUE_WIDTH - 8, {
    font: FONTS.bold,
    size: SIZES.value,
    color: COLORS.navy,
    align: 'right',
  });

  doc.y = top + rows * LAYOUT.summaryRowHeight + LAYOUT.sectionGap;
}

function summaryLine(
  doc: Doc,
  line: PdfSummaryLine,
  x: number,
  y: number,
): void {
  drawLine(doc, line.label, x, y + 4, COLUMN_WIDTH - VALUE_WIDTH - 8, {
    size: SIZES.table,
    color: COLORS.muted,
  });
  const valueX = x + COLUMN_WIDTH - VALUE_WIDTH;
  box(doc, valueX, y, VALUE_WIDTH, VALUE_HEIGHT, TONE_FILL[line.tone]);
  drawLine(doc, line.amount, valueX + 4, y + 3.5, VALUE_WIDTH - 8, {
    size: SIZES.table,
    align: 'right',
  });
}
