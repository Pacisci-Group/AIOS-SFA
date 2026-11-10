import type { StatementPdfModel } from '../statement-pdf-model';
import { COLORS, CONTENT_WIDTH, LAYOUT, PAGE, SIZES } from '../theme';
import {
  drawLine,
  ensureSpace,
  fieldBox,
  sectionTitle,
  type Doc,
} from './primitives';

const CHECKBOX = 10;
const LINE_HEIGHT = 18;

/**
 * The producer acknowledgment: the checkbox and its sentence, then Typed
 * name / Signature, Date signed and Comments / Dispute notes. Empty on an
 * issued statement; the employee's sign-off (PAC-182) fills a signed copy.
 * Kept together on one page.
 */
export function drawAcknowledgment(doc: Doc, model: StatementPdfModel): void {
  ensureSpace(
    doc,
    LAYOUT.sectionTitleHeight +
      2 +
      LINE_HEIGHT +
      LAYOUT.fieldLabelHeight +
      LAYOUT.fieldBoxHeight +
      4,
  );
  sectionTitle(doc, 'Producer acknowledgment');
  const x = PAGE.margins.left;
  const y = doc.y;
  const ack = model.acknowledgment;
  doc
    .save()
    .rect(x, y, CHECKBOX, CHECKBOX)
    .lineWidth(0.8)
    .strokeColor(COLORS.navy)
    .stroke()
    .restore();
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
  const gap = 10;
  const nameWidth = 270;
  const dateWidth = 110;
  const notesWidth = CONTENT_WIDTH - nameWidth - dateWidth - gap * 2;
  fieldBox(
    doc,
    'Typed name / Signature',
    ack.typedName ?? '',
    x,
    fieldsY,
    nameWidth,
  );
  fieldBox(
    doc,
    'Date signed',
    ack.dateSigned ?? '',
    x + nameWidth + gap,
    fieldsY,
    dateWidth,
  );
  fieldBox(
    doc,
    'Comments / Dispute notes',
    ack.comments ?? '',
    x + nameWidth + dateWidth + gap * 2,
    fieldsY,
    notesWidth,
  );
  doc.y = fieldsY + LAYOUT.fieldLabelHeight + LAYOUT.fieldBoxHeight;
}
