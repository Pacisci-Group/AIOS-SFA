/**
 * The Commission Statement's look (PAC-181), from the agency's layout
 * screenshots on the PAC-176 epic: a navy header band, light-grey field
 * boxes, navy table heads over zebra rows, and a navy net-pay box.
 *
 * **Always the light layout.** The PDF is a document people print and
 * file; it does not follow the app's theme.
 *
 * Fonts are pdfkit's built-in Helvetica pair, whose AFM metrics ship inside
 * pdfkit — no font files on the `node:22-alpine` image. Their encoding is
 * WinAnsi, which is why every string goes through `winAnsi` (`format.ts`).
 */
export const COLORS = {
  navy: '#1b2a5c',
  rule: '#5b7bd5',
  text: '#1f2937',
  muted: '#6b7280',
  white: '#ffffff',
  box: '#f4f6f9',
  border: '#dde2ea',
  zebra: '#f3f5f9',
  totalRow: '#e8ecf3',
  credit: '#eef7f1',
  debit: '#fdf0ef',
} as const;

export const FONTS = {
  regular: 'Helvetica',
  bold: 'Helvetica-Bold',
} as const;

export const SIZES = {
  title: 20,
  subtitle: 8.5,
  section: 9.5,
  label: 6.5,
  value: 8.5,
  table: 7.5,
  tableHead: 6.5,
  footer: 7,
} as const;

/** US Letter, portrait, in points. */
export const PAGE = {
  size: 'LETTER' as const,
  width: 612,
  height: 792,
  /** The bottom margin holds the footer, so content stops above it. */
  margins: { top: 36, left: 36, right: 36, bottom: 48 },
} as const;

export const CONTENT_WIDTH =
  PAGE.width - PAGE.margins.left - PAGE.margins.right;

export const LAYOUT = {
  bandHeight: 84,
  sectionGap: 10,
  /** A section title and its rule. */
  sectionTitleHeight: 15,
  fieldLabelHeight: 9,
  fieldBoxHeight: 18,
  tableHeadHeight: 15,
  tableRowHeight: 13,
  /**
   * An excluded chargeback: the row and its "Left out" note, at least. A
   * note that wraps makes the row taller (`fittedRowHeight`).
   */
  tableNoteRowHeight: 25,
  summaryRowHeight: 17,
  /** "Continued on the next page." under a table that breaks. */
  continuedHeight: 11,
  footerOffset: 30,
} as const;
