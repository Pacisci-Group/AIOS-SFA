import { button, layout, muted, paragraph, type EmailBrand } from './layout';
import type { Template } from './template.types';

/**
 * What the notification email renders from (PAC-154, PR3).
 *
 * Declared here, like `MailerCampaignOutputData`, rather than derived from the
 * event: `notification/email.requested.v1` carries ids only, and
 * `SendNotificationEmailFn` assembles this from the **stored row** plus the
 * recipient's `User` and the agency's branding. The words are the row's own
 * `title`/`body`, rendered once at write time by the shared renderer, so the
 * email can never say something the in-app list does not.
 */
export interface NotificationEmailData {
  to: string;
  /** The recipient's first name, or null — never rendered as "Hi null". */
  recipientName: string | null;
  /** The row's rendered title. Doubles as the subject. */
  title: string;
  /** The row's rendered body. */
  body: string;
  /**
   * **Absolute** URL of the row's `href`, on the recipient's tenant host.
   *
   * The row stores a path (`/admin/bugs`); the function prefixes it through
   * `TenantUrlService.baseUrlFor(agencyId)` (AGENTS.md §11). A link on the
   * wrong host is not merely off-brand — `HostTenantGuard` refuses the
   * recipient there, so it is a broken link.
   */
  href: string;
  /** The agency's identity, or absent for a platform-level notification. */
  brand?: EmailBrand;
}

const THERE = 'there';

/** Preview-pane copy: the body, cut so the inbox row stays one line. */
function preheader(body: string): string {
  return body.length > 120 ? `${body.slice(0, 117).trimEnd()}…` : body;
}

/**
 * The one generic notification email.
 *
 * Deliberately plain: a heading, the body, one button. Per-type templates are
 * for when an email genuinely needs richer content than the row carries
 * (ticket: "only when an email genuinely needs richer content"), and none does
 * yet. The subject **is** the title so the inbox and the bell agree.
 */
export const notificationTemplate: Template<NotificationEmailData> = {
  key: 'notification',

  subject: (data) => data.title,

  render: (data) => {
    const recipient = data.recipientName ?? THERE;
    const brand = data.brand?.name ?? 'AgencyOps';

    const html = layout({
      brand: data.brand,
      preheader: preheader(data.body),
      body: [
        paragraph(`Hi ${recipient},`),
        paragraph(data.title),
        paragraph(data.body),
        button('View in the app', data.href),
        // Buttons are stripped or unclickable in a few clients, so the raw URL
        // is always present as a fallback.
        muted(
          `If the button does not work, paste this into your browser: ${data.href}`,
        ),
      ].join('\n'),
    });

    // The text part is where the images-off case ultimately lands, so the
    // link and the sender's identity have to be legible here with no markup.
    const text = [
      `Hi ${recipient},`,
      '',
      data.title,
      '',
      data.body,
      '',
      'View in the app:',
      data.href,
      '',
      `This is an automated message from ${brand}. Please do not reply to it.`,
    ].join('\n');

    return { html, text };
  },
};
