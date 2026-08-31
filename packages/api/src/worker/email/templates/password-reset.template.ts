import type { PasswordResetRequestedData } from '../../../inngest/events';
import { button, layout, muted, paragraph } from './layout';
import type { Template } from './template.types';

/** Fallback so a blank name never renders as "Hi ,". */
const THERE = 'there';

/**
 * Render the expiry as a date **and a time**, with the zone spelled out.
 *
 * Deliberately unlike `invite.template.ts`'s `formatExpiry`, which renders a
 * bare calendar date. That is fine for a link that lasts a week; this one lasts
 * hours, and "expires on August 30" read on the morning of August 30 tells the
 * recipient nothing about whether they have ten minutes or ten hours.
 *
 * UTC is pinned for the same reason it is there: the recipient's timezone is
 * unknown, and an expiry that shifts depending on which server rendered it is
 * worse than one that is consistently UTC and says so.
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

/**
 * The "an administrator reset your password" email (PAC-79).
 *
 * ## Why it does not name who triggered it
 * The invite template opens with "{inviterName} has invited you", and the
 * symmetric line here would be "{ownerName} reset your password". The payload
 * deliberately does not carry a name: it would be reassuring to the recipient
 * and equally useful to someone deciding whose voice to use on the follow-up
 * call. Naming the *agency* gives the recipient what they actually need — that
 * this mail came from somewhere they recognise — without handing over a target.
 *
 * ## Why it says the current password still works
 * This email arrives unprompted at an account that already exists and has data
 * in it. Without that line, a recipient who was not expecting it has no way to
 * tell it from a phishing attempt, and the safe-looking reaction — click the
 * link to "check" — is the one that costs them if it ever really is phishing.
 */
export const passwordResetTemplate: Template<PasswordResetRequestedData> = {
  key: 'passwordReset',

  subject: (data) => `Reset your ${data.agencyName} password on AgencyOps`,

  render: (data) => {
    const recipient = data.recipientName ?? THERE;
    const expiry = formatExpiry(data.expiresAt);

    const html = layout({
      preheader: `Set a new password for your ${data.agencyName} account.`,
      body: [
        paragraph(`Hi ${recipient},`),
        paragraph(
          `An administrator at ${data.agencyName} requested a password reset for your AgencyOps account.`,
        ),
        button('Set a new password', data.resetUrl),
        muted(`This link expires on ${expiry} and can only be used once.`),
        // Buttons are stripped or unclickable in a few clients, so the raw URL
        // is always present as a fallback. It is the only place the token
        // appears in the body, and it is never written to a log or the
        // delivery record.
        muted(
          `If the button does not work, paste this into your browser: ${data.resetUrl}`,
        ),
        muted(
          'If you were not expecting this, you can ignore this email — your current password still works until you use the link above. Contact your agency administrator if you have any concerns.',
        ),
      ].join('\n'),
    });

    const text = [
      `Hi ${recipient},`,
      '',
      `An administrator at ${data.agencyName} requested a password reset for your AgencyOps account.`,
      '',
      'Set a new password:',
      data.resetUrl,
      '',
      `This link expires on ${expiry} and can only be used once.`,
      '',
      'If you were not expecting this, you can ignore this email — your current',
      'password still works until you use the link above. Contact your agency',
      'administrator if you have any concerns.',
      '',
      'This is an automated message from AgencyOps. Please do not reply to it.',
    ].join('\n');

    return { html, text };
  },
};
