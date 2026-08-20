import type { InviteRequestedData } from '../../../inngest/events';
import { button, layout, muted, paragraph } from './layout';
import type { Template } from './template.types';

/** Fallbacks so a blank name never renders as "Hi ," or "null invited you". */
const SOMEONE = 'Someone';
const THERE = 'there';

/**
 * Render the expiry as a plain calendar date.
 *
 * The payload carries an ISO string rather than a `Date` (event schemas cannot
 * use transforms — see the catalog docblock), so parsing happens here. `en-US`
 * and UTC are pinned deliberately: the recipient's timezone is unknown, and a
 * date that silently shifts by one day depending on which server rendered it is
 * worse than one that is consistently UTC.
 */
function formatExpiry(isoDateTime: string): string {
  return new Date(isoDateTime).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export const inviteTemplate: Template<InviteRequestedData> = {
  key: 'invite',

  subject: (data) =>
    `${data.inviterName ?? SOMEONE} invited you to ${data.agencyName} on AgencyOps`,

  render: (data) => {
    const inviter = data.inviterName ?? SOMEONE;
    const recipient = data.recipientName ?? THERE;
    const roles = data.roleNames.join(', ') || 'no role yet';
    const expiry = formatExpiry(data.expiresAt);

    const html = layout({
      preheader: `${inviter} invited you to join ${data.agencyName}.`,
      body: [
        paragraph(`Hi ${recipient},`),
        paragraph(
          `${inviter} has invited you to join ${data.agencyName} on AgencyOps as ${roles}.`,
        ),
        paragraph('Set your password to get started.'),
        button('Set your password', data.inviteUrl),
        muted(`This link expires on ${expiry}.`),
        // Buttons are stripped or unclickable in a few clients, so the raw URL
        // is always present as a fallback. It is the only place the token
        // appears in the body, and it is never written to a log or the
        // delivery record.
        muted(
          `If the button does not work, paste this into your browser: ${data.inviteUrl}`,
        ),
      ].join('\n'),
    });

    const text = [
      `Hi ${recipient},`,
      '',
      `${inviter} has invited you to join ${data.agencyName} on AgencyOps as ${roles}.`,
      '',
      'Set your password to get started:',
      data.inviteUrl,
      '',
      `This link expires on ${expiry}.`,
      '',
      'This is an automated message from AgencyOps. Please do not reply to it.',
    ].join('\n');

    return { html, text };
  },
};
