import { COLORS, CONTENT_WIDTH, FONTS, LAYOUT, PAGE, SIZES } from '../theme';

/**
 * Drawing helpers shared by the sections (PAC-181). Every string is drawn
 * at an explicit position with an explicit `height`: pdfkit's line wrapper
 * never starts a page on its own when it has a height, so the only page
 * breaks are the ones `ensureSpace` and the table chunker make.
 */

export type Doc = PDFKit.PDFDocument;

export interface TextStyle {
  font?: string;
  size?: number;
  color?: string;
  align?: 'left' | 'center' | 'right';
  /** Letter spacing, for the upper-case labels. */
  spacing?: number;
  strike?: boolean;
}

/** The 1-based number of the page being drawn. */
export function currentPage(doc: Doc): number {
  const range = doc.bufferedPageRange();
  return range.start + range.count;
}

/** The lowest `y` content may reach on this page (the footer sits below). */
export function contentBottom(doc: Doc): number {
  return doc.page.maxY();
}

/** Start a new page when `height` does not fit below `doc.y`. */
export function ensureSpace(doc: Doc, height: number): boolean {
  if (doc.y + height <= contentBottom(doc)) return false;
  doc.addPage();
  doc.x = PAGE.margins.left;
  doc.y = PAGE.margins.top;
  return true;
}

/** `text`, cut with an ellipsis so it fits `width` on one line. */
export function fitted(doc: Doc, text: string, width: number): string {
  if (doc.widthOfString(text) <= width) return text;
  let cut = text;
  while (cut.length > 0 && doc.widthOfString(`${cut}…`) > width) {
    cut = cut.slice(0, -1).trimEnd();
  }
  return cut ? `${cut}…` : '';
}

/** One line of text in a `width`-wide slot at `(x, y)`. */
export function drawLine(
  doc: Doc,
  text: string,
  x: number,
  y: number,
  width: number,
  style: TextStyle = {},
): void {
  const size = style.size ?? SIZES.value;
  doc
    .font(style.font ?? FONTS.regular)
    .fontSize(size)
    .fillColor(style.color ?? COLORS.text);
  const shown = fitted(doc, text, width - (style.spacing ?? 0) * text.length);
  doc.text(shown, x, y, {
    width,
    height: size * 1.6,
    lineBreak: false,
    align: style.align ?? 'left',
    characterSpacing: style.spacing ?? 0,
    strike: style.strike ?? false,
  });
}

/** A section's upper-case title over the blue rule, and an optional caption on the right. */
export function sectionTitle(doc: Doc, title: string, caption?: string): void {
  const x = PAGE.margins.left;
  const y = doc.y;
  drawLine(doc, title.toUpperCase(), x, y, CONTENT_WIDTH, {
    font: FONTS.bold,
    size: SIZES.section,
    color: COLORS.navy,
    spacing: 0.2,
  });
  if (caption) {
    drawLine(doc, caption, x, y + 1.5, CONTENT_WIDTH, {
      font: 'Helvetica-Oblique',
      size: SIZES.label + 0.5,
      color: COLORS.muted,
      align: 'right',
    });
  }
  doc
    .save()
    .moveTo(x, y + LAYOUT.sectionTitleHeight - 3)
    .lineTo(x + CONTENT_WIDTH, y + LAYOUT.sectionTitleHeight - 3)
    .lineWidth(1)
    .strokeColor(COLORS.rule)
    .stroke()
    .restore();
  doc.y = y + LAYOUT.sectionTitleHeight + 2;
}

/** A small upper-case label. */
export function fieldLabel(
  doc: Doc,
  label: string,
  x: number,
  y: number,
  width: number,
): void {
  drawLine(doc, label.toUpperCase(), x, y, width, {
    font: FONTS.bold,
    size: SIZES.label,
    color: COLORS.muted,
    spacing: 0.3,
  });
}

/** A filled, bordered box. */
export function box(
  doc: Doc,
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string = COLORS.box,
  stroke: string = COLORS.border,
): void {
  doc
    .save()
    .rect(x, y, width, height)
    .lineWidth(0.6)
    .fillAndStroke(fill, stroke)
    .restore();
}

/** A labelled value box, the statement's field idiom. */
export function fieldBox(
  doc: Doc,
  label: string,
  value: string,
  x: number,
  y: number,
  width: number,
): void {
  fieldLabel(doc, label, x, y, width);
  const boxY = y + LAYOUT.fieldLabelHeight;
  box(doc, x, boxY, width, LAYOUT.fieldBoxHeight);
  drawLine(doc, value, x + 6, boxY + 5, width - 12, { size: SIZES.value });
}

/** A row of labelled boxes across the content width, `gap` apart. */
export function fieldRow(
  doc: Doc,
  fields: readonly { label: string; value: string }[],
  weights: readonly number[],
  gap = 10,
): void {
  const y = doc.y;
  const total = weights.reduce((sum, w) => sum + w, 0);
  const usable = CONTENT_WIDTH - gap * (fields.length - 1);
  let x = PAGE.margins.left;
  fields.forEach((field, index) => {
    const width = (usable * weights[index]) / total;
    fieldBox(doc, field.label, field.value, x, y, width);
    x += width + gap;
  });
  doc.y = y + LAYOUT.fieldLabelHeight + LAYOUT.fieldBoxHeight;
}
