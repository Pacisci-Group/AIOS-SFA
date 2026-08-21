import type { MailerSourceSystem } from '@sfa/shared';
import { mailerControlNumberKeys } from './mailer-control-number';
import {
  parseInteger,
  parseMoney,
  parseSourceDate,
  parseText,
  parseWeekNumber,
  parseYesNo,
  splitZip,
} from './mailer-parse';

/**
 * One source row, however it arrived. Keys are already header-normalized —
 * see {@link normalizeHeader}.
 */
export type RawMailerRow = Record<string, unknown>;

/** Everything the mapper needs that is not in the row itself. */
export interface MailerMapContext {
  agencyId: string;
  system: MailerSourceSystem;
  /** `MailerImportRun._id`, or the backfill's run stamp. */
  runId?: string;
  uploadedFilename?: string;
  storageKey?: string;
  uploadedAt?: Date;
  /** Operator user id, when a person triggered the import. */
  updatedBy?: string;
  /** Marker for non-production rows, e.g. `demo:seed`. */
  recordSource?: string;
}

/** A mapped document ready to upsert, keyed for the dedupe index. */
export interface MappedMailer {
  /** The value the upsert filters on; always `keys[0]`. */
  primaryKey: string;
  keys: string[];
  doc: Record<string, unknown>;
}

export type MailerMapResult =
  | { ok: true; mapped: MappedMailer }
  | { ok: false; reason: string; controlNumber: string | null };

/**
 * Collapse a source column name to a single comparable form.
 *
 * **This is what lets one mapper serve two sources.** The CSV ships
 * `New Control Number` and `Campaign Number`; BigQuery ships
 * `New_Control_Number` and `Campaign_Number`. Lowercasing and stripping
 * non-alphanumerics maps both onto `newcontrolnumber` / `campaignnumber`, so
 * the mapper below reads exactly one name per field. Without it the alternative
 * is two mappers over near-identical data, which is precisely how the two
 * sources drift into producing different documents for the same mailer.
 */
export function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Apply {@link normalizeHeader} across a whole row. */
export function normalizeRow(row: Record<string, unknown>): RawMailerRow {
  const normalized: RawMailerRow = {};
  for (const [key, value] of Object.entries(row)) {
    normalized[normalizeHeader(key)] = value;
  }
  return normalized;
}

/**
 * Columns promoted to first-class schema fields.
 *
 * Everything **not** listed here still reaches Mongo, inside `source.raw` — see
 * the note on `MailerSource.raw`. That includes the single-valued passthroughs
 * Carl flagged as unused (`deductible`, `windhail`, `roofsurfac`, `dwellprot`),
 * the duplicate `coveragest` (byte-identical to `totalpremi` on all 20,405
 * rows), `filler` (square footage with a thousands separator), `datalabven` and
 * `discounts`.
 *
 * ⚠ `recordid` is **not** here and must never be keyed on: it is a 1..N
 * sequence describing row position, not identity.
 */
const PROMOTED_COLUMNS = new Set([
  'controlno',
  'newcontrolnumber',
  'firstname',
  'lastname',
  'name',
  'gender',
  'emailaddre',
  'phone',
  'birthdate',
  'address',
  'city',
  'state',
  'zip',
  'zip1',
  'zip2',
  'zip4',
  'zipcodes',
  'county',
  'squarefeet',
  'yearbuilt',
  'dwellingli',
  'otherlimit',
  'livingexpl',
  'guestlimit',
  'familylimi',
  'totalpremi',
  'yearlyprem',
  'monthlypre',
  'newyearlypremium2',
  'campaignnumber',
  'weeknumber',
  'filename',
  'type',
  'product',
  'quotestatu',
  'quotedate',
  'maildropdate',
  'startmon',
  'endsun',
  'campaignstatus',
  'lastupdated',
  'rightname',
  'agencyphon',
  'donotcall',
  'donotmail',
]);

/** Strip a leading `$`-less `#` and whitespace for the human-facing echo. */
function displayControlNumber(row: RawMailerRow): string | null {
  return parseText(row.newcontrolnumber) ?? parseText(row.controlno) ?? null;
}

