import type { IntakeChannel } from '@sfa/shared';

/**
 * Pure normalisation helpers for the lead-intake pipeline (PAC-37).
 *
 * Everything here is deliberately dependency-free so it can be unit-tested
 * without Mongoose. These rules are applied on **both sides** of every
 * comparison — the submitted value and the stored one — which is what fixes the
 * legacy tiebreak that compared a raw submission against a differently-shaped
 * stored value and therefore never matched.
 */

/** Lowercased + trimmed, or null when there's nothing usable. */
export function normalizeEmail(raw?: string | null): string | null {
  const value = raw?.trim().toLowerCase();
  return value ? value : null;
}

/**
 * Digits only. Strips the punctuation people type — `(555) 123-4567`,
 * `555.123.4567`, `+1 555 123 4567` all collapse to a comparable string.
 *
 * Note this keeps a leading country code as digits (`+1 555…` → `15551234567`),
 * so callers comparing a 10-digit and an 11-digit form of the same number should
 * use {@link phonesMatch} rather than raw equality.
 */
export function normalizePhone(raw?: string | null): string | null {
  const digits = raw?.replace(/\D/g, '');
  return digits ? digits : null;
}

/** Collapses internal whitespace and trims. */
export function normalizeName(raw?: string | null): string {
  return raw?.trim().replace(/\s+/g, ' ') ?? '';
}

/**
 * True when two phone numbers are the same, tolerating a US country code on
 * either side: `5551234567` and `15551234567` are one number.
 */
export function phonesMatch(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const stripUs = (v: string) =>
    v.length === 11 && v.startsWith('1') ? v.slice(1) : v;
  return stripUs(a) === stripUs(b);
}

/**
 * Parse a `YYYY-MM-DD` date of birth to **UTC midnight**.
 *
 * Built from explicit components rather than `new Date(str)`: a date-only ISO
 * string is spec'd as UTC, but the near-identical `new Date('1990-02-05T00:00')`
 * is local, and the two silently disagree by a day for anyone west of Greenwich.
 * A birthday that shifts by a day breaks contact matching, so this never goes
 * near the local timezone.
 */
export function parseDateOfBirth(raw?: string | null): Date | null {
  const value = raw?.trim();
  if (!value) return null;

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const [, year, month, day] = match;
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;

  const parsed = new Date(Date.UTC(y, m - 1, d));
  // Rejects impossible dates that Date.UTC would roll over (2025-02-30 → Mar 2).
  if (
    parsed.getUTCFullYear() !== y ||
    parsed.getUTCMonth() !== m - 1 ||
    parsed.getUTCDate() !== d
  ) {
    return null;
  }
  return parsed;
}

/** A stored `Date` back to `YYYY-MM-DD` in UTC — the comparison key for DOB. */
export function toDateKey(value?: Date | string | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * `"<street>|<zip>"`, both lowercased and trimmed. Null unless **both** parts are
 * present — a key built from half an address would collapse unrelated leads.
 *
 * (Legacy lowercased the street but only trimmed the zip, so `90210 ` and
 * `90210` produced different keys.)
 */
export function buildAddressKey(
  street?: string | null,
  zip?: string | null,
): string | null {
  const s = street?.trim().toLowerCase();
  const z = zip?.trim().toLowerCase();
  return s && z ? `${s}|${z}` : null;
}

/**
 * Namespace a client-supplied submission token by channel.
 *
 * Legacy used a bare `FILLOUT|{submissionId}`. Ours carries the channel (and the
 * share link, when there is one) so a client-chosen UUID can never collide with
 * a Fillout token or with another link's, and the stored value is legible when
 * you're staring at a duplicate in the database.
 */
export function buildSubmissionToken(
  channel: IntakeChannel,
  raw?: string | null,
  shareLinkId?: string | null,
): string | null {
  const token = raw?.trim();
  if (!token) return null;
  const prefix =
    channel === 'share_link' ? `SHARE|${shareLinkId ?? 'unknown'}` : 'WEB';
  return `${prefix}|${token.toUpperCase()}`;
}
