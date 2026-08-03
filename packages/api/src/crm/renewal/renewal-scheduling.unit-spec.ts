import {
  DEFAULT_RENEWAL_STEP_DEFINITIONS,
  renewalTrackFor,
  normalizePolicyType,
} from '@sfa/shared';
import type { RenewalStepDefinition } from '@sfa/shared';
import { deriveStepStatus } from '../scheduling/step-status';
import {
  computeRenewalStepTiming,
  daysUntil,
  formatTermKey,
  renewalAnchorDate,
  scheduleRenewalSteps,
} from './renewal-scheduling';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** The carrier's renewal date: day 0 at 09:00. */
const RENEWAL = new Date('2026-07-01T09:00:00.000Z');

/** A time `days` *before* the renewal date — renewal steps count backwards. */
const before = (days: number, offsetMs = 0): Date =>
  new Date(RENEWAL.getTime() - days * DAY_MS + offsetMs);

const DEFS = DEFAULT_RENEWAL_STEP_DEFINITIONS;
const def = (
  track: 'annual' | 'semiannual',
  stepKey: 'annual_review' | 'renewal_review',
): RenewalStepDefinition => {
  const found = DEFS.find((d) => d.track === track && d.stepKey === stepKey);
  if (!found) throw new Error(`missing definition: ${track}/${stepKey}`);
  return found;
};

describe('computeRenewalStepTiming', () => {
  it('opens the annual review 90 days out, overdue 48h later', () => {
    const timing = computeRenewalStepTiming(
      def('annual', 'annual_review'),
      RENEWAL,
    );

    expect(timing.availableAt).toEqual(before(90));
    expect(timing.dueAt).toEqual(before(88));
  });

  it('opens the renewal review 45 days out, overdue 48h later', () => {
    const timing = computeRenewalStepTiming(
      def('annual', 'renewal_review'),
      RENEWAL,
    );

    expect(timing.availableAt).toEqual(before(45));
    expect(timing.dueAt).toEqual(before(43));
  });

  it('keeps the clock time of the renewal date', () => {
    // Offsets are exact elapsed time, so a renewal at 09:00 opens its calls at
    // 09:00 — no rounding to midnight, no business calendar.
    const timing = computeRenewalStepTiming(
      def('annual', 'annual_review'),
      RENEWAL,
    );

    expect(timing.availableAt.toISOString()).toBe('2026-04-02T09:00:00.000Z');
  });
});

describe('scheduleRenewalSteps', () => {
  it('plans both calls on the annual track', () => {
    const planned = scheduleRenewalSteps(DEFS, 'annual', RENEWAL);

    expect(planned.map((s) => s.stepKey)).toEqual([
      'annual_review',
      'renewal_review',
    ]);
    expect(planned.map((s) => s.sequence)).toEqual([1, 2]);
    expect(planned[0].availableAt).toEqual(before(90));
    expect(planned[1].availableAt).toEqual(before(45));
  });

  it('plans exactly one merged call on the semiannual track', () => {
    // Auto renews every 6 months, so there is no room for a 90-day warm-up:
    // the annual review is absorbed into the 45-day call.
    const planned = scheduleRenewalSteps(DEFS, 'semiannual', RENEWAL);

    expect(planned).toHaveLength(1);
    expect(planned[0].stepKey).toBe('renewal_review');
    expect(planned[0].sequence).toBe(1);
    expect(planned[0].availableAt).toEqual(before(45));
    expect(planned[0].mergedFrom).toEqual(['annual_review']);
  });

  it('carries both agendas on the merged call and neither track leaks', () => {
    const merged = def('semiannual', 'renewal_review');
    const annualReview = def('annual', 'annual_review');
    const renewalReview = def('annual', 'renewal_review');

    // Everything the two separate calls cover is on the single one.
    for (const key of [
      ...annualReview.agendaKeys,
      ...renewalReview.agendaKeys,
    ]) {
      expect(merged.agendaKeys).toContain(key);
    }
    // …and the annual track's calls are not themselves merged.
    expect(annualReview.mergedFrom).toEqual([]);
    expect(renewalReview.mergedFrom).toEqual([]);
  });

  /**
   * The case onboarding gets deliberately backwards. `computeStepTiming` would
   * return NOT_SCHEDULABLE here, which would mean a client whose warm-up call
   * was missed never gets called about their actual renewal.
   */
  it('schedules the renewal review even when the annual review was never made', () => {
    const planned = scheduleRenewalSteps(DEFS, 'annual', RENEWAL, {
      annual_review: null,
    });

    const renewalReview = planned.find((s) => s.stepKey === 'renewal_review')!;
    expect(renewalReview.availableAt).toEqual(before(45));
    expect(renewalReview.dueAt).toEqual(before(43));
  });

  /** The other half of the same rule: a late warm-up must not move the T-45 call. */
  it('does not push the renewal review out when the annual review runs late', () => {
    const planned = scheduleRenewalSteps(DEFS, 'annual', RENEWAL, {
      // Warm-up finally made at T-46, a month and a half late.
      annual_review: before(46),
    });

    const renewalReview = planned.find((s) => s.stepKey === 'renewal_review')!;
    expect(renewalReview.availableAt).toEqual(before(45));
  });

  it('carries completion through to the plan', () => {
    const completedAt = before(89);
    const planned = scheduleRenewalSteps(DEFS, 'annual', RENEWAL, {
      annual_review: completedAt,
    });

    expect(planned[0].completedAt).toEqual(completedAt);
    expect(planned[1].completedAt).toBeNull();
  });

  it('respects sortOrder however the definitions arrive', () => {
    // The definitions come from editable config, so a reordered collection
    // must not reorder the outreach.
    const shuffled = [...DEFS].reverse();
    const planned = scheduleRenewalSteps(shuffled, 'annual', RENEWAL);

    expect(planned.map((s) => s.stepKey)).toEqual([
      'annual_review',
      'renewal_review',
    ]);
  });
});

