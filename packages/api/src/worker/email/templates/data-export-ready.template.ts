import { button, layout, muted, paragraph, type EmailBrand } from './layout';
import type { Template } from './template.types';

/**
 * What the "your export is ready" email renders from (PAC-152). Assembled by
 * `DataExportGenerateFn` from the finished `dataExports` row.
 */
export interface DataExportReadyData {
  to: string;
  firstName: string | null;
  datasetLabel: string;
  /** `csv` or `xlsx`. */
  format: string;
  rowCount: number;
  bytes: number;
  /** The file stopped at the row cap because rows arrived after the request. */
  truncated: boolean;
  /** ISO instant the stored file is deleted. */
  expiresAt: string;
  /** The Data Export page on the agency's own host. */
  pageUrl: string;
  brand?: EmailBrand;
}

function count(value: number): string {
  return value.toLocaleString('en-US');
}

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Date and time with the zone spelled out — see `mailer-campaign-output.template.ts`. */
function formatExpiry(isoDateTime: string): string {
  return new Date(isoDateTime).toLocaleString('en-US', {
    timeZone: 'UTC',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

/**
 * "Your export is ready" — sent to whoever requested a Data Export once the
 * worker has stored the file (PAC-152).
 *
 * ## ⚠ No download link, on purpose
 *
 * Unlike the mailer campaign's completion notice, whose recipient is a printer
 * with no account, this goes to a signed-in user — and the file is a bulk copy
 * of the agency's contact details. A presigned URL in the mail would be a
 * bearer capability that survives forwarding. The button opens the Data Export
 * page instead, where the download is behind login, the data-export permission
 * and the history's visibility rule, and is counted when it happens.
 */
export const dataExportReadyTemplate: Template<DataExportReadyData> = {
  key: 'dataExportReady',

  subject: (data) => `Your ${data.datasetLabel} export is ready`,

  render: (data) => {
    const greeting = data.firstName ? `Hi ${data.firstName},` : 'Hello,';
    const what = `Your ${data.datasetLabel} export (${data.format.toUpperCase()}, ${count(data.rowCount)} rows, ${size(data.bytes)}) has finished and is ready to download from the Data Export page.`;
    const truncation = data.truncated
      ? 'More rows arrived after you requested it than the row limit allows, so the file stops at the limit. Narrow the date range and request it again for the rest.'
      : null;
    const expiry = `The file is kept until ${formatExpiry(data.expiresAt)}. After that, request it again.`;

    const html = layout({
      preheader: `${data.datasetLabel}: ${count(data.rowCount)} rows ready to download.`,
      brand: data.brand,
      body: [
        paragraph(greeting),
        paragraph(what),
        ...(truncation ? [paragraph(truncation)] : []),
        button('Open Data Export', data.pageUrl),
        muted(expiry),
        muted(
          `If the button does not work, paste this into your browser: ${data.pageUrl}`,
        ),
      ].join('\n'),
    });

    const text = [
      greeting,
      '',
      what,
      ...(truncation ? ['', truncation] : []),
      '',
      'Open Data Export:',
      data.pageUrl,
      '',
      expiry,
      '',
      `This is an automated message from ${data.brand?.name ?? 'AgencyOps'}. Please do not reply to it.`,
    ].join('\n');

    return { html, text };
  },
};
