/**
 * Extractors that turn hydrated SmartSuite field payloads into plain JS values.
 * SmartSuite returns wildly different shapes per field type (dates as
 * { date, include_time }, currency as "232.00$", linked records as string[] or
 * arrays of hydrated objects, selects as codes or { value, label }, lookups as
 * deeply nested arrays), so these helpers defensively unwrap them.
 */

type Dict = Record<string, unknown>;

function isDict(value: unknown): value is Dict {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const cleaned = value.replace(/[^0-9.-]/g, '');
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : 0;
  }
  if (Array.isArray(value)) return toNumber(value[0]);
  return 0;
}

export function toDate(value: unknown): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const d = new Date(value);
    return isNaN(d.getTime()) ? undefined : d;
  }
  if (isDict(value)) {
    if (value.date) return toDate(value.date);
    if (isDict(value.on)) return toDate(value.on.date ?? value.on);
    if (value.from_date) return toDate(value.from_date);
  }
  return undefined;
}

/** Linked-record fields hold arrays of record ids. Return the first id. */
export function firstLinkedId(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') return value || undefined;
  if (Array.isArray(value)) {
    const first: unknown = value[0];
    if (typeof first === 'string') return first || undefined;
    if (isDict(first)) return asString(first.id) ?? asString(first.record_id);
  }
  return undefined;
}

export function allLinkedIds(value: unknown): string[] {
  if (!value) return [];
  if (typeof value === 'string') return value ? [value] : [];
  if (Array.isArray(value)) {
    return value
      .map((v: unknown): string | undefined => {
        if (typeof v === 'string') return v;
        if (isDict(v)) return asString(v.id) ?? asString(v.record_id);
        return undefined;
      })
      .filter((v): v is string => typeof v === 'string' && v.length > 0);
  }
  return [];
}

/** Single-select: return the raw choice *value* (code), not the label. */
export function selectCode(value: unknown): string | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return selectCode(value[0]);
  if (isDict(value)) return asString(value.value) ?? asString(value.id);
  return undefined;
}

/** Emails come as arrays of strings. */
export function toStringArray(value: unknown): string[] {
  if (!value) return [];
  if (typeof value === 'string') return value ? [value] : [];
  if (Array.isArray(value)) {
    return value.filter(
      (v): v is string => typeof v === 'string' && v.length > 0,
    );
  }
  return [];
}

/** Phone fields: array of { phone_number, phone_country, ... }. */
export function toPhoneArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((p: unknown): string => {
      if (typeof p === 'string') return p;
      if (isDict(p)) return asString(p.phone_number) ?? '';
      return '';
    })
    .filter((v) => v.length > 0);
}

/** Text / formula string field; also unwraps single-element arrays. */
export function toText(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return toText(value[0]);
  return undefined;
}

/** Boolean field. */
export function toBool(value: unknown): boolean {
  return value === true || value === 'true' || value === 1;
}

/**
 * Derive a YYYYMMDD integer from a date. Uses the date parts directly (SmartSuite
 * stores calendar dates without a meaningful time), matching legacy sold_yyyymmdd_num.
 */
export function toYmd(date: Date | undefined): number | undefined {
  if (!date) return undefined;
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  return y * 10000 + m * 100 + d;
}
