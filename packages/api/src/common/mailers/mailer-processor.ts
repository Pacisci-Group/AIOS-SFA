/**
 * The SFA Processor — the transform that turns a mail vendor's presorted quote
 * file into the offer that gets printed and mailed (PAC-71 spike).
 *
 * Ported step for step from ApexReports
 * (`./apex-mail-companion/src/components/mail/Part2.tsx`, `run()` +
 * `finishPipeline()`), which is itself a port of the original Alteryx
 * workflow. **The step order, the rounding and the odd choices are deliberate
 * fidelity to that pipeline** — see `.claude/rules/apex-mail-companion-reference.md`.
 * The unit spec proves the port against the real week-29 output file: every
 * derived column reproduces on 197/197 rows.
 *
 * ## Why a pure function
 *
 * Same reason as `mailer-import.ts`: no Nest, no I/O, so the worker, a CLI and
 * a unit test can all call it, and the whole run can be validated offline
 * against a known-good output before it is trusted. Reading the file and
 * writing the mailers are the callers' jobs.
 *
 * ## What ApexReports leaves as configuration
 *
 * Apex hard-codes Smith Family Agency's world: `Tulsa` vs everything-else for
 * the phone, `Oklahoma City` as the fallback market, a ZIP→market Google Sheet,
 * a floor typed into a form. Here every one of those is a {@link MailerProcessorSettings}
 * field, so a second agency is data rather than a fork.
 *
 * ## What the fixture taught us that the code did not say
 *
 * - The base premium Apex reads from `yearlyprem` is the vendor's `totalpremi`
 *   — the vendor writes the same quoted premium to both, and Apex overwrites
 *   `yearlyprem` with the offer. That is why the two never agree afterwards
 *   (handoff doc §3), and why the "which premium do producers quote" question
 *   has a real answer: `yearlyprem` is the mailed offer, `totalpremi` is the
 *   quote it was discounted from.
 * - The week-29 run used a floor of **$1,886.15** (Apex's form default today is
 *   $1,916.44), and **188 of 197** sampled rows landed on it. The "offer" is
 *   the floor for ~95% of prospects; the discount table only matters for large,
 *   expensive homes.
 */

export interface MailerProcessorSettings {
  /**
   * Written to every row's `Campaign Number`. Passed through
   * {@link normalizeCampaignNumber}, so `29`, `week 29` and `Week_Number-29`
   * all land as `Week_Number-29`.
   */
  campaignNumber: string;
  /** Written to every row's `FileName`, e.g. `SFA-QBP`. */
  fileName: string;
  /** Minimum offer after discounts. Rows below it are raised to it. */
  premiumFloor: number;
  /** 5-digit ZIP → market name (`Right_Name`). Apex reads this from a Google Sheet. */
  zipMarkets: Record<string, string>;
  /** Market written when a ZIP is unmapped. Apex hard-codes `Oklahoma City`. */
  defaultMarket: string;
  /** Market → local-presence phone written to `agencyphon`. */
  marketPhones: Record<string, string>;
  /** Phone for any market not in {@link marketPhones}. Apex: the OKC number. */
  defaultPhone: string;
  /**
   * The year the run happens in — it drives the home-age discount, so a
   * re-run next January would price every home a year older. Defaults to now;
   * a re-run of a past campaign must pass the original year.
   */
  runYear?: number;
}

export interface MailerPremiumStats {
  min: number;
  max: number;
  avg: number;
  count: number;
}

export interface MailerProcessorStats {
  inputRows: number;
  outputRows: number;
  duplicatesRemoved: number;
  /** Rows whose discounted premium was below the floor and got raised. */
  floorRaised: number;
  zipMatched: number;
  /** Rows with a ZIP the market table does not know. */
  zipUnmatched: number;
  /** Rows with no ZIP at all. */
  zipEmpty: number;
  /** Over `New Yearly Premium 2`, non-zero values only, as Apex reports it. */
  premium: MailerPremiumStats | null;
}

