import { parse } from 'csv-parse/sync';

/**
 * Loader for David's 2026-09-04 SmartSuite CSV exports (PAC-91 §8).
 *
 * Pure functions over CSV text — no Mongo, no filesystem — so the parsing rules
 * below are unit-testable without a database or a copy of the (gitignored)
 * exports.
 *
 * ⚠ THE SEPARATOR QUIRK, which is the whole reason this file exists:
 * SmartSuite's export writes a multi-valued **rec-id** column as
 * `id | id | id` and the matching **title** column as `#HH3932, #HH4717`.
 * Splitting rec ids on commas therefore produces phantom, dangling ids that
 * match no household — silently, since a lookup miss looks exactly like an
 * unlinked contact. Every rec-id column goes through {@link splitRecIds} and
 * every title column through {@link splitTitles}; nothing splits by hand.
 *
 * The two are cross-checked per row: a title/rec-id count mismatch means the
 * export format changed and the assumption above no longer holds, so it throws
 * rather than importing a row it cannot interpret. On the 2026-09-04 files the
 * counts agree on all 3,064 contact rows.
 */

/** Multi-valued rec-id column: ` | `-separated. */
export function splitRecIds(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/\s*\|\s*/)
    .map((v) => v.trim())
    .filter(Boolean);
}

