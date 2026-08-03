import { DEFAULT_ONBOARDING_STEP_DEFINITIONS } from '@sfa/shared';
import type { OnboardingStepDefinition, OnboardingStepKey } from '@sfa/shared';
import {
  computeStepTiming,
  deriveOnboardingStatus,
  isStepActionable,
  isStepOverdue,
  scheduleSteps,
} from './onboarding-scheduling';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Onboarding started (deal audit approved) day 0 at 09:00. */
const STARTED = new Date('2026-01-01T09:00:00.000Z');

/** A time `days` after the onboarding started, optionally offset within the day. */
const at = (days: number, offsetMs = 0): Date =>
  new Date(STARTED.getTime() + days * DAY_MS + offsetMs);

const DEFS = DEFAULT_ONBOARDING_STEP_DEFINITIONS;
const def = (stepKey: OnboardingStepKey): OnboardingStepDefinition => {
  const found = DEFS.find((d) => d.stepKey === stepKey);
  if (!found) throw new Error(`missing definition: ${stepKey}`);
  return found;
};

describe('computeStepTiming', () => {
  it('opens the welcome call the moment onboarding starts', () => {
    const timing = computeStepTiming(def('welcome_call'), STARTED, null);

    expect(timing.availableAt).toEqual(STARTED);
    // 48h SLA.
    expect(timing.dueAt).toEqual(at(2));
  });

  it('leaves a step unschedulable while its predecessor is incomplete', () => {
    const timing = computeStepTiming(def('checkin_3day'), STARTED, {
      completedAt: null,
    });

    // Nothing to schedule yet — this is what stops the next ticket being
    // created before the current call has been made.
    expect(timing).toEqual({ availableAt: null, dueAt: null });
  });

  /**
   * The load-bearing case, settled with the owner: the offset runs from the
   * completion *instant*, not from the following day boundary. Welcome call
   * completed day 4 at 14:30 => the 3-day check-in opens day 7 at 14:30.
   */
  it('runs the 3-day offset from the completion instant (day 4 -> day 7)', () => {
    const completedAt = at(4, 5.5 * HOUR_MS); // day 4, 14:30

    const timing = computeStepTiming(def('checkin_3day'), STARTED, {
      completedAt,
    });

    expect(timing.availableAt).toEqual(at(7, 5.5 * HOUR_MS));
    expect(timing.dueAt).toEqual(at(9, 5.5 * HOUR_MS));
  });

  it('preserves the time of day rather than snapping to a boundary', () => {
    const completedAt = at(4, 23 * HOUR_MS + 45 * 60_000);
    const timing = computeStepTiming(def('checkin_3day'), STARTED, {
      completedAt,
    });

    expect(timing.availableAt?.getTime()).toBe(
      completedAt.getTime() + 3 * DAY_MS,
    );
  });

  describe('the 30-day check-in: max(start + 30d, previous completion)', () => {
    it('opens 30 days after the START, not the previous call', () => {
      // 3-day call ran on day 8; the 30-day check-in is still "one month in".
      const timing = computeStepTiming(def('checkin_30day'), STARTED, {
        completedAt: at(8),
      });

      expect(timing.availableAt).toEqual(at(30));
      expect(timing.dueAt).toEqual(at(32));
    });

    it('does not drift when the earlier calls run late', () => {
      const early = computeStepTiming(def('checkin_30day'), STARTED, {
        completedAt: at(4),
      });
      const late = computeStepTiming(def('checkin_30day'), STARTED, {
        completedAt: at(20),
      });

      expect(early.availableAt).toEqual(at(30));
      expect(late.availableAt).toEqual(at(30));
    });

    it('never opens before the 3-day call has closed', () => {
      // The 3-day call slipped to day 44 — past the 30-day mark. The max()
      // pushes the 30-day check-in out rather than opening it retroactively.
      const timing = computeStepTiming(def('checkin_30day'), STARTED, {
        completedAt: at(44),
      });

      expect(timing.availableAt).toEqual(at(44));
      expect(timing.dueAt).toEqual(at(46));
    });
  });
});

