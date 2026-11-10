import { usableLogo } from '../probe-logo';
import type { StatementPdfModel } from '../statement-pdf-model';
import { COLORS, FONTS, LAYOUT, PAGE, SIZES } from '../theme';
import { drawLine, type Doc } from './primitives';

const LOGO_BOX = { width: 64, height: 48 };
const RIGHT_BLOCK_WIDTH = 190;

/**
 * The navy band: the agency's logo, "COMMISSION STATEMENT" and its
 * subtitle, and on the right the agency's name and CONFIDENTIAL.
 *
 * Only PNG and JPEG logos are drawn (all pdfkit can embed). An SVG or WebP
 * logo, none at all, or one pdfkit refuses (a CMYK JPEG, a 16-bit PNG) falls
 * back to the agency's name, which the band's right side always prints.
 * A PNG is decoded by `usableLogo` first: pdfkit decodes some PNGs in a
 * callback, where a failure escapes the try/catch below.
 */
export function drawHeaderBand(doc: Doc, model: StatementPdfModel): void {
  doc
    .save()
    .rect(0, 0, PAGE.width, LAYOUT.bandHeight)
    .fill(COLORS.navy)
    .restore();

  let titleX: number = PAGE.margins.left;
  const logo = usableLogo(model.header.logo);
  if (logo) {
    try {
      doc.image(
        logo.bytes,
        PAGE.margins.left,
        (LAYOUT.bandHeight - LOGO_BOX.height) / 2,
        {
          fit: [LOGO_BOX.width, LOGO_BOX.height],
          align: 'center',
          valign: 'center',
        },
      );
      titleX = PAGE.margins.left + LOGO_BOX.width + 14;
    } catch {
      // Unreadable by pdfkit: the agency's name on the right stands in.
    }
  }

  const rightX = PAGE.width - PAGE.margins.right - RIGHT_BLOCK_WIDTH;
  const titleWidth = rightX - titleX - 12;
  drawLine(doc, 'COMMISSION STATEMENT', titleX, 24, titleWidth, {
    font: FONTS.bold,
    size: SIZES.title,
    color: COLORS.white,
  });
  drawLine(
    doc,
    'Producer compensation detail and acknowledgment',
    titleX,
    50,
    titleWidth,
    { size: SIZES.subtitle, color: '#d7ddeb' },
  );
  drawLine(
    doc,
    model.header.agencyName.toUpperCase(),
    rightX,
    28,
    RIGHT_BLOCK_WIDTH,
    {
      font: FONTS.bold,
      size: SIZES.value,
      color: COLORS.white,
      align: 'right',
      spacing: 0.3,
    },
  );
  drawLine(doc, 'CONFIDENTIAL', rightX, 44, RIGHT_BLOCK_WIDTH, {
    font: FONTS.bold,
    size: SIZES.label + 0.5,
    color: '#d7ddeb',
    align: 'right',
    spacing: 0.6,
  });

  doc.x = PAGE.margins.left;
  doc.y = LAYOUT.bandHeight + 16;
}
