/**
 * The shared HTML shell for every outbound email.
 *
 * ## Why this looks like 2005 HTML
 * Email clients are not browsers. Outlook renders through Word's engine, Gmail
 * strips `<style>` blocks and anything resembling modern CSS, and neither
 * supports flexbox, grid, or CSS custom properties. So: a centred `<table>`,
 * every style inlined on the element, and no external stylesheet. This is not
 * an oversight to be modernised — replacing it with the app's Tailwind tokens
 * would render as unstyled text in the two clients that matter most.
 *
 * Deliberately **light-only**. `prefers-color-scheme` support across clients is
 * inconsistent enough that a dark variant tends to produce unreadable
 * combinations (dark text force-inverted onto a dark panel) rather than a dark
 * theme. Explicit light colours render predictably everywhere.
 */

/** Allstate sky — the brand colour, matching `--primary` in the web app. */
const BRAND = '#0033A0';
const TEXT = '#1F2937';
const MUTED = '#6B7280';
const BORDER = '#E5E7EB';
const PAGE_BG = '#F3F4F6';

/**
 * Escape a value for interpolation into HTML.
 *
 * Every dynamic value in every template goes through this. Names and agency
 * names are user-supplied and reach us straight from the database, so an
 * apostrophe in "O'Brien" must not break the markup and a `<script>` in an
 * agency name must not survive into the recipient's client.
 */
export function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Who the message is from, visually.
 *
 * Carried on the event payload rather than looked up, because a template is a
 * pure function of its data — see `template.types.ts`. Optional throughout: an
 * event queued before white-labelling shipped arrives without it, and the
 * message must still render under the platform identity rather than throw.
 */
export interface EmailBrand {
  /** The agency's display name. Falls back to the platform wordmark. */
  name: string;
  /**
   * Absolute, publicly-fetchable logo URL, or `null`.
   *
   * Must be absolute and require no credentials: a mail client fetches it with
   * no cookies, from an IP we do not control. Built from the agency's own
   * primary host by `TenantUrlService`.
   */
  logoUrl: string | null;
}

const PLATFORM_BRAND: EmailBrand = { name: 'AgencyOps', logoUrl: null };

/**
 * The masthead: the agency's logo if there is one, otherwise its name as a
 * wordmark.
 *
 * ## The `alt` text is the real header, not a nicety
 * **Outlook and Gmail block remote images by default.** For a large share of
 * recipients the `<img>` never loads, and `alt` is the only thing identifying
 * who sent this. An empty or decorative `alt` here would produce an email whose
 * masthead is blank for the very audience most likely to be suspicious of it.
 *
 * `height` is set inline and the width left to scale, so a wide or tall logo
 * cannot blow out the 560px shell.
 */
function masthead(brand: EmailBrand): string {
  if (!brand.logoUrl) {
    return `<span style="font-size:18px;font-weight:700;color:${BRAND};">${esc(brand.name)}</span>`;
  }
  return `<img src="${esc(brand.logoUrl)}" alt="${esc(brand.name)}" height="32" style="height:32px;width:auto;max-width:240px;border:0;display:block;">`;
}

/** Wrap a template's body fragment in the shared shell. */
export function layout(options: {
  /** Shown in the preview pane before the body. Keep it short and specific. */
  preheader: string;
  body: string;
  /** Defaults to the platform identity when the event carried none. */
  brand?: EmailBrand;
}): string {
  const brand = options.brand ?? PLATFORM_BRAND;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(brand.name)}</title>
</head>
<body style="margin:0;padding:0;background:${PAGE_BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${TEXT};">
<!-- Preheader: shown in the inbox preview, hidden in the body itself. -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(options.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAGE_BG};padding:24px 12px;">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#FFFFFF;border:1px solid ${BORDER};border-radius:8px;">
        <tr>
          <td style="padding:24px 32px;border-bottom:1px solid ${BORDER};">
            ${masthead(brand)}
          </td>
        </tr>
        <tr>
          <td style="padding:32px;font-size:15px;line-height:1.6;">
${options.body}
          </td>
        </tr>
      </table>
      <p style="max-width:560px;margin:16px auto 0;font-size:12px;line-height:1.5;color:${MUTED};">
        This is an automated message from ${esc(brand.name)}. Please do not reply to it.
      </p>
    </td>
  </tr>
</table>
</body>
</html>`;
}

/** A primary call-to-action button. `label` and `url` are escaped for you. */
export function button(label: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
  <tr><td style="background:${BRAND};border-radius:6px;">
    <a href="${esc(url)}" style="display:inline-block;padding:12px 24px;font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;">${esc(label)}</a>
  </td></tr>
</table>`;
}

/** A paragraph of body copy. Escapes its content. */
export function paragraph(text: string): string {
  return `<p style="margin:0 0 16px;">${esc(text)}</p>`;
}

/** Small, muted text — expiry notes, fallback links. Escapes its content. */
export function muted(text: string): string {
  return `<p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:${MUTED};">${esc(text)}</p>`;
}
