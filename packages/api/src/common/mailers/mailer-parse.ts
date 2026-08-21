/**
 * Coercions for mailer source rows (PAC-73).
 *
 * Both the RTP upload and the BigQuery backfill hand these raw strings — the
 * BigQuery table types almost every column as `STRING`, including premiums and
 * dates, and the CSV is strings by definition. Coercion belongs here, at import
 * time, and never in a read path or a UI: legacy typed `yearlyprem` as `number`
 * and called `.toLocaleString()` on what was actually a string, which silently
 * no-ops rather than throwing — which is why premiums render unformatted there
 * to this day.
 */

/**
 * Money as a number, or `undefined` when there is nothing to parse.
 *
 * The source is inconsistent within a single row group: `"$1886.15/year*"`,
 * `"$1,000.00/person"`, `"$100,000.00/occurrence"`, `"$899,675.00"` and a bare
 * `"157.18"` all appear. `Number()` returns `NaN` for every one of the
 * formatted variants.
 *
 * ⚠ **Returns `undefined`, never `0`, on failure.** `migration/helpers/value-utils.ts`
 * exports a `toNumber` that looks like a drop-in here and is not one: it
 * collapses "unparseable" and "absent" into `0`, which would write a real
 * `$0.00` premium onto a mailer and show a producer a free policy. An absent
 * premium must stay absent.
 *
 * ⚠ **Never returns `NaN`.** A `NaN` reaching Mongo is stored as `NaN` and
 * poisons every aggregate computed over the field afterwards.
 */
export function parseMoney(raw: unknown): number | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : undefined;
  }
  if (typeof raw !== 'string') return undefined;

  // Strip currency symbols, thousands separators and unit suffixes
  // (`/year*`, `/person`, `/occurrence`), keeping digits, sign and one point.
  const cleaned = raw.replace(/[^0-9.-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return undefined;

  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * A plain integer (square footage, year built), or `undefined`.
 *
 * Separate from {@link parseMoney} only so the intent reads at the call site;
 * the cleaning is the same because the source formats these the same way
 * (`filler` is square footage carrying a thousands separator — a column named
 * `filler` that is not filler).
 */
export function parseInteger(raw: unknown): number | undefined {
  const parsed = parseMoney(raw);
  if (parsed === undefined) return undefined;
  return Math.round(parsed);
}

/**
 * Days between the Excel epoch (1899-12-30) and the Unix epoch.
 *
 * 1899-12-30 rather than 1900-01-01 because Excel deliberately reproduces a
 * Lotus 1-2-3 bug in which 1900 is a leap year; the two-day offset is what
 * makes every real-world serial line up.
 */
const EXCEL_EPOCH_OFFSET_DAYS = 25569;
const MS_PER_DAY = 86_400_000;

/**
 * An Excel serial date as a UTC `Date`, or `undefined`.
 *
 * `quotedate` arrives as `"46216"`, which is **2026-07-13** — verified against
 * that row's `mail_drop_date` in BigQuery, and consistent with the file's week
 * number (29).
 *
 * Also accepts an already-parsed `Date` and an ISO string, because the BigQuery
 * side carries genuine date columns (`mail_drop_date`, `start_mon`, `end_sun`,
 * `last_updated`) alongside the serial-encoded ones and the shared mapper must
 * take both without branching on source.
 *
 * Deliberately **rejects** anything outside a plausible range. A stray `0`, a
 * `1`, or a column that turned out to hold a row counter would otherwise
 * silently become a date in 1899, which reads as real data rather than as the
 * mapping bug it is.
 */
export function parseSourceDate(raw: unknown): Date | undefined {
  if (raw === null || raw === undefined || raw === '') return undefined;

  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? undefined : raw;
  }

  // A BigQuery DATE/TIMESTAMP arrives as `{ value: '2026-07-13' }`.
  if (typeof raw === 'object' && 'value' in (raw as Record<string, unknown>)) {
    return parseSourceDate((raw as { value: unknown }).value);
  }

  if (typeof raw === 'number') {
    return excelSerialToDate(raw);
  }

  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;

  // A bare run of digits is an Excel serial; anything else is a date string.
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return excelSerialToDate(Number.parseFloat(trimmed));
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/** Lower bound ≈ 1990-01-01, upper ≈ 2079-01-01, as Excel serials. */
const MIN_PLAUSIBLE_SERIAL = 32_874;
const MAX_PLAUSIBLE_SERIAL = 65_380;

/** The serial → `Date` conversion on its own, for callers that know the shape. */
export function excelSerialToDate(serial: number): Date | undefined {
  if (!Number.isFinite(serial)) return undefined;
  if (serial < MIN_PLAUSIBLE_SERIAL || serial > MAX_PLAUSIBLE_SERIAL) {
    return undefined;
  }
  return new Date(Math.round((serial - EXCEL_EPOCH_OFFSET_DAYS) * MS_PER_DAY));
}

/** Trimmed non-empty string, or `undefined`. Keeps empty columns off the doc. */
export function parseText(raw: unknown): string | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw === 'number') return String(raw);
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * A `Yes`/`No`-style flag as a boolean.
 *
 * The suppression columns (`donotcall`, `donotmail`) use `Yes`/`No`; treating
 * anything unrecognised as `false` is the safe default for `donotcall` but the
 * *unsafe* one for `donotmail`, so callers that care pass the raw value through
 * to `source.raw` as well.
 */
export function parseYesNo(raw: unknown): boolean {
  if (typeof raw === 'boolean') return raw;
  const text = parseText(raw);
  if (!text) return false;
  return /^(y|yes|true|1)$/i.test(text);
}

/**
 * The week number out of a `Campaign Number`.
 *
 * Every value in both sources is `Week_Number-NN`, so this is a restatement of
 * BigQuery's `week_number` column rather than a campaign identifier — which is
 * exactly why an uploaded file can derive it and does not need the column.
 * Legacy computed an ISO week client-side instead; that was redundant.
 */
export function parseWeekNumber(campaignNumber: unknown): number | undefined {
  const text = parseText(campaignNumber);
  if (!text) return undefined;
  const match = /(\d+)\s*$/.exec(text);
  if (!match) return undefined;
  const week = Number.parseInt(match[1], 10);
  return Number.isFinite(week) ? week : undefined;
}

/** Splits a ZIP+4 (`74003-5807`) into its halves. Tolerates a bare 5-digit zip. */
export function splitZip(raw: unknown): {
  zip?: string;
  zip5?: string;
  zip4?: string;
} {
  const zip = parseText(raw);
  if (!zip) return {};
  const match = /^(\d{5})(?:[-\s]?(\d{4}))?$/.exec(zip);
  if (!match) return { zip };
  return { zip, zip5: match[1], zip4: match[2] };
}
