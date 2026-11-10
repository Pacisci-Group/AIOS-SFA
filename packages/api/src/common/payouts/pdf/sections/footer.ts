import type { StatementPdfModel } from '../statement-pdf-model';
import { COLORS, CONTENT_WIDTH, LAYOUT, PAGE, SIZES } from '../theme';
import { drawLine, type Doc } from './primitives';

/**
 * "<Agency> | Commission Statement" and "Page x of y" on every page, drawn
 * once the page count is known (`bufferPages`). The footer sits in the
 * bottom margin, so the margin is lifted while it is drawn.
 */
export function drawFooters(doc: Doc, model: StatementPdfModel): void {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = PAGE.height - LAYOUT.footerOffset;
    const style = { size: SIZES.footer, color: COLORS.muted };
    drawLine(
      doc,
      model.footerLeft,
      PAGE.margins.left,
      y,
      CONTENT_WIDTH / 2,
      style,
    );
    drawLine(
      doc,
      `Page ${i - range.start + 1} of ${range.count}`,
      PAGE.margins.left + CONTENT_WIDTH / 2,
      y,
      CONTENT_WIDTH / 2,
      { ...style, align: 'right' },
    );
    doc.page.margins.bottom = bottom;
  }
}
