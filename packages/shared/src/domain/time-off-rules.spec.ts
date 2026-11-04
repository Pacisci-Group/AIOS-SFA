import {
  calendarDaysInclusive,
  evaluateAutoApproval,
  exceedsAnnualUsageCap,
  usageAllowedFrom,
  type AutoApprovalCandidate,
} from './time-off-rules';

const policy = (
  autoApprove: { enabled: boolean; maxCalendarDays: number | null; minNoticeHours: number | null },
  allowNegativeBalance = false,
) => ({ autoApprove, allowNegativeBalance });

/** A Fri 5 – Sun 7 March 2027 request, submitted a week ahead, balance fine. */
const weekend: AutoApprovalCandidate = {
  firstDay: '2027-03-05',
  lastDay: '2027-03-07',
  submittedAt: new Date('2027-02-26T15:00:00Z'),
  firstDayStartsAt: new Date('2027-03-05T06:00:00Z'),
  balanceAfterHours: 12,
  recordedByManager: false,
};

describe('time off request rules (PAC-174)', () => {
  it('blocks nobody until a hire date exists, then counts calendar days from it', () => {
    expect(usageAllowedFrom(null, 30)).toBeNull();
    expect(usageAllowedFrom('2027-01-15', null)).toBeNull();
    expect(usageAllowedFrom('2027-01-15', 0)).toBeNull();
    expect(usageAllowedFrom('2027-01-15', 30)).toBe('2027-02-14');
    expect(usageAllowedFrom('2027-12-15', 30)).toBe('2028-01-14');
  });

  it('applies the annual usage cap only when set', () => {
    expect(exceedsAnnualUsageCap(null, 100, 100)).toBe(false);
    expect(exceedsAnnualUsageCap(40, 32, 8)).toBe(false);
    expect(exceedsAnnualUsageCap(40, 32, 8.5)).toBe(true);
  });

  it('counts calendar days first through last, weekends included', () => {
    expect(calendarDaysInclusive('2027-03-05', '2027-03-07')).toBe(3);
    expect(calendarDaysInclusive('2027-03-05', '2027-03-05')).toBe(1);
    expect(calendarDaysInclusive('2027-12-30', '2028-01-02')).toBe(4);
  });

  describe('auto-approval', () => {
    it('does nothing while off', () => {
      expect(evaluateAutoApproval(policy({ enabled: false, maxCalendarDays: 1, minNoticeHours: 1 }), weekend))
        .toEqual({ approve: false, reason: 'disabled' });
    });

    it('approves a request that meets every rule set', () => {
      expect(evaluateAutoApproval(policy({ enabled: true, maxCalendarDays: 3, minNoticeHours: 48 }), weekend))
        .toEqual({ approve: true });
      expect(evaluateAutoApproval(policy({ enabled: true, maxCalendarDays: null, minNoticeHours: null }), weekend))
        .toEqual({ approve: true });
    });

    it('sends a request over the day limit to a person', () => {
      expect(evaluateAutoApproval(policy({ enabled: true, maxCalendarDays: 2, minNoticeHours: null }), weekend))
        .toEqual({ approve: false, reason: 'too_many_days' });
    });

    it('needs the full notice, measured to the first day', () => {
      const late = { ...weekend, submittedAt: new Date('2027-03-03T07:00:00Z') }; // 47 h before
      expect(evaluateAutoApproval(policy({ enabled: true, maxCalendarDays: null, minNoticeHours: 48 }), late))
        .toEqual({ approve: false, reason: 'too_little_notice' });
      const justEnough = { ...weekend, submittedAt: new Date('2027-03-03T06:00:00Z') };
      expect(evaluateAutoApproval(policy({ enabled: true, maxCalendarDays: null, minNoticeHours: 48 }), justEnough))
        .toEqual({ approve: true });
    });

    it('never approves time a manager recorded', () => {
      expect(
        evaluateAutoApproval(
          policy({ enabled: true, maxCalendarDays: null, minNoticeHours: null }),
          { ...weekend, recordedByManager: true },
        ),
      ).toEqual({ approve: false, reason: 'manager_recorded' });
    });

    it('needs a person when the balance would go negative, unless the policy allows it', () => {
      const overdrawn = { ...weekend, balanceAfterHours: -1 };
      expect(evaluateAutoApproval(policy({ enabled: true, maxCalendarDays: null, minNoticeHours: null }), overdrawn))
        .toEqual({ approve: false, reason: 'negative_balance' });
      expect(
        evaluateAutoApproval(policy({ enabled: true, maxCalendarDays: null, minNoticeHours: null }, true), overdrawn),
      ).toEqual({ approve: true });
      // Unlimited: no balance to overdraw.
      expect(
        evaluateAutoApproval(
          policy({ enabled: true, maxCalendarDays: null, minNoticeHours: null }),
          { ...weekend, balanceAfterHours: null },
        ),
      ).toEqual({ approve: true });
    });
  });
});
