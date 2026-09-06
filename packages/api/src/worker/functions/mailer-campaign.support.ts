import type { Readable } from 'stream';
import { BLANK_CARRIER_CODE } from '../../common/mailers/campaign-assignment';
import {
  detectVendorFileKind,
  readVendorFile,
  type VendorFileTable,
} from '../../common/mailers/vendor-file-reader';
import { normalizeHeader } from '../../common/mailers/mailer-row.mapper';
import {
  buildZipMarketTable,
  type ZipMarketRow,
} from '../../common/mailers/zip-markets';
import { appointmentCodeKey } from '@sfa/shared';

/**
 * Plumbing shared by the campaign preview and commit jobs (PAC-71).
 *
 * The two jobs must agree exactly — a preview that counted rows or resolved a
 * ZIP differently from the commit that follows it would show the operator
 * numbers the run does not honour, which is the one failure the whole
 * preview/commit split exists to prevent. Anything both of them do lives here.
 */

/**
 * The slice of Inngest's step tooling these handlers use.
 *
 * Narrow on purpose: it is the seam a test substitutes, and depending on the
 * full step API would make that substitution a chore for no benefit. Same seam
 * `SendInviteEmailFn` uses.
 */
export interface StepLike {
  /**
   * Returns `unknown` rather than `T` because Inngest returns `Jsonify<T>` — a
   * step's result is serialised to JSON and parsed back before the next step
   * sees it. Callers narrow with a cast they can justify.
   *
   * ⚠ That is a constraint on what a step may **return**, not a quirk: put a
   * `Date` in a step result and the next step receives a string, and put 20,000
   * rows in one and Inngest memoizes all of them on every retry.
   */
  run<T>(id: string, fn: () => Promise<T> | T): Promise<unknown>;
}

/** What a campaign's stored file looks like to a worker job. */
export interface CampaignFileRef {
  storageKey: string;
  name: string;
  contentType?: string;
}

