import {
  DEFAULT_RENEWAL_STEP_DEFINITIONS,
  POLICY_TYPE_CODE_ALIASES,
  SEMIANNUAL_TERM_POLICY_TYPES,
  isSemiannualPolicyType,
  renewalTrackFor,
  nextRenewalDate,
  normalizeRenewalPolicyType,
} from '@sfa/shared';
import type { RenewalStepDefinition } from '@sfa/shared';
import { deriveStepStatus } from '../../common/scheduling/step-status';
import {
  computeRenewalStepTiming,
  daysUntil,
  formatTermKey,
  renewalAnchorDate,
  renewalStepsToOpen,
  scheduleRenewalSteps,
  type PlannedRenewalStep,
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
  it.each([
    'Auto',
    'auto',
    '  AUTO  ',
    'Autos',
    // David, 2026-08-19 scrum: the 6-month term applies to "any auto vehicle",
    // so the whole auto family is on this track — not just plain Auto. Both of
    // these used to fall through to annual.
    'Auto - Special',
    'Motorcycle',
    'motorcycles',
  ])('puts %p on the semiannual track', (policyType) => {
    expect(renewalTrackFor(policyType)).toBe('semiannual');
  });

  it.each([
    'Home',
    'Life',
    'Umbrella',
    'Renters',
    'Boat Owners',
    '',
    null,
    undefined,
  ])('puts %p on the annual track', (policyType) => {
    expect(renewalTrackFor(policyType)).toBe('annual');
  });

  it('resolves a raw SmartSuite code, which the old key match could not', () => {
    // `Zgsh3` is the Policies table's Auto, and `policies.policyType` is where
    // the migration put it. Folding it to a de-pluralized key ('zgsh3') matched
    // nothing, so every migrated auto policy was scheduled two calls on the
    // annual track while its premium rendered `/6 mo`.
    for (const [code, label] of Object.entries(POLICY_TYPE_CODE_ALIASES)) {
      const expected = isSemiannualPolicyType(label) ? 'semiannual' : 'annual';
      expect(renewalTrackFor(code)).toBe(expected);
    }
    expect(renewalTrackFor('Zgsh3')).toBe('semiannual');
    expect(renewalTrackFor('gGKei')).toBe('semiannual');
  });

  it('tracks the shared term vocabulary rather than its own list', () => {
    // The renewal cadence and the premium's `/6 mo` label must never disagree,
    // which is why `SEMIANNUAL_POLICY_TYPES` is derived from
    // `SEMIANNUAL_TERM_POLICY_TYPES` instead of being hand-written.
    for (const policyType of SEMIANNUAL_TERM_POLICY_TYPES) {
      expect(renewalTrackFor(policyType)).toBe('semiannual');
      expect(isSemiannualPolicyType(policyType)).toBe(true);
    }
  });

  it('normalizes the free-form policyType string', () => {
    // `Policy.policyType` has no enum behind it, so the match has to tolerate
    // whatever the carrier import produced.
    expect(normalizeRenewalPolicyType('  Home   Owners ')).toBe('home owner');
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

describe('nextRenewalDate', () => {
  /** Today, for every case below. */
  const NOW = new Date('2026-09-08T14:30:00.000Z');
  const iso = (date: Date | null) => date?.toISOString().slice(0, 10) ?? null;

  it('carries an annual policy a whole year past its effective date', () => {
    // The worked example: a home policy bought 8 Dec 2025 renews 8 Dec 2026,
    // which is 91 days out — so its T-90 call is due about now.
    expect(iso(nextRenewalDate(new Date('2025-12-08'), 'Home', NOW))).toBe(
      '2026-12-08',
    );
  });

  it('renews an auto policy every six months', () => {
    // Same purchase date, half the term: 8 Jun 2026 has already gone by, so
    // the next one is 8 Dec 2026.
    expect(iso(nextRenewalDate(new Date('2025-12-08'), 'Auto', NOW))).toBe(
      '2026-12-08',
    );
    // The same anchor on each track, to show the 6-month step really is being
    // taken: auto has already renewed once since April and comes round again
    // in October, while a home policy bought that day waits until next April.
    expect(iso(nextRenewalDate(new Date('2026-04-08'), 'Auto', NOW))).toBe(
      '2026-10-08',
    );
    expect(iso(nextRenewalDate(new Date('2026-04-08'), 'Home', NOW))).toBe(
      '2027-04-08',
    );
  });

  it('keeps the day of the month across many terms', () => {
    // Five years of annual terms must not drift the 8th by a single day.
    expect(iso(nextRenewalDate(new Date('2021-03-08'), 'Home', NOW))).toBe(
      '2027-03-08',
    );
  });

  it('clamps a month-end anchor instead of overflowing into the next month', () => {
    // 31 Aug + 6 months is 28/29 Feb, never 2 or 3 March. `setUTCMonth` alone
    // overflows, which would walk the date forward every single term.
    expect(iso(nextRenewalDate(new Date('2025-08-31'), 'Auto', NOW))).toBe(
      '2027-02-28',
    );
  });

  it('survives a 29 February anchor in a non-leap year', () => {
    expect(iso(nextRenewalDate(new Date('2024-02-29'), 'Home', NOW))).toBe(
      '2027-02-28',
    );
  });

  it('returns the anchor itself when coverage has not started yet', () => {
    // A policy sold with a future effective date renews on its own first term,
    // not one term after it.
    expect(iso(nextRenewalDate(new Date('2026-11-01'), 'Home', NOW))).toBe(
      '2026-11-01',
    );
  });

  it('treats a renewal falling today as still due today', () => {
    // Midnight has passed but the day has not. Comparing instants rather than
    // calendar days would push this a whole term out.
    expect(iso(nextRenewalDate(new Date('2025-09-08'), 'Home', NOW))).toBe(
      '2026-09-08',
    );
  });

  it('resolves a raw SmartSuite code to the right term', () => {
    // Thousands of migrated rows hold `Zgsh3` rather than "Auto"; reading it as
    // annual would schedule an auto policy's calls six months late.
    expect(POLICY_TYPE_CODE_ALIASES.Zgsh3).toBe('Auto');
    expect(iso(nextRenewalDate(new Date('2026-04-08'), 'Zgsh3', NOW))).toBe(
      '2026-10-08',
    );
  });

  it('falls back to an annual term for an uncatalogued type', () => {
    // ~91 active policies carry codes in no catalogue. Annual is the safe
    // guess, and it must not throw or return null.
    expect(iso(nextRenewalDate(new Date('2025-09-08'), 'BK08B', NOW))).toBe(
      '2026-09-08',
    );
  });

  it('has no anchor to count from when the date is missing or unusable', () => {
    expect(nextRenewalDate(null, 'Home', NOW)).toBeNull();
    expect(nextRenewalDate(undefined, 'Home', NOW)).toBeNull();
    expect(nextRenewalDate(new Date('not a date'), 'Home', NOW)).toBeNull();
  });
});

describe('renewalStepsToOpen', () => {
  const CUTOVER = new Date('2026-09-08T00:00:00.000Z');
  const GRACE = 7;

  /** A planned step opening `days` before the cutover. */
  const step = (
    stepKey: 'annual_review' | 'renewal_review',
    days: number,
  ): PlannedRenewalStep => ({
    stepKey,
    label: stepKey,
    sortOrder: stepKey === 'annual_review' ? 0 : 1,
    sequence: stepKey === 'annual_review' ? 1 : 2,
    completedAt: null,
    mergedFrom: [],
    availableAt: new Date(CUTOVER.getTime() - days * DAY_MS),
    dueAt: new Date(CUTOVER.getTime() - days * DAY_MS + 48 * HOUR_MS),
  });

  const none = new Set<'annual_review' | 'renewal_review'>();
  const keys = (steps: PlannedRenewalStep[]) => steps.map((s) => s.stepKey);

  it('opens every call that is current', () => {
    const planned = [step('annual_review', -30), step('renewal_review', -75)];
    expect(keys(renewalStepsToOpen(planned, none, CUTOVER, GRACE))).toEqual([
      'annual_review',
      'renewal_review',
    ]);
  });

  it('opens a call missed within the grace week', () => {
    const planned = [step('renewal_review', 6)];
    expect(keys(renewalStepsToOpen(planned, none, CUTOVER, GRACE))).toEqual([
      'renewal_review',
    ]);
  });

  it('drops a dead warm-up but keeps the review that still matters', () => {
    // The T-90 passed four months ago and cannot be made on time; the T-45 is
    // days away. Opening both would bury the queue in unmakeable calls.
    const planned = [step('annual_review', 120), step('renewal_review', -5)];
    expect(keys(renewalStepsToOpen(planned, none, CUTOVER, GRACE))).toEqual([
      'renewal_review',
    ]);
  });

  it('never lets a cycle go dark, even when every call is long past', () => {
    // The renewal is still coming. Calling late beats not calling at all, so
    // the latest step survives on its own.
    const planned = [step('annual_review', 200), step('renewal_review', 155)];
    expect(keys(renewalStepsToOpen(planned, none, CUTOVER, GRACE))).toEqual([
      'renewal_review',
    ]);
  });

  it('keeps a step that already has a ticket, however stale', () => {
    // Otherwise `ensureRenewalTicket` would stop adopting its re-planned
    // timing and the existing ticket would freeze on a stale date.
    const planned = [step('annual_review', 300), step('renewal_review', 255)];
    const existing = new Set<'annual_review' | 'renewal_review'>([
      'annual_review',
    ]);
    expect(keys(renewalStepsToOpen(planned, existing, CUTOVER, GRACE))).toEqual(
      ['annual_review', 'renewal_review'],
    );
  });

  it('has nothing to open for an empty plan', () => {
    expect(renewalStepsToOpen([], none, CUTOVER, GRACE)).toEqual([]);
  });
});