/**
 * Map one source row to a mailer document, or reject it with a reason.
 *
 * Rejection is always **reported and counted**, never silent — a row that
 * vanishes between the file and the collection is indistinguishable from one
 * that was never in the file, and the operator has no other way to find out.
 */
export function mapMailerRow(
  row: RawMailerRow,
  ctx: MailerMapContext,
): MailerMapResult {
  const keys = mailerControlNumberKeys(row.controlno, row.newcontrolnumber);
  if (keys.length === 0) {
    return {
      ok: false,
      reason:
        'No usable control number (both controlno and New Control Number are empty).',
      controlNumber: null,
    };
  }

  const zip = splitZip(row.zip ?? row.zipcodes);
  // `zip1` / `Zip Codes` carry the 5-digit form and `zip2` / `zip4` the +4, so
  // prefer the split columns when present and fall back to splitting `zip`.
  const zip5 = parseText(row.zip1) ?? parseText(row.zipcodes) ?? zip.zip5;
  const zip4 = parseText(row.zip2) ?? parseText(row.zip4) ?? zip.zip4;

  const campaignNumber = parseText(row.campaignnumber);
  const quoteDate = parseSourceDate(row.quotedate);

  const address = compact({
    street: parseText(row.address),
    city: parseText(row.city),
    state: parseText(row.state),
    zip: zip.zip,
    zip5,
    zip4,
    // Zero-padded FIPS. Kept a string — `Number('017')` is `17`, and legacy
    // showed producers "County: 083" because it never mapped it to a name.
    county: parseText(row.county),
  });

  const coverage = compact({
    dwelling: parseMoney(row.dwellingli),
    otherStructures: parseMoney(row.otherlimit),
    lossOfUse: parseMoney(row.livingexpl),
    guestMedical: parseMoney(row.guestlimit),
    familyLiability: parseMoney(row.familylimi),
  });

  const premium = compact({
    total: parseMoney(row.totalpremi),
    yearly: roundMoney(parseMoney(row.yearlyprem)),
    monthly: parseMoney(row.monthlypre),
    newYearly: roundMoney(parseMoney(row.newyearlypremium2)),
  });

  const campaign = compact({
    campaignNumber,
    weekNumber: parseInteger(row.weeknumber) ?? parseWeekNumber(campaignNumber),
    fileName: parseText(row.filename),
    policyType: parseText(row.type),
    product: parseText(row.product),
    quoteStatus: parseText(row.quotestatu),
    // BigQuery-only. Absent on an uploaded file, and left absent rather than
    // derived — there is nothing honest to derive them from.
    mailDropDate: parseSourceDate(row.maildropdate),
    startMon: parseSourceDate(row.startmon),
    endSun: parseSourceDate(row.endsun),
    campaignStatus: parseText(row.campaignstatus),
  });

  const { firstName, lastName, fullName } = names(row);

  const doc: Record<string, unknown> = compact({
    agencyId: ctx.agencyId,
    controlNumber: parseText(row.controlno),
    newControlNumber: parseText(row.newcontrolnumber),
    firstName,
    lastName,
    fullName,
    gender: parseText(row.gender),
    email: parseText(row.emailaddre),
    phone: parseText(row.phone),
    dateOfBirth: parseSourceDate(row.birthdate),
    address: isEmpty(address) ? undefined : address,
    squareFeet: parseInteger(row.squarefeet),
    yearBuilt: parseInteger(row.yearbuilt),
    coverage: isEmpty(coverage) ? undefined : coverage,
    premium: isEmpty(premium) ? undefined : premium,
    campaign: isEmpty(campaign) ? undefined : campaign,
    quoteDate,
    market: parseText(row.rightname),
    agencyPhone: parseText(row.agencyphon),
    doNotCall: parseYesNo(row.donotcall),
    doNotMail: parseYesNo(row.donotmail),
    source: compact({
      system: ctx.system,
      fileName: parseText(row.filename),
      uploadedFilename: ctx.uploadedFilename,
      storageKey: ctx.storageKey,
      runId: ctx.runId,
      uploadedAt: ctx.uploadedAt,
      lastUpdatedAt: parseSourceDate(row.lastupdated),
      updatedBy: ctx.updatedBy,
      recordSource: ctx.recordSource,
      raw: passthrough(row),
    }),
  });

  // `doNotCall` / `doNotMail` are real booleans and `false` is meaningful, so
  // reinstate them after `compact` — which drops `undefined` only, but a
  // future edit to it should not be able to silently unset a suppression flag.
  doc.doNotCall = parseYesNo(row.donotcall);
  doc.doNotMail = parseYesNo(row.donotmail);

  return { ok: true, mapped: { primaryKey: keys[0], keys, doc } };
}