/** The subset of `StorageService` these jobs use. Structural, for testability. */
export interface CampaignStorage {
  getObjectStream(key: string): Promise<Readable>;
  putObject(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<{ key: string; size: number }>;
}

/**
 * Read a campaign's uploaded file into `{headers, rows}`.
 *
 * The file kind is settled from the name and the recorded content type rather
 * than from the bytes: reading a head first would mean a second object request,
 * and the stream we hold cannot be rewound. `detectVendorFileKind` still takes
 * magic bytes for callers that have them.
 */
export async function readCampaignFile(
  storage: CampaignStorage,
  file: CampaignFileRef,
): Promise<VendorFileTable> {
  const kind = detectVendorFileKind({
    filename: file.name,
    contentType: file.contentType ?? null,
  });
  const body = await storage.getObjectStream(file.storageKey);
  return readVendorFile(body, kind);
}

/**
 * Positional rows as the header-keyed records the import engine takes.
 *
 * A generator, not an array: `importMailerRows` consumes lazily and batches its
 * writes, so materialising a second copy of 20,000 rows buys nothing and costs
 * the memory twice.
 */
export function* rowsAsRecords(
  headers: readonly string[],
  rows: readonly (readonly unknown[])[],
): Generator<Record<string, unknown>> {
  const keys = headers.map((header) => normalizeHeader(header));
  for (const row of rows) {
    const record: Record<string, unknown> = {};
    for (let i = 0; i < keys.length; i += 1) {
      record[keys[i]] = row[i];
    }
    yield record;
  }
}

/**
 * A cell as text, for the columns read positionally here.
 *
 * ⚠ Not `String(value)`. Cells arrive as `unknown` — strings off the CSV parser,
 * numbers out of a workbook — and an object would stringify to
 * `[object Object]`, which reads as a *populated* carrier agency code that
 * matches nothing. Anything that is not a primitive is not data.
 */
export function cellText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

/** A column's position by its normalized name, or `-1`. */
export function columnIndex(headers: readonly string[], name: string): number {
  return headers.findIndex((header) => normalizeHeader(header) === name);
}

export interface CarrierCodeSummary {
  /** Code key → rows carrying it. Blank codes under {@link BLANK_CARRIER_CODE}. */
  codeCounts: Record<string, number>;
  /** Distinct `agencyid` values, as printed. Provenance in every mode. */
  carrierAgencyIds: string[];
  /** Distinct `agencyname` values, paired with the above for display. */
  carrierAgencyNames: string[];
}

/**
 * What the file says about whose prospects these are.
 *
 * ⚠ Normalized through `appointmentCodeKey`, the **same** function the
 * appointment side uses. If the two normalizations ever drift the match
 * silently misses and a file lands in nobody's tenant — a failure with no error
 * and no obvious symptom.
 */
export function summarizeCarrierCodes(
  headers: readonly string[],
  rows: readonly (readonly unknown[])[],
): CarrierCodeSummary {
  const idColumn = columnIndex(headers, 'agencyid');
  const nameColumn = columnIndex(headers, 'agencyname');

  const codeCounts: Record<string, number> = {};
  const ids = new Set<string>();
  const names = new Set<string>();

  for (const row of rows) {
    const raw = idColumn >= 0 ? cellText(row[idColumn]) : '';
    const key = raw ? appointmentCodeKey(raw) : BLANK_CARRIER_CODE;
    codeCounts[key] = (codeCounts[key] ?? 0) + 1;
    if (raw) ids.add(raw.toUpperCase());

    if (nameColumn >= 0) {
      const name = cellText(row[nameColumn]);
      // Bounded: a file whose `agencyname` is per-row rather than per-agency
      // would otherwise accumulate a set the size of the file.
      if (name && names.size < 50) names.add(name);
    }
  }

  return {
    codeCounts,
    carrierAgencyIds: [...ids].sort(),
    carrierAgencyNames: [...names].sort(),
  };
}

/** The subset of `Model<MailerZipMarket>` the jobs read. */
export interface ZipMarketReader {
  find(filter: Record<string, unknown>): {
    select(projection: Record<string, number>): {
      lean(): PromiseLike<
        { agencyId?: string | null; zip5: string; market: string }[]
      >;
    };
  };
}

/**
 * The ZIP → market lookup the transform runs with.
 *
 * Global rows from the table, then the campaign's own preview resolutions on
 * top. Both jobs call this, which is what guarantees the market shown in the
 * preview is the market printed on the piece.
 */
export async function loadZipMarkets(
  model: ZipMarketReader,
  resolutions: Record<string, string> = {},
): Promise<Record<string, string>> {
  const rows = await model
    // ⚠ `agencyId: null` is a **value** here (the `Carrier` pattern), so this is
    // an exact match rather than "missing or null".
    .find({ agencyId: null })
    .select({ agencyId: 1, zip5: 1, market: 1 })
    .lean();
  return buildZipMarketTable(
    rows.map((row): ZipMarketRow => ({
      agencyId: row.agencyId ?? null,
      zip5: row.zip5,
      market: row.market,
    })),
    resolutions,
  );
}

/**
 * Split a long key list into chunks a `$in` can carry.
 *
 * 5,000 keys is comfortably inside MongoDB's 16 MB document limit for a query
 * (a control-number key is ≤ 36 characters) while keeping a 20,000-row file to
 * four round trips rather than twenty.
 */
export function chunk<T>(values: readonly T[], size = 5_000): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) {
    out.push(values.slice(i, i + size));
  }
  return out;
}

/**
 * Mark a campaign failed and rethrow.
 *
 * Both halves matter. The record is what an operator watching the page sees, so
 * it must carry the reason; the rethrow is what makes Inngest record the failure
 * and retry, which a swallowed error would silently skip.
 */
export async function failCampaign(
  model: {
    updateOne(
      filter: Record<string, unknown>,
      update: Record<string, unknown>,
    ): PromiseLike<unknown>;
  },
  campaignId: string,
  error: unknown,
): Promise<never> {
  const message = (error as Error).message ?? String(error);
  await model.updateOne(
    { _id: campaignId },
    { $set: { status: 'failed', error: message, finishedAt: new Date() } },
  );
  throw error;
}
