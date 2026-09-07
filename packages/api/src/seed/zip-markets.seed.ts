import { readFileSync } from 'fs';
import { join } from 'path';
import { Model } from 'mongoose';
import { MailerZipMarket } from '../mailers/schemas/mailer-zip-market.schema';

/**
 * The platform-global ZIP → market table (PAC-71).
 *
 * ## Why this is core seed data, not demo data
 *
 * The mailer transform writes each row's market (`Right_Name`) and, from that,
 * the local-presence phone number printed on the piece. With an empty table
 * every ZIP falls to the default market and the whole file mails one phone
 * number — a silently wrong run rather than a failed one. It is tenant-agnostic
 * (`agencyId: null`), exactly like the carrier catalog.
 *
 * ## Where the list came from
 *
 * The 565 rows ApexReports keeps in a Google Sheet (`1EubGmhG4s…`), exported
 * once and committed. It is the same file `test/fixtures/mailers/zip-markets.csv`
 * holds for the processor spec; this copy lives under `src/` because the build
 * does not ship `test/` — see the `assets` entry in `nest-cli.json`.
 *
 * ## `$setOnInsert`, never `$set`
 *
 * An operator correcting a mapping in the panel must not have it silently
 * reverted by the next deploy's seed. The seed establishes a starting point; the
 * table is editable data from then on.
 */

/** One `zip,market` row, as the sheet exports it. */
interface ZipMarketRow {
  zip5: string;
  market: string;
}

export interface ZipMarketSeedResult {
  created: number;
  /** Already present — either seeded before, or edited since. Left alone. */
  existing: number;
  /** Rows the file carries that are not usable. See {@link parseZipMarketCsv}. */
  rejected: { zip: string; reason: string }[];
}

/**
 * Parse the committed CSV, rejecting anything that is not a usable mapping.
 *
 * Three findings in the real export, all reported rather than silently absorbed:
 *
 * ⚠ **A four-digit typo** — `4031,Tulsa`, sitting directly above the correct
 * `74031,Tulsa`. Stored, it would be a row that can never match an address and
 * still looks like a mapping; a "helpful" zero-pad would map `04031` (Freeport,
 * Maine) to Tulsa.
 *
 * ⚠ **A placeholder market** — `73554,Unknown`. See the guard below for why
 * that is worse than no row at all.
 *
 * ⚠ **Six ZIPs mapped to two different markets** — 74062, 74834, 74850, 74855,
 * 74864 and 74880 each appear once as `Tulsa` and again as `Oklahoma City`. The
 * market decides which local-presence phone number is printed on the piece, so
 * this is a real data question for whoever owns the sheet, not a formatting
 * nit. **First occurrence wins** (all six resolve to Tulsa) because it is
 * deterministic and re-runnable, and the conflict is reported with both values
 * so the answer can be corrected in the panel — which the `$setOnInsert` upsert
 * then leaves alone.
 *
 * Exported for its unit spec: the counts are the assertion, and a silent drop is
 * exactly the failure this guards.
 */
export function parseZipMarketCsv(contents: string): {
  rows: ZipMarketRow[];
  rejected: { zip: string; reason: string }[];
} {
  const rows: ZipMarketRow[] = [];
  const rejected: { zip: string; reason: string }[] = [];
  const seen = new Map<string, string>();

  const lines = contents.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // The header, whatever it is called. Checked by content rather than by
    // position so a re-export with a BOM or a reordered preamble still works.
    if (index === 0 && /^zip/i.test(trimmed)) continue;

    const [rawZip = '', ...rest] = trimmed.split(',');
    const zip = rawZip.trim();
    const market = rest.join(',').trim();

    if (!/^\d{5}$/.test(zip)) {
      rejected.push({ zip, reason: 'not a 5-digit ZIP' });
      continue;
    }
    if (!market) {
      rejected.push({ zip, reason: 'no market' });
      continue;
    }
    // ⚠ One row of the export says `73554,Unknown`. Stored, it would be a
    // *match* — so the preview's unmatched-ZIP resolver never surfaces it, the
    // operator is never asked, and the transform writes the literal string
    // "Unknown" into `Right_Name` on every piece mailed to that ZIP. Rejecting
    // it puts the ZIP back in front of a human, which is the whole point of the
    // resolver.
    if (/^unknown$/i.test(market)) {
      rejected.push({ zip, reason: 'market is literally "Unknown"' });
      continue;
    }
    // First wins. A repeat naming the *same* market is noise; one naming a
    // different market is the sheet contradicting itself, and the reason says
    // so — that difference is what a reader needs to decide whether to act.
    const previous = seen.get(zip);
    if (previous !== undefined) {
      rejected.push({
        zip,
        reason:
          previous === market
            ? 'duplicate ZIP'
            : `conflicting market (kept "${previous}", ignored "${market}")`,
      });
      continue;
    }
    seen.set(zip, market);
    rows.push({ zip5: zip, market });
  }

  return { rows, rejected };
}

export async function seedZipMarkets(
  model: Model<MailerZipMarket>,
): Promise<ZipMarketSeedResult> {
  const contents = readFileSync(
    join(__dirname, 'data', 'zip-markets.csv'),
    'utf8',
  );
  const { rows, rejected } = parseZipMarketCsv(contents);

  let created = 0;
  let existing = 0;

  for (const row of rows) {
    const result = await model.updateOne(
      { agencyId: null, zip5: row.zip5 },
      {
        // See the class note: a later correction is never reverted by a re-seed.
        $setOnInsert: {
          agencyId: null,
          zip5: row.zip5,
          market: row.market,
          source: 'seed',
          updatedBy: null,
        },
      },
      { upsert: true },
    );
    if (result.upsertedCount > 0) created += 1;
    else existing += 1;
  }

  return { created, existing, rejected };
}