export interface ProcessedMailerFile {
  headers: string[];
  rows: unknown[][];
  stats: MailerProcessorStats;
  /** ZIP → rows affected, for ZIPs present in the file but absent from the table. */
  unmatchedZips: Record<string, number>;
}

/** Columns the transform appends, in the order Apex appends them. */
export const APPENDED_COLUMNS = [
  'FileName',
  'zip1',
  'zip2',
  'New Yearly Premium 2',
  'Zip Codes',
  'Right_Name',
  'New Control Number',
  'Campaign Number',
] as const;

/** Columns the transform overwrites in place when the file carries them. */
export const OVERWRITTEN_COLUMNS = [
  'yearlyprem',
  'monthlypre',
  'agencyphon',
  'recordid',
  'cfield53',
] as const;

/**
 * Rows are deduplicated on these, joined with `|`. `recordid` is deliberately
 * not among them — it is row position, not identity.
 */
export const DEDUPE_COLUMNS = [
  'firstname',
  'lastname',
  'address',
  'city',
  'state',
  'zip',
  'phone',
  'controlno',
] as const;

/**
 * Square-footage discount, as a fraction of the base premium.
 *
 * Boundaries are inclusive at the bottom of each band (`>=`), exactly as Apex
 * has them. Below 1,000 sq ft there is no size discount at all.
 */
export function squareFootageDiscount(squareFeet: number): number {
  if (squareFeet >= 2500) return 0.44;
  if (squareFeet >= 2000) return 0.36;
  if (squareFeet >= 1500) return 0.32;
  if (squareFeet >= 1000) return 0.29;
  return 0;
}

/**
 * Home-age discount: 4% for a home nine years old or newer, 10% otherwise.
 *
 * A missing `yearbuilt` parses to 0, makes the home ~2,000 years old and gets
 * the 10% band — Apex behaves the same way, and that is what the mailed
 * offers were built on, so it is preserved rather than "fixed".
 */
export function homeAgeDiscount(yearBuilt: number, runYear: number): number {
  return runYear - yearBuilt <= 9 ? 0.04 : 0.1;
}

export interface DiscountedPremium {
  /** The offer: the discounted premium, or the floor if that was lower. */
  premium: number;
  /** The discount actually applied, before the floor. */
  discount: number;
  floored: boolean;
}

/**
 * `base − base × (size discount + age discount)`, then the floor.
 *
 * The two discounts are **added**, not compounded — a 2,500 sq ft, 1974 home
 * gets 44% + 10% = 54% off, not 44% then 10%.
 */
export function discountPremium(
  base: number,
  squareFeet: number,
  yearBuilt: number,
  runYear: number,
  floor: number,
): DiscountedPremium {
  const discount =
    squareFootageDiscount(squareFeet) + homeAgeDiscount(yearBuilt, runYear);
  const discounted = base - base * discount;
  const floored = discounted < floor;
  return { premium: floored ? floor : discounted, discount, floored };
}

/**
 * `29`, `week 29`, `Week-Number 29`, `week_number-29` → `Week_Number-29`.
 * Anything that is not a bare week number passes through trimmed.
 */
export function normalizeCampaignNumber(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const match = /^(?:week(?:[_\s-]*number)?[_\s-]*[-:]?\s*)?(\d+)$/i.exec(
    trimmed,
  );
  return match ? `Week_Number-${match[1]}` : trimmed;
}