/** Multi-valued title column (`#HH1234`): `, `-separated. */
export function splitTitles(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/\s*,\s*/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function text(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export interface ContactCsvRow {
  /** SmartSuite record title, e.g. `#C00023`. The id a human quotes. */
  contactRef: string;
  /** SmartSuite record id — the join key against `legacySmartSuiteId`. */
  recordId: string;
  /** Households this contact is the **primary** of. Normally 0 or 1. */
  primaryHouseholdIds: string[];
  primaryHouseholdRefs: string[];
  /** Households this contact is listed as a member of. */
  memberHouseholdIds: string[];
  memberHouseholdRefs: string[];
  roleInHousehold?: string;
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  phone?: string;
  email?: string;
}

export interface HouseholdCsvRow {
  /** SmartSuite record title, e.g. `#HH4347`. */
  householdRef: string;
  recordId: string;
  propertyAddress?: string;
  /** Policy *numbers* (titles), not rec ids — the export gives no ids here. */
  policyNumbers: string[];
}

export interface PolicyCsvRow {
  policyNumber: string;
  recordId: string;
  /** The policy's household, by rec id. Single-valued on this table. */
  householdRecordId?: string;
  /** The same household by title, e.g. `#HH0017`. */
  householdRef?: string;
  carrier?: string;
  policyType?: string;
  premium?: string;
  policyStatus?: string;
  items?: string;
}

type RawRow = Record<string, string>;

/**
 * `bom: true` because the exports carry a UTF-8 BOM: without it the first
 * header comes back as U+FEFF + `SS Contact ID`, so every lookup of the first
 * column returns undefined — which reads as "the export has no ids".
 */
function readRows(csvText: string, requiredColumns: string[]): RawRow[] {
  const rows = parse(csvText, {
    columns: true,
    bom: true,
    skip_empty_lines: true,
    trim: false,
    relax_column_count: false,
  }) as RawRow[];

  if (!rows.length) return rows;
  const missing = requiredColumns.filter((c) => !(c in rows[0]));
  if (missing.length) {
    throw new Error(
      `CSV is missing expected column(s): ${missing.join(', ')}. ` +
        `Found: ${Object.keys(rows[0]).join(', ')}`,
    );
  }
  return rows;
}

/**
 * Fail loudly when a title column and its rec-id column disagree on how many
 * values they hold — the one symptom that would tell us the separator
 * convention has changed under us.
 */
function assertPaired(
  label: string,
  rowRef: string,
  titles: string[],
  ids: string[],
): void {
  if (titles.length !== ids.length) {
    throw new Error(
      `${rowRef}: ${label} has ${titles.length} title(s) but ${ids.length} ` +
        `rec id(s). The export's separator convention (" | " for rec ids, ` +
        `", " for titles) no longer holds — re-check the export before ` +
        `trusting any link in it.`,
    );
  }
}

const CONTACT_COLUMNS = [
  'SS Contact ID',
  'Record ID',
  'Household Primary Contact',
  'Household Member',
  'primary household rec id',
  'household member rec id',
];

/** Contacts export, keyed by `Record ID`. */
export function parseContactsCsv(csvText: string): Map<string, ContactCsvRow> {
  const out = new Map<string, ContactCsvRow>();
  for (const raw of readRows(csvText, CONTACT_COLUMNS)) {
    const recordId = raw['Record ID']?.trim();
    const contactRef = raw['SS Contact ID']?.trim() ?? '';
    if (!recordId) continue;

    const primaryHouseholdRefs = splitTitles(raw['Household Primary Contact']);
    const primaryHouseholdIds = splitRecIds(raw['primary household rec id']);
    const memberHouseholdRefs = splitTitles(raw['Household Member']);
    const memberHouseholdIds = splitRecIds(raw['household member rec id']);
    const rowRef = contactRef || recordId;
    assertPaired(
      'Household Primary Contact',
      rowRef,
      primaryHouseholdRefs,
      primaryHouseholdIds,
    );
    assertPaired(
      'Household Member',
      rowRef,
      memberHouseholdRefs,
      memberHouseholdIds,
    );

    out.set(recordId, {
      contactRef,
      recordId,
      primaryHouseholdIds,
      primaryHouseholdRefs,
      memberHouseholdIds,
      memberHouseholdRefs,
      roleInHousehold: text(raw['Role in Household']),
      firstName: text(raw['First Name']),
      lastName: text(raw['Last Name']),
      dateOfBirth: text(raw['Date of Birth']),
      phone: text(raw['Phone']),
      email: text(raw['Email']),
    });
  }
  return out;
}

const HOUSEHOLD_COLUMNS = ['SS Household ID', 'Record ID'];

/** Households export, keyed by `Record ID`. */
export function parseHouseholdsCsv(
  csvText: string,
): Map<string, HouseholdCsvRow> {
  const out = new Map<string, HouseholdCsvRow>();
  for (const raw of readRows(csvText, HOUSEHOLD_COLUMNS)) {
    const recordId = raw['Record ID']?.trim();
    if (!recordId) continue;
    out.set(recordId, {
      householdRef: raw['SS Household ID']?.trim() ?? '',
      recordId,
      propertyAddress: text(raw['Property Address']),
      // Policy *numbers*, so a title column: comma-separated.
      policyNumbers: splitTitles(raw['Link to Policies']),
    });
  }
  return out;
}

const POLICY_COLUMNS = ['Policy Number', 'Record ID', 'Household Rec Id'];

/** Policies export, keyed by `Record ID`. */
export function parsePoliciesCsv(csvText: string): Map<string, PolicyCsvRow> {
  const out = new Map<string, PolicyCsvRow>();
  for (const raw of readRows(csvText, POLICY_COLUMNS)) {
    const recordId = raw['Record ID']?.trim();
    if (!recordId) continue;
    /*
     * Single-valued on the 2026-09-04 export (a policy belongs to one
     * household), but split anyway: a second value here would otherwise be
     * concatenated into one nonsense id that matches nothing.
     */
    const householdIds = splitRecIds(raw['Household Rec Id']);
    const householdRefs = splitTitles(raw['Household']);
    out.set(recordId, {
      policyNumber: raw['Policy Number']?.trim() ?? '',
      recordId,
      householdRecordId: householdIds[0],
      householdRef: householdRefs[0],
      carrier: text(raw['Carrier']),
      policyType: text(raw['Policy Type']),
      premium: text(raw['Premium']),
      policyStatus: text(raw['Policy Status']),
      items: text(raw['Items']),
    });
  }
  return out;
}
