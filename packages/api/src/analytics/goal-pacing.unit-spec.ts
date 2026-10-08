import { computePacing, pacingMonth } from './goal-pacing';

describe('pacingMonth', () => {
  it('is the month of a window that starts on the 1st and stays inside it', () => {
    expect(pacingMonth({ from: '2026-05-01', to: '2026-05-21' })).toBe(
      '2026-05',
    );
    expect(pacingMonth({ from: '2026-05-01', to: '2026-05-31' })).toBe(
      '2026-05',
    );
  });

  it('is null for a window that crosses months or starts mid-month', () => {
    expect(pacingMonth({ from: '2026-04-01', to: '2026-05-31' })).toBeNull();
    expect(pacingMonth({ from: '2026-05-10', to: '2026-05-20' })).toBeNull();
  });
});

describe('computePacing', () => {
  const base = {
    month: '2026-05',
    goalPremium: 31_000,
    producersWithGoals: 2,
    windowTo: '2026-05-31',
  };

  it('pro-rates the goal and projects the month from the pace so far', () => {
    const pacing = computePacing({
      ...base,
      boundPremium: 12_000,
      today: { year: 2026, month: 5, day: 10 },
    });
    expect(pacing).toMatchObject({
      daysInMonth: 31,
      elapsedDays: 10,
      elapsedPct: 32.3,
      expectedToDate: 10_000,
      projectedPremium: 37_200,
      attainmentPct: 38.7,
      status: 'ahead',
    });
  });

  it('is behind below the pro-rata line', () => {
    expect(
      computePacing({
        ...base,
        boundPremium: 5_000,
        today: { year: 2026, month: 5, day: 10 },
      }).status,
    ).toBe('behind');
  });

  it('counts a past month in full and reports the goal met', () => {
    const pacing = computePacing({
      ...base,
      boundPremium: 40_000,
      today: { year: 2026, month: 6, day: 3 },
    });
    expect(pacing).toMatchObject({
      elapsedDays: 31,
      elapsedPct: 100,
      projectedPremium: 40_000,
      status: 'achieved',
    });
  });

  it('stops elapsed days at the window end for a part-month window', () => {
    expect(
      computePacing({
        ...base,
        windowTo: '2026-05-15',
        boundPremium: 1,
        today: { year: 2026, month: 6, day: 1 },
      }).elapsedDays,
    ).toBe(15);
  });

  it('has elapsed nothing, and projects nothing, before the month starts', () => {
    const pacing = computePacing({
      ...base,
      boundPremium: 0,
      today: { year: 2026, month: 4, day: 20 },
    });
    expect(pacing.elapsedDays).toBe(0);
    expect(pacing.projectedPremium).toBeNull();
  });
});
