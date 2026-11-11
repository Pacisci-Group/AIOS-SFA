import type { StatementPdfModel } from '../statement-pdf-model';
import { COLORS, CONTENT_WIDTH, FONTS, LAYOUT, PAGE, SIZES } from '../theme';
import {
  box,
  drawLine,
  ensureSpace,
  fieldBox,
  fieldLabel,
  sectionTitle,
  type Doc,
} from './primitives';

const CHECKBOX = 10;
const LINE_HEIGHT = 18;
const GAP = 10;
const NAME_WIDTH = 270;
const DATE_WIDTH = 110;
/** The Comments box beside Typed name and Date signed. */
const NOTES_WIDTH = CONTENT_WIDTH - NAME_WIDTH - DATE_WIDTH - GAP * 2;
const NOTES_PADDING = 5;
const NOTES_LINE_GAP = 1.5;

/** The signed copy's audit lines: who and when, the browser, the issued file's hash. */
export const AUDIT_LINES = 3;
const AUDIT_LINE_HEIGHT = 9;
/**
 * Kept free under the boxes on **every** render, signed or not, so the
 * issued and signed copies of a version break onto the same pages.
 */
export const AUDIT_HEIGHT = 4 + AUDIT_LINES * AUDIT_LINE_HEIGHT;

/**
 * The tallest the full-width notes box grows: the whole block must still fit
 * on a fresh page. Longer notes (2,000 line breaks) end in an ellipsis.
 */
const MAX_NOTES_HEIGHT =
  PAGE.height -
  PAGE.margins.top -
  PAGE.margins.bottom -
  (LAYOUT.sectionTitleHeight +
    2 +
    LINE_HEIGHT +
    LAYOUT.fieldLabelHeight +
    LAYOUT.fieldBoxHeight +
    6 +
    LAYOUT.fieldLabelHeight +
    AUDIT_HEIGHT +
    8);

/**
 * The producer acknowledgment: the checkbox and its sentence, then Typed
 * name / Signature, Date signed and Comments / Dispute notes. Empty on an
 * issued statement; filled on the signed copy (PAC-182) — the box ticked,
 * the typed name, the day — with the audit lines under it. A version sent
 * again over a dispute prints the dispute's notes in Comments: in the small
 * box when they fit on its one line, else in a full-width box that wraps.
 * Kept together on one page.
 */
export function drawAcknowledgment(doc: Doc, model: StatementPdfModel): void {
  const ack = model.acknowledgment;
  const notes = ack.comments ?? '';
  const wide = notes !== '' && !fitsOneLine(doc, notes, NOTES_WIDTH - 12);
  const notesHeight = wide ? notesBoxHeight(doc, notes) : 0;
  ensureSpace(
    doc,
    LAYOUT.sectionTitleHeight +
      2 +
      LINE_HEIGHT +
      LAYOUT.fieldLabelHeight +
      LAYOUT.fieldBoxHeight +
      (wide ? 6 + LAYOUT.fieldLabelHeight + notesHeight : 0) +
      AUDIT_HEIGHT,
  );
  sectionTitle(doc, 'Producer acknowledgment');
  const x = PAGE.margins.left;
  const y = doc.y;
  drawCheckbox(doc, x, y, ack.checked);
  drawLine(
    doc,
    ack.statement,
    x + CHECKBOX + 6,
    y + 1.5,
    CONTENT_WIDTH - CHECKBOX - 6,
    {
      size: SIZES.table,
    },
  );

  const fieldsY = y + LINE_HEIGHT;
  // Without the small Comments box, the name takes its room.
  const nameWidth = wide ? CONTENT_WIDTH - DATE_WIDTH - GAP : NAME_WIDTH;
  fieldBox(
    doc,
    'Typed name / Signature',
    ack.typedName ?? '',
    x,
    fieldsY,
    nameWidth,
    // A typed signature, set apart from the printed fields.
    { font: 'Helvetica-Oblique', size: SIZES.value + 1 },
  );
  fieldBox(
    doc,
    'Date signed',
    ack.dateSigned ?? '',
    x + nameWidth + GAP,
    fieldsY,
    DATE_WIDTH,
  );
  if (!wide) {
    fieldBox(
      doc,
      'Comments / Dispute notes',
      notes,
      x + NAME_WIDTH + DATE_WIDTH + GAP * 2,
      fieldsY,
      NOTES_WIDTH,
    );
  }
  let bottom = fieldsY + LAYOUT.fieldLabelHeight + LAYOUT.fieldBoxHeight;

  if (wide) {
    const labelY = bottom + 6;
    fieldLabel(doc, 'Comments / Dispute notes', x, labelY, CONTENT_WIDTH);
    const boxY = labelY + LAYOUT.fieldLabelHeight;
    box(doc, x, boxY, CONTENT_WIDTH, notesHeight);
    doc
      .font(FONTS.regular)
      .fontSize(SIZES.value)
      .fillColor(COLORS.text)
      .text(notes, x + 6, boxY + NOTES_PADDING, {
        width: CONTENT_WIDTH - 12,
        // An explicit height: pdfkit never starts a page inside it.
        height: notesHeight - NOTES_PADDING * 2,
        lineGap: NOTES_LINE_GAP,
        ellipsis: true,
      });
    bottom = boxY + notesHeight;
  }

  const auditY = bottom + 4;
  (ack.audit ?? []).slice(0, AUDIT_LINES).forEach((line, index) => {
    drawLine(doc, line, x, auditY + index * AUDIT_LINE_HEIGHT, CONTENT_WIDTH, {
      size: SIZES.label,
      color: COLORS.muted,
    });
  });
  doc.y = bottom + AUDIT_HEIGHT;
}

/** The box, ticked on a signed copy — drawn, since WinAnsi has no check mark. */
function drawCheckbox(doc: Doc, x: number, y: number, checked: boolean): void {
  doc
    .save()
    .rect(x, y, CHECKBOX, CHECKBOX)
    .lineWidth(0.8)
    .strokeColor(COLORS.navy)
    .stroke()
    .restore();
  if (!checked) return;
  doc
    .save()
    .moveTo(x + 2, y + 5.2)
    .lineTo(x + 4.2, y + 7.6)
    .lineTo(x + 8.2, y + 2.4)
    .lineWidth(1.4)
    .lineCap('round')
    .lineJoin('round')
    .strokeColor(COLORS.navy)
    .stroke()
    .restore();
}

function fitsOneLine(doc: Doc, text: string, width: number): boolean {
  if (text.includes('\n')) return false;
  doc.font(FONTS.regular).fontSize(SIZES.value);
  return doc.widthOfString(text) <= width;
}

/** The full-width notes box's height: the wrapped notes, capped. */
export function notesBoxHeight(doc: Doc, notes: string): number {
  doc.font(FONTS.regular).fontSize(SIZES.value);
  const text = doc.heightOfString(notes, {
    width: CONTENT_WIDTH - 12,
    lineGap: NOTES_LINE_GAP,
  });
  return Math.min(
    Math.max(LAYOUT.fieldBoxHeight, Math.ceil(text) + NOTES_PADDING * 2),
    MAX_NOTES_HEIGHT,
  );
}