describe('renewalTrackFor', () => {
  it.each(['Auto', 'auto', '  AUTO  ', 'Autos'])(
    'puts %p on the semiannual track',
    (policyType) => {
      expect(renewalTrackFor(policyType)).toBe('semiannual');
    },
  );

  it.each(['Home', 'Life', 'Umbrella', 'Renters', '', null, undefined])(
    'puts %p on the annual track',
    (policyType) => {
      expect(renewalTrackFor(policyType)).toBe('annual');
    },
  );

  it('normalizes the free-form policyType string', () => {
    // `Policy.policyType` has no enum behind it, so the match has to tolerate
    // whatever the carrier import produced.
    expect(normalizePolicyType('  Home   Owners ')).toBe('home owner');
  });
});

describe('formatTermKey', () => {
  it('is the UTC calendar day of the renewal date', () => {
    expect(formatTermKey(RENEWAL)).toBe('2026-07-01');
  });

  it('ignores time of day, so one term has one key', () => {
    expect(formatTermKey(new Date('2026-07-01T23:59:59.000Z'))).toBe(
      formatTermKey(new Date('2026-07-01T00:00:00.000Z')),
    );
  });

  it('differs next term, which is what makes it a new cycle', () => {
    const nextYear = new Date(RENEWAL.getTime() + 365 * DAY_MS);
    expect(formatTermKey(nextYear)).not.toBe(formatTermKey(RENEWAL));
  });
});

describe('renewalAnchorDate', () => {
  it('prefers renewalDate', () => {
    const expiration = new Date('2026-08-01T00:00:00.000Z');
    expect(
      renewalAnchorDate({ renewalDate: RENEWAL, expirationDate: expiration }),
    ).toEqual(RENEWAL);
  });

  it('falls back to expirationDate', () => {
    // Much of the migrated book carries only an expiration date, and for a
    // renewing policy the two are the same moment.
    expect(
      renewalAnchorDate({ renewalDate: null, expirationDate: RENEWAL }),
    ).toEqual(RENEWAL);
  });

  it('accepts ISO strings, as they come off a lean() read', () => {
    expect(renewalAnchorDate({ renewalDate: RENEWAL.toISOString() })).toEqual(
      RENEWAL,
    );
  });

  it('returns null when there is nothing to count down to', () => {
    expect(renewalAnchorDate({})).toBeNull();
    expect(renewalAnchorDate({ renewalDate: null })).toBeNull();
    expect(renewalAnchorDate({ renewalDate: 'not a date' })).toBeNull();
  });
});

describe('derived status over a renewal call', () => {
  const annualReview = () =>
    computeRenewalStepTiming(def('annual', 'annual_review'), RENEWAL);

  /**
   * The case a stored status field cannot represent: nothing is written, the
   * clock simply moves.
   */
  it('moves waiting -> open -> overdue on clock movement alone', () => {
    const step = { ...annualReview(), completedAt: null };

    expect(deriveStepStatus(step, before(95))).toBe('waiting');
    expect(deriveStepStatus(step, before(89))).toBe('open');
    expect(deriveStepStatus(step, before(80))).toBe('overdue');
  });

  it('is open for exactly the 48h SLA', () => {
    const step = { ...annualReview(), completedAt: null };

    expect(deriveStepStatus(step, before(90))).toBe('open');
    expect(deriveStepStatus(step, before(88, -1))).toBe('open');
    expect(deriveStepStatus(step, before(88, 1))).toBe('overdue');
  });

  it('is resolved once completed, however late', () => {
    const step = { ...annualReview(), completedAt: before(70) };
    expect(deriveStepStatus(step, before(60))).toBe('resolved');
  });
});

describe('daysUntil', () => {
  it('counts whole days to the renewal', () => {
    expect(daysUntil(RENEWAL, before(90))).toBe(90);
    expect(daysUntil(RENEWAL, before(45))).toBe(45);
  });

  it('goes negative once the policy has renewed', () => {
    expect(daysUntil(RENEWAL, before(-3))).toBe(-3);
  });

  it('floors a partial day rather than rounding up', () => {
    // 44 days and 23 hours out is still "44 days away", never 45.
    expect(daysUntil(RENEWAL, before(45, HOUR_MS))).toBe(44);
  });
});
