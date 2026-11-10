import PDFDocument from 'pdfkit';
import { drawAcknowledgment } from './sections/acknowledgment';
import { drawCarrierProduction } from './sections/carrier-table';
import { drawChargebackDetail } from './sections/chargeback-table';
import { drawDetails, drawIndicators } from './sections/details-boxes';
import { drawFooters } from './sections/footer';
import { drawHeaderBand } from './sections/header-band';
import { drawCommissionSummary } from './sections/summary-grid';
import type { StatementPdfModel } from './statement-pdf-model';
import { PAGE } from './theme';

export interface RenderedStatementPdf {
  buffer: Buffer;
  pageCount: number;
  /**
   * The 1-based pages that carried the chargeback table's header row — the
   * header repeats on every page the table continues onto.
   */
  chargebackHeaderPages: number[];
}

/**
 * The Commission Statement PDF (PAC-181), in the agency layout: the header
 * band, statement details, performance indicators, carrier production, the
 * commission summary, chargeback detail and the producer acknowledgment,
 * with "Page x of y" on every page. A typical month is one page; a long
 * chargeback list continues on the next.
 *
 * Pure: the model carries everything, including the logo's bytes, so the
 * API and (later) the worker render the same document.
 *
 * Always settles: a document that has not ended within `timeoutMs` rejects.
 * pdfkit finishes some images in a callback, and a document whose image
 * never finishes never ends (the logo is checked first, so this is only a
 * backstop).
 */
export const RENDER_TIMEOUT_MS = 15_000;

export function renderStatementPdf(
  model: StatementPdfModel,
  timeoutMs = RENDER_TIMEOUT_MS,
): Promise<RenderedStatementPdf> {
  return new Promise((resolveOnce, rejectOnce) => {
    let settled = false;
    const timer = setTimeout(() => {
      reject(
        new Error(`The statement PDF did not finish within ${timeoutMs} ms.`),
      );
    }, timeoutMs);
    const resolve = (value: RenderedStatementPdf) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveOnce(value);
    };
    const reject = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectOnce(error);
    };

    const doc = new PDFDocument({
      size: PAGE.size,
      margins: { ...PAGE.margins },
      bufferPages: true,
      info: {
        Title: model.title,
        Author: model.header.agencyName,
        Subject: 'Commission statement',
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('error', reject);

    let pageCount = 0;
    let chargebackHeaderPages: number[] = [];
    doc.on('end', () =>
      resolve({
        buffer: Buffer.concat(chunks),
        pageCount,
        chargebackHeaderPages,
      }),
    );

    try {
      drawHeaderBand(doc, model);
      drawDetails(doc, model);
      drawIndicators(doc, model);
      drawCarrierProduction(doc, model);
      drawCommissionSummary(doc, model);
      chargebackHeaderPages = drawChargebackDetail(doc, model);
      drawAcknowledgment(doc, model);
      drawFooters(doc, model);
      pageCount = doc.bufferedPageRange().count;
      doc.end();
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
