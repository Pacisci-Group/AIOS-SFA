import { button, layout, muted, paragraph } from './layout';
import type { Template } from './template.types';

/**
 * What the completion email renders from.
 *
 * Declared here rather than derived from the event payload — unlike the invite
 * and reset templates, whose data *is* their event. The output-email event
 * carries a campaign id and a recipient list (ids, never documents: see
 * `mailer.events.ts`), so the numbers and the link below are assembled by the
 * function that loads the campaign. That keeps the template a pure function of
 * its data, which is the rule `template.types.ts` sets for all of them.
 */
export interface MailerCampaignOutputData {
  to: string;
  campaignName: string;
  /** `Week_Number-29`, or null for a campaign carrying no week tag. */
  campaignNumber: string | null;
  year: number | null;
  /** The print file's own name, e.g. `SFA-QBP.csv`. */
  fileName: string;
  /** Rows in the print file. */
  outputRows: number;
  /** Mailers now searchable by control number — created plus updated. */
  recordCount: number;
  /** Time-limited presigned link. A bearer capability — see the class note. */
  downloadUrl: string;
  downloadExpiresAt: string;
  /** The campaign page in the Super Admin panel. */
  detailUrl: string;
}

/**
 * Render the expiry as a date **and** a time, zone spelled out.
 *
 * The same choice `password-reset.template.ts` makes, for a different reason:
 * that link lasts hours, this one lasts a week — but it is the *only* copy of
 * the file the recipient has, and "expires on September 14" read on the 14th
 * does not say whether there is still time to fetch it.
 *
 * UTC is pinned because the recipient's timezone is unknown, and an expiry that
 * shifts depending on which server rendered it is worse than one that is
 * consistently UTC and says so.
 */
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

/** `20024` → `20,024`. Pinned to `en-US` for the same reason the date is. */
function count(value: number): string {
  return value.toLocaleString('en-US');
}

/** "Week 36 (Week_Number-36, 2026)" — whichever parts the campaign carries. */
function campaignLine(data: MailerCampaignOutputData): string {
  const parts = [
    data.campaignNumber,
    data.year === null ? null : `${data.year}`,
  ]
    .filter((part): part is string => Boolean(part))
    .join(', ');
  return parts ? `${data.campaignName} (${parts})` : data.campaignName;
}

/**
 * "Your mail file is ready" — the completion notice for a campaign run
 * (PAC-71).
 *
 * ## Why a link and not an attachment
 *
 * The print file is ~25 MB before base64 inflates it by a third, against
 * Resend's ~40 MB cap, and our transport has no attachment support at all
 * (`OutboundMessage` is `{to, from, replyTo, subject, html, text}`). A link is
 * also the better artifact: it survives being forwarded to the printer, and the
 * campaign page keeps working after it expires.
 *
 * ## ⚠ The link is a bearer capability
 *
 * Anyone holding the URL can fetch the file for as long as it is valid — no
 * login, no tenant check. That is the whole point (the printer has no account),
 * and it is why the copy says when it expires and points at the campaign page
 * as the durable path. The URL is **never** written to the delivery record:
 * `MailDeliveryService` stores a hash of the text body, not the body.
 *
 * ## Platform mail, not agency mail
 *
 * A campaign belongs to no tenant, so this renders under the platform identity
 * — no `brand`, and `MailerCampaignOutputEmailFn` passes a null `agencyId` so
 * the `From:` is ours rather than some agency's. It is the first template for
 * which that is true, which is why `EmailMessage.agencyId` is nullable.
 */
export const mailerCampaignOutputTemplate: Template<MailerCampaignOutputData> =
  {
    key: 'mailerCampaignOutput',

    subject: (data) => `Mail file ready: ${campaignLine(data)}`,

    render: (data) => {
      const expiry = formatExpiry(data.downloadExpiresAt);
      const heading = campaignLine(data);

      const html = layout({
        preheader: `${count(data.outputRows)} records ready to print.`,
        body: [
          paragraph(`${heading} has finished importing.`),
          paragraph(
            `The print file ${data.fileName} contains ${count(data.outputRows)} records, and ${count(data.recordCount)} mailers are now searchable by control number in the agencies this campaign is visible to.`,
          ),
          button('Download the print file', data.downloadUrl),
          muted(`This download link expires on ${expiry}.`),
          // Buttons are stripped or unclickable in a few clients, so the raw
          // URL is always present as a fallback. It is a capability, and it is
          // never written to a log or the delivery record.
          muted(
            `If the button does not work, paste this into your browser: ${data.downloadUrl}`,
          ),
          muted(
            `After that, download it again from the campaign page: ${data.detailUrl}`,
          ),
        ].join('\n'),
      });

      // The text part is where the images-off case ultimately lands, so both
      // URLs have to be legible here with no markup at all.
      const text = [
        `${heading} has finished importing.`,
        '',
        `The print file ${data.fileName} contains ${count(data.outputRows)} records,`,
        `and ${count(data.recordCount)} mailers are now searchable by control number`,
        'in the agencies this campaign is visible to.',
        '',
        'Download the print file:',
        data.downloadUrl,
        '',
        `This download link expires on ${expiry}. After that, download it again`,
        'from the campaign page:',
        data.detailUrl,
        '',
        'This is an automated message from AgencyOps. Please do not reply to it.',
      ].join('\n');

      return { html, text };
    },
  };