describe('scheduleSteps (chain planning)', () => {
  it('plans only the first step when nothing is complete', () => {
    const planned = scheduleSteps(DEFS, STARTED);

    expect(planned).toHaveLength(3);
    expect(planned.map((s) => s.stepKey)).toEqual([
      'welcome_call',
      'checkin_3day',
      'checkin_30day',
    ]);
    expect(planned[0].availableAt).toEqual(STARTED);

    for (const step of planned.slice(1)) {
      expect(step.availableAt).toBeNull();
      expect(step.dueAt).toBeNull();
    }
  });

  it('plans the next step once the previous completes', () => {
    const planned = scheduleSteps(DEFS, STARTED, {
      welcome_call: at(4, 5.5 * HOUR_MS),
    });

    expect(
      planned.find((s) => s.stepKey === 'checkin_3day')?.availableAt,
    ).toEqual(at(7, 5.5 * HOUR_MS));

    // Still gated behind the 3-day check-in.
    expect(
      planned.find((s) => s.stepKey === 'checkin_30day')?.availableAt,
    ).toBeNull();
  });

  it('plans the whole chain once both earlier calls are done', () => {
    const planned = scheduleSteps(DEFS, STARTED, {
      welcome_call: at(1),
      checkin_3day: at(5),
    });

    expect(
      planned.find((s) => s.stepKey === 'checkin_30day')?.availableAt,
    ).toEqual(at(30));
  });

  it('sorts by sortOrder regardless of the order definitions arrive in', () => {
    const planned = scheduleSteps([...DEFS].reverse(), STARTED);

    expect(planned.map((s) => s.stepKey)).toEqual(DEFS.map((d) => d.stepKey));
    expect(planned[0].availableAt).toEqual(STARTED);
  });
});

describe('deriveOnboardingStatus (one step per ticket)', () => {
  const step = (
    availableAt: Date | null,
    dueAt: Date | null,
    completedAt: Date | null = null,
  ) => ({ availableAt, dueAt, completedAt });

  it('is resolved once the step is complete', () => {
    expect(deriveOnboardingStatus(step(at(0), at(2), at(1)), at(10))).toBe(
      'resolved',
    );
  });

  it('is open while available and inside SLA', () => {
    expect(deriveOnboardingStatus(step(at(0), at(2)), at(1))).toBe('open');
  });

  it('is overdue once past due', () => {
    expect(deriveOnboardingStatus(step(at(0), at(2)), at(3))).toBe('overdue');
  });

  it('is waiting while scheduled but not yet open', () => {
    expect(deriveOnboardingStatus(step(at(5), at(7)), at(3))).toBe('waiting');
  });

  it('is waiting when not schedulable at all', () => {
    expect(deriveOnboardingStatus(step(null, null), at(3))).toBe('waiting');
  });

  it('stays resolved even if it was completed after its due date', () => {
    expect(deriveOnboardingStatus(step(at(0), at(2), at(9)), at(10))).toBe(
      'resolved',
    );
  });

  /**
   * The case a stored status field cannot represent: nothing is written, the
   * clock simply moves, and the ticket transitions on its own.
   */
  it('moves waiting -> open -> overdue on clock movement alone', () => {
    const scheduled = step(at(5), at(7));

    expect(deriveOnboardingStatus(scheduled, at(4))).toBe('waiting');
    expect(deriveOnboardingStatus(scheduled, at(6))).toBe('open');
    expect(deriveOnboardingStatus(scheduled, at(8))).toBe('overdue');
  });
});

describe('step flags', () => {
  const pending = { availableAt: at(2), dueAt: at(4), completedAt: null };

  it('is actionable only once available and still incomplete', () => {
    expect(isStepActionable(pending, at(1))).toBe(false);
    expect(isStepActionable(pending, at(3))).toBe(true);
    expect(isStepActionable({ ...pending, completedAt: at(3) }, at(3))).toBe(
      false,
    );
  });

  it('is not actionable while unscheduled', () => {
    expect(
      isStepActionable(
        { availableAt: null, dueAt: null, completedAt: null },
        at(9),
      ),
    ).toBe(false);
  });

  it('is overdue only when incomplete and past due', () => {
    expect(isStepOverdue(pending, at(3))).toBe(false);
    expect(isStepOverdue(pending, at(5))).toBe(true);
    expect(isStepOverdue({ ...pending, completedAt: at(5) }, at(5))).toBe(
      false,
    );
  });
});
