import { Types } from 'mongoose';

/**
 * A `$group` key as text, or `null` for the empty bucket. Keys are ids,
 * strings or numbers; anything else (a sub-document reaching a key is a bug)
 * is treated as empty rather than rendered as `[object Object]`.
 */
export function keyText(raw: unknown): string | null {
  if (raw instanceof Types.ObjectId) return raw.toHexString();
  if (typeof raw === 'string') return raw.trim() === '' ? null : raw;
  if (typeof raw === 'number') return String(raw);
  return null;
}
