/**
 * Initials for an avatar: "Pat Producer" -> "PP", "Cher" -> "C".
 *
 * Lives in `common/` rather than in either caller because the Motivation Hub
 * (PAC-13) and the Hot Leads panel (PAC-15) both render avatars, and a
 * leaderboard importing from a leads module — or vice versa — would couple two
 * features that have nothing else to say to each other.
 *
 * Returns `?` rather than an empty string for a nameless record: an avatar with
 * nothing in it looks like a rendering bug, and this is a display value with no
 * caller equipped to handle a blank.
 */
export function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : '';
  return `${first}${last}`.toUpperCase();
}
