import type { DataExportColumnType } from '@sfa/shared';
import { Types } from 'mongoose';
import { zonedDate } from '../../../performance/performance.range';
import type { CellValue } from './dataset.types';

/** Separator for a `list` cell. Not a comma: CSV readers split on those. */
export const LIST_SEPARATOR = '; ';

/**
 * A business instant's calendar date in the agency's timezone, as the
 * UTC-midnight `Date` a `date` column expects — the day the dashboards file
 * the row under (PAC-159). Every stored business date is a real instant now
 * (a day-only entry sits at agency-local midnight), so there is no longer a
 * "UTC midnight means a date-only value" special case.
 */
export function agencyCalendarDate(
  value: Date | null | undefined,
  timeZone: string,
): Date | null {
  if (!value || Number.isNaN(value.getTime())) return null;
  const { year, month, day } = zonedDate(value, timeZone);
  return new Date(Date.UTC(year, month - 1, day));
}

function asDate(value: CellValue): Date | null {
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function asText(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Types.ObjectId) return value.toHexString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    // A sub-document reaching a text cell is a column bug; JSON at least shows
    // what it was, where String() would print "[object Object]".
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return value;
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }
  return '';
}

/**
 * The value a CSV cell carries. Empty string for a missing value.
 *
 * Booleans are written as the words `true` / `false`: `csv-stringify`'s
 * default casts them to `1` and an **empty field**, which would make a false
 * flag indistinguishable from a missing one.
 */
export function csvCell(
  value: CellValue,
  type: DataExportColumnType,
): string | number {
  if (value == null) return '';
  switch (type) {
    case 'date': {
      const date = asDate(value);
      return date ? date.toISOString().slice(0, 10) : '';
    }
    case 'datetime': {
      const date = asDate(value);
      return date ? date.toISOString() : '';
    }
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? value : '';
    case 'boolean':
      return typeof value === 'boolean' ? String(value) : '';
    case 'list':
      return Array.isArray(value)
        ? // Empty items are kept: several lists are *aligned* (a household's
          // member ids, names and roles), and dropping a blank would shift
          // every item after it onto the wrong person.
          value.map(asText).join(LIST_SEPARATOR)
        : asText(value);
    case 'id':
    case 'string':
      return asText(value);
  }
}

/**
 * The value an XLSX cell carries: a real `Date` for dates (exceljs writes a
 * date serial from its UTC time, so a UTC-midnight date lands on its own day),
 * a number for numbers, text for everything else — ids included, so a policy
 * number keeps its leading zeros.
 */
export function xlsxCell(
  value: CellValue,
  type: DataExportColumnType,
): string | number | boolean | Date | null {
  if (value == null) return null;
  switch (type) {
    case 'date':
    case 'datetime':
      return asDate(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? value : null;
    case 'boolean':
      return typeof value === 'boolean' ? value : null;
    default: {
      const text = csvCell(value, type);
      return text === '' ? null : String(text);
    }
  }
}
