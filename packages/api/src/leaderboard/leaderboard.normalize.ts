/**
 * Pure ranking + attainment logic for the Motivation Hub (PAC-13).
 *
 * No Mongoose, no I/O. The ordering rule is a product decision, so it lives
 * somewhere it can be read and tested on its own rather than buried in a
 * pipeline.
 */

/** A producer's month, before ranking. */
export interface LeaderboardRow {
  producerId: string;
  name: string;
  premium: number;
  goalPremium: number | null;
  attainmentPct: number | null;
}

export interface RankedRow extends LeaderboardRow {
  rank: number;
}

/**
 * Goal attainment as a percentage, rounded to one decimal.
 *
 * `null` — not `0` — when there is no usable goal. A producer with no goal row
 * has an *unknown* attainment, and rendering that as 0% would show an empty
 * progress bar next to real sales, which reads as failure rather than as
 * missing configuration. A non-positive goal is treated the same way: dividing
 * by it would produce `Infinity` or a negative percentage.
 */
export function attainment(
  premium: number,
  goalPremium: number | null,
): number | null {
  if (goalPremium === null || goalPremium <= 0) return null;
  return Math.round((premium / goalPremium) * 1000) / 10;
}

/** Initials from a display name: "Pat Producer" -> "PP", "Cher" -> "C". */
export function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : '';
  return `${first}${last}`.toUpperCase();
}

/**
 * Rank by `attainmentPct` descending.
 *
 * Ranking by premium would be the obvious alternative, but `attainmentPct` is
 * the *only* quantity rendered on each row — a list ordered by a number the
 * viewer cannot see reads as broken (rank 1 at 82% sitting above rank 2 at 90%
 * looks like a bug, and no amount of tooltip explains it away).
 *
 * Producers with no goal sort last, ordered among themselves by premium
 * descending: they still belong on the board, they just cannot be placed on the
 * same axis as everyone else.
 *
 * Ties share a rank and the following rank skips — standard competition
 * ranking, so two producers at 82% are both 1st and the next is 3rd.
 */
export function rankRows(rows: LeaderboardRow[]): RankedRow[] {
  const sorted = [...rows].sort((a, b) => {
    const aHas = a.attainmentPct !== null;
    const bHas = b.attainmentPct !== null;
    if (aHas !== bHas) return aHas ? -1 : 1;
    if (aHas && bHas && a.attainmentPct !== b.attainmentPct) {
      return b.attainmentPct! - a.attainmentPct!;
    }
    if (a.premium !== b.premium) return b.premium - a.premium;
    // Stable final tiebreak so the board doesn't reshuffle between refreshes.
    return a.producerId.localeCompare(b.producerId);
  });

  const ranked: RankedRow[] = [];
  let lastKey: string | null = null;
  let lastRank = 0;

  sorted.forEach((row, index) => {
    // Rows tie only when both the visible number and the hidden one match;
    // otherwise two producers with equal attainment but different premium
    // would be indistinguishable on the board.
    const key = `${row.attainmentPct ?? 'none'}|${row.premium}`;
    const rank = key === lastKey ? lastRank : index + 1;
    lastKey = key;
    lastRank = rank;
    ranked.push({ ...row, rank });
  });

  return ranked;
}
