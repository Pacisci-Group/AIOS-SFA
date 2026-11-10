import type { StatementPdfModel } from '../statement-pdf-model';
import { LAYOUT } from '../theme';
import { fieldRow, sectionTitle, type Doc } from './primitives';

/** Statement details: producer, period, producer ID, statement ID, date. */
export function drawDetails(doc: Doc, model: StatementPdfModel): void {
  sectionTitle(doc, 'Statement details');
  fieldRow(doc, model.details, [1.7, 1.1, 0.9, 1.1, 1.0]);
  doc.y += LAYOUT.sectionGap;
}

/** Performance indicators: tier, bundle rate, hat tricks, SOM, compliance. */
export function drawIndicators(doc: Doc, model: StatementPdfModel): void {
  sectionTitle(doc, 'Performance indicators');
  fieldRow(doc, model.indicators, [1.1, 0.9, 0.8, 1.0, 1.6]);
  doc.y += LAYOUT.sectionGap;
}
