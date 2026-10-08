import type { DataExportColumnType } from '@sfa/shared';
import type { Types } from 'mongoose';
import type { CellValue, ColumnDef, RowContext } from '../engine/dataset.types';
import type {
  AddressLike,
  ContactRow,
  ExportLookups,
  IdLike,
} from '../engine/lookups';

/**
 * Column builders shared by every dataset, so the same fact has the same
 * header everywhere: `producer_name` means one thing across all six files,
 * and an Alteryx join on `household_id` works whichever two files it joins.
 */

type Pick<Row> = (row: Row, ctx: RowContext<unknown>) => CellValue;

/**
 * A column builder bound to one dataset's row and join types, so a `pick`
 * reads `ctx.joins` fully typed: `const col = columnsFor<LeadRow, LeadJoins>()`.
 */
export function columnsFor<Row, J>() {
  return (
    key: string,
    type: DataExportColumnType,
    description: string,
    pick: (row: Row, ctx: RowContext<J>) => CellValue,
  ): ColumnDef<Row, J> => ({ key, type, description, pick });
}

export function column<Row>(
  key: string,
  type: DataExportColumnType,
  description: string,
  pick: Pick<Row>,
): ColumnDef<Row, unknown> {
  return { key, type, description, pick };
}

/** The fields every `TenantRecord` row carries. */
export interface TenantFields {
  _id: Types.ObjectId;
  branchId?: string;
  createdBy?: Types.ObjectId | null;
  createdAt?: Date;
  updatedAt?: Date;
  legacySmartSuiteId?: string;
}

/** Branch, authorship, timestamps and the SmartSuite record id — last on every row. */
export function tenantColumns<Row extends TenantFields>(): ColumnDef<
  Row,
  unknown
>[] {
  return [
    column(
      'branch_id',
      'id',
      'Branch the record belongs to.',
      (row) => row.branchId,
    ),
    column('branch_name', 'string', 'Name of that branch.', (row, ctx) =>
      ctx.lookups.branch(row.branchId),
    ),
    column(
      'created_by_id',
      'id',
      'User who created the record in this system. Empty for records migrated from SmartSuite or written by the system.',
      (row) => row.createdBy,
    ),
    column('created_by_name', 'string', 'Name of that user.', (row, ctx) =>
      ctx.lookups.users.get(row.createdBy),
    ),
    column(
      'record_created_at',
      'datetime',
      'When the record was written to this system (UTC). For migrated records this is the import time, not the business date.',
      (row) => row.createdAt,
    ),
    column(
      'record_updated_at',
      'datetime',
      'Last change to the record (UTC).',
      (row) => row.updatedAt,
    ),
    column(
      'legacy_smartsuite_id',
      'id',
      'SmartSuite record id, for reconciling against legacy exports. Empty for records created in this system.',
      (row) => row.legacySmartSuiteId,
    ),
  ];
}

/** `<prefix>_id` + `<prefix>_name` for a user reference. */
export function userColumns<Row>(
  prefix: string,
  what: string,
  get: (row: Row, ctx: RowContext<unknown>) => IdLike,
): ColumnDef<Row, unknown>[] {
  return [
    column(`${prefix}_id`, 'id', `${what} (user id).`, get),
    column(
      `${prefix}_name`,
      'string',
      `${what} (name). Deactivated users are still named.`,
      (row, ctx) => ctx.lookups.users.get(get(row, ctx)),
    ),
  ];
}

/** `household_id` / `household_ref` / `household_name`. */
export function householdColumns<Row>(
  get: (row: Row, ctx: RowContext<unknown>) => IdLike,
  what = 'Household',
): ColumnDef<Row, unknown>[] {
  return [
    column('household_id', 'id', `${what} (record id).`, get),
    column(
      'household_ref',
      'string',
      `${what} reference, e.g. HH-2026-0042.`,
      (row, ctx) => ctx.lookups.households.get(get(row, ctx))?.householdRef,
    ),
    column(
      'household_name',
      'string',
      `${what} name.`,
      (row, ctx) => ctx.lookups.households.get(get(row, ctx))?.name,
    ),
  ];
}

