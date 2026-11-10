import type { StatementPdfModel } from '../statement-pdf-model';
import { drawTable, type TableColumn } from '../table';
import { COLORS, CONTENT_WIDTH, LAYOUT, PAGE, SIZES } from '../theme';
import { drawLine, sectionTitle, type Doc } from './primitives';

const COLUMNS: TableColumn[] = [
  { header: 'Carrier', width: 196 },
  { header: 'Rate', width: 72 },
  { header: 'Sold premium', width: 92, align: 'right' },
  { header: 'Chargebacks', width: 90, align: 'right' },
  { header: 'Net commission', width: 90, align: 'right' },
];

const NOTE_HEIGHT = 10;

/**
 * Carrier production: every carrier the agency is appointed with (zero rows
 * included), then any other with sales or chargebacks; a lead-source rate's
 * sales on a line of their own; the rate, with the step a stepped rate was
 * paid at; a TOTAL row; and a note for each carrier below its minimum
 * bundle rate (a flag — pay is not changed).
 */
export function drawCarrierProduction(
  doc: Doc,
  model: StatementPdfModel,
): void {
  sectionTitle(doc, 'Carrier production');
  const rows = [
    ...model.carrierRows.map((row) => ({
      cells: [
        { text: row.carrier },
        { text: row.rate },
        { text: row.soldPremium },
        { text: row.chargebacks },
        { text: row.netCommission },
      ],
    })),
    {
      fill: COLORS.totalRow,
      cells: [
        { text: model.carrierTotal.carrier.toUpperCase(), bold: true },
        { text: '' },
        { text: model.carrierTotal.soldPremium, bold: true },
        { text: model.carrierTotal.chargebacks, bold: true },
        { text: model.carrierTotal.netCommission, bold: true },
      ],
    },
  ];
  drawTable(doc, {
    columns: COLUMNS,
    rows,
    after: model.carrierNotes.length * NOTE_HEIGHT + 4,
    onContinue: (d) => sectionTitle(d, 'Carrier production (continued)'),
  });
  doc.y += 3;
  for (const note of model.carrierNotes) {
    drawLine(doc, note, PAGE.margins.left, doc.y, CONTENT_WIDTH, {
      size: SIZES.label + 0.5,
      color: COLORS.muted,
    });
    doc.y += NOTE_HEIGHT;
  }
  doc.y += LAYOUT.sectionGap;
}
