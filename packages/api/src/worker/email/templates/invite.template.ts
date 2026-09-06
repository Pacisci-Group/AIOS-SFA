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

/**
 * What to call the product in the body copy.
 *
 * White-labelled, so this is the agency's own name — "join Texas Holdings on
 * Texas Holdings" would be absurd, which is why the platform name only appears
 * when there is no agency brand to use. Falls back through the event's
 * `agencyName`, which every invite has carried since before branding existed.
 */
function brandName(data: InviteRequestedData): string {
  return data.brand?.name ?? data.agencyName;
}

/**
 * The one line that differs between the two invites.
 *
 * An **owner** invite (PAC-69) is sent by a platform operator the recipient has
 * never met — "Super Admin invited you to Acme Insurance" names a stranger from
 * another company, on the one email whose whole job is to look legitimate
 * enough to type a password into. It says what happened instead: the agency was
 * set up, and this account runs it.
 */
function invitationLine(data: InviteRequestedData): string {
  if (data.kind === 'owner') {
    return `${data.agencyName} has been set up on ${brandName(data)}, and this account is its owner.`;
  }
  const roles = data.roleNames.join(', ') || 'no role yet';
  return `${data.inviterName ?? SOMEONE} has invited you to join ${data.agencyName} as ${roles}.`;
}

export const inviteTemplate: Template<InviteRequestedData> = {
  key: 'invite',

  subject: (data) =>
    data.kind === 'owner'
      ? `Set up your ${data.agencyName} account`
      : `${data.inviterName ?? SOMEONE} invited you to ${data.agencyName}`,

  render: (data) => {
    const inviter = data.inviterName ?? SOMEONE;
    const recipient = data.recipientName ?? THERE;
    const expiry = formatExpiry(data.expiresAt);
    const brand = brandName(data);
    const invitation = invitationLine(data);
    const preheader =
      data.kind === 'owner'
        ? `Set your password to finish setting up ${data.agencyName}.`
        : `${inviter} invited you to join ${data.agencyName}.`;
    const callToAction =
      data.kind === 'owner'
        ? 'Set your password to finish setting up your agency.'
        : 'Set your password to get started.';

    const html = layout({
      brand: data.brand ?? undefined,
      preheader,
      body: [
        paragraph(`Hi ${recipient},`),
        paragraph(invitation),
        paragraph(callToAction),
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

    // The text part is where the images-off case ultimately lands, so the
    // sender's identity has to be legible here without any markup at all.
    const text = [
      `Hi ${recipient},`,
      '',
      invitation,
      '',
      `${callToAction.replace(/\.$/, '')}:`,
      data.inviteUrl,
      '',
      `This link expires on ${expiry}.`,
      '',
      `This is an automated message from ${brand}. Please do not reply to it.`,
    ].join('\n');

    return { html, text };
  },
};