/** `<prefix>_id/_name/_email/_phone` (+ `_date_of_birth`) for a contact reference. */
export function contactColumns<Row>(
  prefix: string,
  what: string,
  get: (row: Row, ctx: RowContext<unknown>) => IdLike,
  options: { dateOfBirth?: boolean } = {},
): ColumnDef<Row, unknown>[] {
  const contact = (row: Row, ctx: RowContext<unknown>): ContactRow | null =>
    ctx.lookups.contacts.get(get(row, ctx));
  return [
    column(`${prefix}_id`, 'id', `${what} (contact id).`, get),
    column(
      `${prefix}_name`,
      'string',
      `${what} full name.`,
      (row, ctx) => contact(row, ctx)?.name,
    ),
    column(
      `${prefix}_email`,
      'string',
      `${what} email.`,
      (row, ctx) => contact(row, ctx)?.email,
    ),
    column(
      `${prefix}_phone`,
      'string',
      `${what} phone.`,
      (row, ctx) => contact(row, ctx)?.phone,
    ),
    ...(options.dateOfBirth
      ? [
          column<Row>(
            `${prefix}_date_of_birth`,
            'date',
            `${what} date of birth.`,
            (row, ctx) => contact(row, ctx)?.dateOfBirth,
          ),
        ]
      : []),
  ];
}

/** `lead_source_id` + `lead_source_name`. */
export function leadSourceColumns<Row>(
  get: (row: Row) => IdLike,
  description: string,
): ColumnDef<Row, unknown>[] {
  return [
    column('lead_source_id', 'id', `${description} (lead source id).`, get),
    column('lead_source_name', 'string', `${description} (name).`, (row, ctx) =>
      ctx.lookups.leadSource(get(row)),
    ),
  ];
}

/** `<prefix>_street` … `<prefix>_zip`. */
export function addressColumns<Row>(
  prefix: string,
  what: string,
  get: (row: Row, ctx: RowContext<unknown>) => AddressLike | null | undefined,
  options: { street2?: boolean } = {},
): ColumnDef<Row, unknown>[] {
  return [
    column(
      `${prefix}_street`,
      'string',
      `${what}: street.`,
      (row, ctx) => get(row, ctx)?.street,
    ),
    ...(options.street2
      ? [
          column<Row>(
            `${prefix}_street2`,
            'string',
            `${what}: unit / apartment.`,
            (row, ctx) => get(row, ctx)?.street2,
          ),
        ]
      : []),
    column(
      `${prefix}_city`,
      'string',
      `${what}: city.`,
      (row, ctx) => get(row, ctx)?.city,
    ),
    column(
      `${prefix}_state`,
      'string',
      `${what}: state.`,
      (row, ctx) => get(row, ctx)?.state,
    ),
    column(
      `${prefix}_zip`,
      'string',
      `${what}: ZIP code.`,
      (row, ctx) => get(row, ctx)?.zip,
    ),
  ];
}

/**
 * The once-per-export tables plus the users the tenant columns name. Every
 * dataset's `joins` starts here.
 */
export async function primeTenant(
  lookups: ExportLookups,
  rows: readonly TenantFields[],
  extraUserIds: Iterable<IdLike> = [],
): Promise<void> {
  await Promise.all([
    lookups.branches(),
    lookups.leadSources(),
    lookups.users.load([...rows.map((row) => row.createdBy), ...extraUserIds]),
  ]);
}

/** Whole days between two `YYYYMMDD` dates, or null when either is missing. */
export function daysBetweenYmd(
  from: number | null | undefined,
  to: number | null | undefined,
): number | null {
  if (!from || !to) return null;
  const toUtc = (ymd: number) =>
    Date.UTC(
      Math.floor(ymd / 10_000),
      (Math.floor(ymd / 100) % 100) - 1,
      ymd % 100,
    );
  return Math.round((toUtc(to) - toUtc(from)) / 86_400_000);
}

/** Distinct, non-empty values in first-seen order. */
export function distinct(
  values: Iterable<string | null | undefined>,
): string[] {
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed && !out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}
