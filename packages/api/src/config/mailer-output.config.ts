/**
 * How long the mailer campaign's emailed download link stays valid (PAC-71).
 *
 * Read through `ConfigService` at call time, like `invite.config.ts`, so the
 * value works from the repo `.env` rather than needing a real environment
 * variable.
 *
 * ## Why this is not `STORAGE_DOWNLOAD_URL_TTL_SECONDS`
 *
 * That default is five minutes, which is right for a link minted the moment a
 * user clicks. This one **travels**: it goes into an inbox the recipient may
 * not open until tomorrow, and a dead link inside an already-delivered email
 * cannot be refreshed — the operator would have to notice and re-send.
 *
 * ⚠ The presigned URL *is* the capability. A longer TTL is a longer window in
 * which a forwarded mail hands the print file to whoever received it. Seven days
 * is the deliberate trade, and the campaign detail page's own download (five
 * minutes, minted on click) remains the path for anyone who should be
 * authenticated.
 */

/**
 * Seven days — and also the ceiling, not a coincidence.
 *
 * AWS SigV4 presigned URLs cannot be signed for longer than 604800 seconds; the
 * SDK signs a longer one happily and the provider then rejects every request to
 * it. A misconfigured value would therefore produce a link that looks right in
 * the email and 403s when clicked, so {@link mailerOutputLinkTtlSeconds} clamps
 * rather than trusting the environment.
 */
export const MAX_MAILER_OUTPUT_LINK_TTL_SECONDS = 604_800;

/** The default: the full seven days SigV4 allows. */
export const DEFAULT_MAILER_OUTPUT_LINK_TTL_SECONDS =
  MAX_MAILER_OUTPUT_LINK_TTL_SECONDS;

/** A minute is the shortest value that is not simply a broken link. */
const MIN_MAILER_OUTPUT_LINK_TTL_SECONDS = 60;

export function mailerOutputLinkTtlSeconds(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_MAILER_OUTPUT_LINK_TTL_SECONDS;
  }
  return Math.min(
    Math.max(parsed, MIN_MAILER_OUTPUT_LINK_TTL_SECONDS),
    MAX_MAILER_OUTPUT_LINK_TTL_SECONDS,
  );
}
