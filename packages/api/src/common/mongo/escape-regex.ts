/**
 * Escape a user-supplied string before embedding it in a `$regex`.
 *
 * Without this a search for `a.b` matches `axb`, and a search for `(` is a
 * Mongo syntax error surfacing as a 500. Extracted from `LeadsService` when
 * the platform user directory became its second caller.
 */
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
