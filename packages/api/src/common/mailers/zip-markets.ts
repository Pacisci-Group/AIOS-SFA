/**
 * The ZIP → market table, folded into the lookup the transform takes (PAC-71).
 *
 * Replaces the Google Sheet ApexReports reads. The market decides the
 * local-presence phone number printed on the mail piece, so an unmapped ZIP is
 * not cosmetic — it mails the default market's number into a town that number
 * is not local to.
 *
 * ## Why this is a pure function in `common/`
 *
 * The rows are read by two callers that cannot share a service: the campaign
 * API (for the panel's table) and the worker's preview/commit jobs, which the
 * eslint boundary forbids from importing a feature service. Folding is the only
 * logic, and it must be identical on both sides — a preview that resolved a ZIP
 * differently from the commit would show the operator a market the mail piece
 * does not carry.
 */

/** One stored mapping, as either caller reads it back. */
export interface ZipMarketRow {
  /** `null` = platform-global. A string would be that agency's own override. */
  agencyId: string | null;
  zip5: string;
  market: string;
}

/**
 * Fold stored rows plus a campaign's own resolutions into one lookup.
 *
 * Three layers, lowest first:
 *
 * 1. **Global rows** (`agencyId: null`) — the seeded table.
 * 2. **Agency rows** — an agency's override of a global mapping. Nothing writes
 *    these yet (the table is platform-wide in this ticket); the layer exists so
 *    adding them later is not a change to how a run resolves.
 * 3. **The campaign's `settings.zipResolutions`** — what the operator answered
 *    in the preview. Highest, because it is the most recent human decision and
 *    the run must use exactly what they were shown.
 *
 * ⚠ Layer 2 is deliberately order-independent within itself: with several
 * agencies' overrides in the same list the result would depend on array order,
 * which is why the API only ever passes global rows today. When per-agency
 * overrides arrive they will need a campaign-level answer to "whose override
 * wins", and that decision belongs in the ticket that adds them.
 */
export function buildZipMarketTable(
  rows: readonly ZipMarketRow[],
  resolutions: Record<string, string> = {},
): Record<string, string> {
  const table: Record<string, string> = {};
  for (const row of rows) {
    if (row.agencyId === null) table[row.zip5] = row.market;
  }
  for (const row of rows) {
    if (row.agencyId !== null) table[row.zip5] = row.market;
  }
  for (const [zip5, market] of Object.entries(resolutions)) {
    // Trimmed and validated at the DTO; re-checked here because the worker
    // reads these straight off a stored campaign, which a migration or an
    // earlier version of the DTO could have written loosely.
    if (/^\d{5}$/.test(zip5) && market.trim()) table[zip5] = market.trim();
  }
  return table;
}
