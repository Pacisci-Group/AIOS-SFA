/**
 * Escape a user-supplied string before embedding it in a `$regex`.
 *
 * Without this a search for `a.b` matches `axb`, and a search for `(` is a
 * Mongo syntax error surfacing as a 500. Extracted from `LeadsService` when
 * the platform user directory became its second caller.
 *
 * PAC-101 found **three more copies** hand-rolled at the call site — one named
 * `escapeRegExp` in `ClientsService`, and the same expression inline in
 * `MailerCampaignsService` (twice) and `MailerZipMarketsService`. All four now
 * import this. Reach for `tokenRegex` in `search-filter.ts` rather than this
 * directly when you are building a search box's filter; this stays for the
 * anchored and exact-key matches that are not tokenized.
 */
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
