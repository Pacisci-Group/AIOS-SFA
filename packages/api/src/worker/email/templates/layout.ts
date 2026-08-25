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

/** Wrap a template's body fragment in the shared shell. */
export function layout(options: {
  /** Shown in the preview pane before the body. Keep it short and specific. */
  preheader: string;
  body: string;
}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AgencyOps</title>
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
            <span style="font-size:18px;font-weight:700;color:${BRAND};">AgencyOps</span>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;font-size:15px;line-height:1.6;">
${options.body}
          </td>
        </tr>
      </table>
      <p style="max-width:560px;margin:16px auto 0;font-size:12px;line-height:1.5;color:${MUTED};">
        This is an automated message from AgencyOps. Please do not reply to it.
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