/** ISO-8601 week number (Mon–Sun; week 1 holds the first Thursday). */
export function isoWeekNumber(date: Date): number {
  const utc = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
  );
  const dayNumber = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - dayNumber);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  return Math.ceil(((utc.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/** Apex's default for a new run: the current ISO week. */
export function campaignNumberForDate(date: Date = new Date()): string {
  return `Week_Number-${isoWeekNumber(date)}`;
}

/** The printed short form: the last 12 characters of `controlno`. */
export function shortControlNumber(controlNumber: unknown): string {
  return text(controlNumber).slice(-12);
}

/**
 * A cell as text. Cells are strings off the CSV parser and numbers once the
 * transform has priced them; anything else is not data and reads as empty.
 */
function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

/**
 * Apex's number parsing, kept byte-for-byte: `parseFloat(x) || 0`, and for
 * the premium every character that is not a digit or a dot is stripped first
 * (`"$1,920.24"` → `1920.24`). Unparseable is `0`, not `undefined` — this
 * transform never rejects a row, it prices it, and the fixture was priced
 * this way. Contrast `parseMoney` in `mailer-parse.ts`, which is the right
 * tool when the answer may be "no value".
 */
function apexNumber(value: unknown): number {
  return Number.parseFloat(text(value)) || 0;
}
function apexMoney(value: unknown): number {
  return Number.parseFloat(text(value).replace(/[^\d.]/g, '')) || 0;
}

/**
 * Run the SFA Processor over a parsed vendor file.
 *
 * `headers` are matched case-insensitively and echoed back trimmed; Apex
 * lowercases them on the way out, which is a no-op on every vendor file seen
 * (they arrive lowercase). The eight {@link APPENDED_COLUMNS} are added in
 * order; the {@link OVERWRITTEN_COLUMNS} are rewritten in place when present.
 *
 * Missing input columns do not throw: a missing `pst_seq` just means no
 * postal sort, a missing `monthlypre` is not written. Only `zip`,
 * `squarefeet`, `yearbuilt` and `yearlyprem` genuinely matter to the pricing,
 * and the caller should validate their presence before running — that is a
 * preview-time concern, not this function's.
 */
export function processMailerFile(
  headers: string[],
  rows: readonly (readonly unknown[])[],
  settings: MailerProcessorSettings,
): ProcessedMailerFile {
  const runYear = settings.runYear ?? new Date().getFullYear();
  const campaignNumber = normalizeCampaignNumber(settings.campaignNumber);

  const outHeaders = headers.map((h) => text(h).trim());
  const lower = outHeaders.map((h) => h.toLowerCase());
  const col = (name: string) => lower.indexOf(name.toLowerCase());
  const at = {
    zip: col('zip'),
    monthlypre: col('monthlypre'),
    squarefeet: col('squarefeet'),
    yearbuilt: col('yearbuilt'),
    yearlyprem: col('yearlyprem'),
    controlno: col('controlno'),
    pstSeq: col('pst_seq'),
    cfield53: col('cfield53'),
    recordid: col('recordid'),
    agencyphon: col('agencyphon'),
  };

  // --- 1–9: split ZIP, cast, discount, floor --------------------------------
  // One pass, because Apex does it in one pass and the appended-column order
  // is what the print vendor's template expects.
  let floorRaised = 0;
  const priced: unknown[][] = rows.map((source) => {
    const rawZip = text(source[at.zip]);
    const dash = rawZip.indexOf('-');
    const zip1 = dash >= 0 ? rawZip.slice(0, dash) : rawZip;
    const zip2 = dash >= 0 ? rawZip.slice(dash + 1) : '';

    const { premium, floored } = discountPremium(
      apexMoney(source[at.yearlyprem]),
      apexNumber(source[at.squarefeet]),
      apexNumber(source[at.yearbuilt]),
      runYear,
      settings.premiumFloor,
    );
    if (floored) floorRaised += 1;

    const out = [...source];
    if (at.yearlyprem >= 0) out[at.yearlyprem] = premium;
    if (at.monthlypre >= 0) out[at.monthlypre] = premium / 12;
    // FileName is filled after the sort; the placeholder keeps column order.
    out.push('', zip1, zip2, premium);
    return out;
  });
  outHeaders.push('FileName', 'zip1', 'zip2', 'New Yearly Premium 2');
  const fileNameAt = outHeaders.length - 4;
  const zip1At = outHeaders.length - 3;
  const newPremiumAt = outHeaders.length - 1;

  // --- 10: sort ascending by the new premium ---------------------------------
  // Stable, so rows tied at the floor (most of them) keep file order.
  priced.sort(
    (a, b) => (a[newPremiumAt] as number) - (b[newPremiumAt] as number),
  );

  // --- 11: FileName -----------------------------------------------------------
  for (const row of priced) row[fileNameAt] = settings.fileName;

  // --- 12: ZIP → market -------------------------------------------------------
  outHeaders.push('Zip Codes', 'Right_Name');
  const marketAt = outHeaders.length - 1;
  const unmatchedZips: Record<string, number> = {};
  let zipMatched = 0;
  let zipEmpty = 0;
  for (const row of priced) {
    const zip5 = text(row[zip1At]).trim();
    const market = zip5 ? (settings.zipMarkets[zip5] ?? null) : null;
    if (market) zipMatched += 1;
    else if (zip5) unmatchedZips[zip5] = (unmatchedZips[zip5] ?? 0) + 1;
    else zipEmpty += 1;
    row.push(zip5, market ?? '');
  }
  const zipUnmatched = Object.values(unmatchedZips).reduce((a, n) => a + n, 0);

  // --- 13: default market + local-presence phone -----------------------------
  for (const row of priced) {
    if (!row[marketAt]) row[marketAt] = settings.defaultMarket;
    if (at.agencyphon >= 0) {
      const market = text(row[marketAt]);
      row[at.agencyphon] =
        settings.marketPhones[market] ?? settings.defaultPhone;
    }
  }

  // --- 14: dedupe -------------------------------------------------------------
  const keyAts = DEDUPE_COLUMNS.map((name) => col(name));
  const seen = new Set<string>();
  const deduped = priced.filter((row) => {
    const key = keyAts.map((i) => (i >= 0 ? text(row[i]) : '')).join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // --- 15: postal sort order --------------------------------------------------
  if (at.pstSeq >= 0) {
    deduped.sort((a, b) =>
      text(a[at.pstSeq]).localeCompare(text(b[at.pstSeq]), undefined, {
        numeric: true,
      }),
    );
  }

  // --- 16: renumber recordid --------------------------------------------------
  if (at.recordid >= 0) {
    deduped.forEach((row, i) => (row[at.recordid] = i + 1));
  } else {
    outHeaders.push('recordid');
    deduped.forEach((row, i) => row.push(i + 1));
  }

  // --- 17: short control number, campaign tag, print formatting --------------
  outHeaders.push('New Control Number', 'Campaign Number');
  for (const row of deduped) {
    row.push(
      at.controlno >= 0 ? shortControlNumber(row[at.controlno]) : '',
      campaignNumber,
    );
    if (at.yearlyprem >= 0) {
      row[at.yearlyprem] =
        `$${apexNumber(row[at.yearlyprem]).toFixed(2)}/year*`;
    }
    if (at.monthlypre >= 0) {
      row[at.monthlypre] = apexNumber(row[at.monthlypre]).toFixed(2);
    }
    if (at.cfield53 >= 0) row[at.cfield53] = '';
  }

  // --- stats ------------------------------------------------------------------
  const premiums = deduped
    .map((row) => apexNumber(row[newPremiumAt]))
    .filter(Boolean);
  const premium: MailerPremiumStats | null = premiums.length
    ? {
        min: Math.min(...premiums),
        max: Math.max(...premiums),
        avg: premiums.reduce((a, b) => a + b, 0) / premiums.length,
        count: premiums.length,
      }
    : null;

  return {
    headers: outHeaders,
    rows: deduped,
    unmatchedZips,
    stats: {
      inputRows: rows.length,
      outputRows: deduped.length,
      duplicatesRemoved: priced.length - deduped.length,
      floorRaised,
      zipMatched,
      zipUnmatched,
      zipEmpty,
      premium,
    },
  };
}