/**
 * `yearlyprem` and `New Yearly Premium 2` disagree on 3 of 20,405 rows, and in
 * every case by a float artifact (`$2704.91/year*` against `2704.915`). Round
 * to cents rather than treating those rows as bad data.
 */
function roundMoney(value: number | undefined): number | undefined {
  return value === undefined ? undefined : Math.round(value * 100) / 100;
}

/**
 * Recover first/last name.
 *
 * The source carries `firstname`/`lastname` **and** a combined `name`; prefer
 * the split columns and fall back to splitting on the first space, which is
 * what legacy did.
 */
function names(row: RawMailerRow): {
  firstName?: string;
  lastName?: string;
  fullName?: string;
} {
  const firstName = parseText(row.firstname);
  const lastName = parseText(row.lastname);
  const combined = parseText(row.name);

  if (firstName ?? lastName) {
    return {
      firstName,
      lastName,
      fullName: combined ?? [firstName, lastName].filter(Boolean).join(' '),
    };
  }
  if (!combined) return {};

  const [head, ...rest] = combined.split(' ');
  return {
    firstName: head || undefined,
    lastName: rest.length > 0 ? rest.join(' ') : undefined,
    fullName: combined,
  };
}

/** Every column not promoted to a schema field, preserved verbatim. */
function passthrough(row: RawMailerRow): Record<string, unknown> {
  const raw: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (PROMOTED_COLUMNS.has(key)) continue;
    if (value === null || value === undefined || value === '') continue;
    raw[key] = value;
  }
  return raw;
}

/** Drop `undefined` entries so absent columns never land on the document. */
function compact<T extends Record<string, unknown>>(input: T): T {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) output[key] = value;
  }
  return output as T;
}

function isEmpty(input: Record<string, unknown>): boolean {
  return Object.keys(input).length === 0;
}

/**
 * What the file says about itself, read off the first data row.
 *
 * Safe to take from one row because these columns hold **exactly one distinct
 * value across all 20,405 rows** of a real file — `agencyid`, `agencyname`,
 * `Campaign Number`, `FileName`, `quotedate`, `type`, `product`. That is the
 * evidence behind "one file = one campaign, one agency, one product", and it is
 * what makes agency selection a per-upload choice rather than a per-row
 * attribution. The importer still verifies it holds (see `importMailerRows`)
 * rather than assuming it.
 */
export function detectFromRow(row: RawMailerRow): {
  agencyId: string | null;
  agencyName: string | null;
  campaignNumber: string | null;
  weekNumber: number | null;
  fileName: string | null;
  quoteDate: string | null;
  policyType: string | null;
  product: string | null;
} {
  const campaignNumber = parseText(row.campaignnumber) ?? null;
  const quoteDate = parseSourceDate(row.quotedate);
  return {
    agencyId: parseText(row.agencyid)?.toUpperCase() ?? null,
    agencyName: parseText(row.agencyname) ?? null,
    campaignNumber,
    weekNumber:
      parseInteger(row.weeknumber) ?? parseWeekNumber(campaignNumber) ?? null,
    fileName: parseText(row.filename) ?? null,
    quoteDate: quoteDate ? quoteDate.toISOString() : null,
    policyType: parseText(row.type) ?? null,
    product: parseText(row.product) ?? null,
  };
}

export { displayControlNumber };
