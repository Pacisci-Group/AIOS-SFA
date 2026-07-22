/**
 * Tiny deterministic PRNG (mulberry32) + convenience helpers. Seeding demo data
 * from a fixed seed keeps every run byte-identical, so re-seeding is idempotent
 * and diffs/tests are stable. Not cryptographically secure — demo data only.
 */
export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** Random element of a non-empty array. */
  pick<T>(items: readonly T[]): T;
  /** `n` distinct random elements (or all, if n >= length), order shuffled. */
  sample<T>(items: readonly T[], n: number): T[];
  /** True with probability `p` (0..1). */
  chance(p: number): boolean;
  /** A shuffled copy of the array. */
  shuffle<T>(items: readonly T[]): T[];
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (min: number, max: number): number =>
    Math.floor(next() * (max - min + 1)) + min;

  const pick = <T>(items: readonly T[]): T => {
    if (items.length === 0) {
      throw new Error('rng.pick called on empty array');
    }
    return items[int(0, items.length - 1)];
  };

  const shuffle = <T>(items: readonly T[]): T[] => {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = int(0, i);
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  };

  const sample = <T>(items: readonly T[], n: number): T[] =>
    shuffle(items).slice(0, Math.max(0, Math.min(n, items.length)));

  const chance = (p: number): boolean => next() < p;

  return { next, int, pick, sample, chance, shuffle };
}
