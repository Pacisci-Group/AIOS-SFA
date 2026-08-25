import { LeaderboardRow, attainment, rankRows } from './leaderboard.normalize';

function row(overrides: Partial<LeaderboardRow>): LeaderboardRow {
  return {
    producerId: 'a',
    name: 'A',
    premium: 0,
    goalPremium: null,
    attainmentPct: null,
    ...overrides,
  };
}

describe('attainment', () => {
  it('is a percentage rounded to one decimal', () => {
    expect(attainment(32_500, 45_000)).toBe(72.2);
    expect(attainment(5000, 10_000)).toBe(50);
  });

  it('can exceed 100 — beating the goal is the point', () => {
    expect(attainment(60_000, 45_000)).toBe(133.3);
  });

  it('is null, not 0, when there is no goal row', () => {
    // Unknown attainment. Rendering 0% would show an empty bar next to real
    // sales, which reads as failure rather than as missing configuration.
    expect(attainment(32_500, null)).toBeNull();
  });

  it('is null for a non-positive goal rather than Infinity or negative', () => {
    expect(attainment(32_500, 0)).toBeNull();
    expect(attainment(32_500, -100)).toBeNull();
  });

  it('is 0 for a real goal and no sales — that attainment IS known', () => {
    expect(attainment(0, 45_000)).toBe(0);
  });
});

describe('rankRows', () => {
  it('orders by attainment descending', () => {
    const ranked = rankRows([
      row({ producerId: 'b', premium: 26_100, attainmentPct: 58 }),
      row({ producerId: 'a', premium: 38_200, attainmentPct: 82 }),
      row({ producerId: 'c', premium: 32_500, attainmentPct: 71 }),
    ]);

    expect(ranked.map((r) => r.producerId)).toEqual(['a', 'c', 'b']);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it('does NOT order by premium — the hidden number must not drive the board', () => {
    // 'low' has more premium but a bigger goal, so less attainment. Ranking by
    // premium would put it first, above a visibly higher percentage.
    const ranked = rankRows([
      row({ producerId: 'low', premium: 90_000, attainmentPct: 45 }),
      row({ producerId: 'high', premium: 10_000, attainmentPct: 99 }),
    ]);

    expect(ranked[0].producerId).toBe('high');
  });

  it('sorts producers without a goal last', () => {
    const ranked = rankRows([
      row({ producerId: 'nogoal', premium: 99_000, attainmentPct: null }),
      row({ producerId: 'goal', premium: 1000, attainmentPct: 12 }),
    ]);

    expect(ranked.map((r) => r.producerId)).toEqual(['goal', 'nogoal']);
  });

  it('orders goal-less producers among themselves by premium', () => {
    const ranked = rankRows([
      row({ producerId: 'small', premium: 100, attainmentPct: null }),
      row({ producerId: 'big', premium: 900, attainmentPct: null }),
    ]);

    expect(ranked.map((r) => r.producerId)).toEqual(['big', 'small']);
  });

  it('gives tied rows the same rank and skips the next', () => {
    // Competition ranking: two firsts, then third. No second place.
    const ranked = rankRows([
      row({ producerId: 'a', premium: 1000, attainmentPct: 82 }),
      row({ producerId: 'b', premium: 1000, attainmentPct: 82 }),
      row({ producerId: 'c', premium: 500, attainmentPct: 40 }),
    ]);

    expect(ranked.map((r) => r.rank)).toEqual([1, 1, 3]);
  });

  it('does not tie rows that share attainment but differ in premium', () => {
    // Same percentage against different goals. They are distinguishable, so
    // collapsing them to one rank would hide a real difference.
    const ranked = rankRows([
      row({ producerId: 'a', premium: 9000, attainmentPct: 50 }),
      row({ producerId: 'b', premium: 1000, attainmentPct: 50 }),
    ]);

    expect(ranked.map((r) => r.rank)).toEqual([1, 2]);
  });

  it('is deterministic for otherwise identical rows', () => {
    // Without a final tiebreak the board would reshuffle between refreshes.
    const rows = [
      row({ producerId: 'z', premium: 1000, attainmentPct: 50 }),
      row({ producerId: 'y', premium: 1000, attainmentPct: 50 }),
    ];
    expect(rankRows(rows).map((r) => r.producerId)).toEqual(
      rankRows([...rows].reverse()).map((r) => r.producerId),
    );
  });

  it('does not mutate its input', () => {
    const rows = [
      row({ producerId: 'b', attainmentPct: 10 }),
      row({ producerId: 'a', attainmentPct: 90 }),
    ];
    rankRows(rows);
    expect(rows.map((r) => r.producerId)).toEqual(['b', 'a']);
  });

  it('returns an empty list for an empty board', () => {
    expect(rankRows([])).toEqual([]);
  });
});
