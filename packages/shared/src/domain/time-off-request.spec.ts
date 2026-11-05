import {
  availableHours,
  balanceLines,
  canTransition,
  datesWithHours,
  hoursByDate,
  overlappingDates,
  requestActions,
  requestDays,
  requestGroup,
  totalRequestHours,
} from './time-off-request';
import { formatTimeOffRequestRef } from './record-reference';
import type { ScheduledDay } from './work-week';

/** Wed 25 Nov – Mon 30 Nov 2026: a 7.5 h day, Thanksgiving, a Friday, the weekend, a Monday. */
const WEEK: ScheduledDay[] = [
  { date: '2026-11-25', working: true, scheduledMinutes: 450, reason: 'scheduled' },
  { date: '2026-11-26', working: false, scheduledMinutes: 0, reason: 'holiday' },
  { date: '2026-11-27', working: true, scheduledMinutes: 480, reason: 'scheduled' },
  { date: '2026-11-28', working: false, scheduledMinutes: 0, reason: 'weekend' },
  { date: '2026-11-29', working: false, scheduledMinutes: 0, reason: 'weekend' },
  { date: '2026-11-30', working: true, scheduledMinutes: 480, reason: 'scheduled' },
];

describe('time off request hours (PAC-165)', () => {
  it('takes each date its scheduled hours on Full days, and nothing for a holiday or a weekend', () => {
    const days = requestDays(WEEK, 'full');
    expect(days.map((day) => day.hours)).toEqual([7.5, 0, 8, 0, 0, 8]);
    expect(days[1]).toEqual({
      date: '2026-11-26',
      hours: 0,
      scheduledHours: 0,
      reason: 'holiday',
    });
    expect(totalRequestHours(days)).toBe(23.5);
  });

  it('ignores typed hours on Full days', () => {
    const days = requestDays(WEEK, 'full', { '2026-11-25': 2 });
    expect(days[0].hours).toBe(7.5);
  });

  it('takes the typed hours on Partial days, defaulting an untouched date to its schedule', () => {
    const days = requestDays(WEEK, 'partial', { '2026-11-25': 2, '2026-11-30': 0 });
    expect(days.map((day) => day.hours)).toEqual([2, 0, 8, 0, 0, 0]);
    expect(totalRequestHours(days)).toBe(10);
  });

  it('never lets a date take more than it schedules, or less than nothing', () => {
    const days = requestDays(WEEK, 'partial', {
      '2026-11-25': 12,
      '2026-11-26': 4,
      '2026-11-27': -3,
    });
    expect(days.slice(0, 3).map((day) => day.hours)).toEqual([7.5, 0, 0]);
  });

  it('keeps quarter hours to two decimals', () => {
    const days = requestDays(WEEK, 'partial', { '2026-11-25': 1.25, '2026-11-27': 0.75 });
    expect(totalRequestHours(days.slice(0, 3))).toBe(2);
  });

  it('counts only the dates that carry hours as taken', () => {
    const days = requestDays(WEEK, 'full');
    expect(datesWithHours(days)).toEqual(['2026-11-25', '2026-11-27', '2026-11-30']);
    expect(hoursByDate(days)).toEqual({
      '2026-11-25': 7.5,
      '2026-11-27': 8,
      '2026-11-30': 8,
    });
  });

  it('calls two requests a clash on a shared working day, not a shared weekend', () => {
    const friday = requestDays(WEEK.slice(2, 5), 'full');
    const weekendToMonday = requestDays(WEEK.slice(3), 'full');
    expect(overlappingDates(friday, weekendToMonday)).toEqual([]);
    expect(overlappingDates(requestDays(WEEK, 'full'), weekendToMonday)).toEqual([
      '2026-11-30',
    ]);
    // A date typed down to zero hours is free for another request.
    const skipped = requestDays(WEEK, 'partial', { '2026-11-30': 0 });
    expect(overlappingDates(skipped, weekendToMonday)).toEqual([]);
  });
});

describe('time off balance lines (PAC-165)', () => {
  it('is Gusto’s four lines: remaining = current − other − this', () => {
    expect(
      balanceLines({ currentBalance: 80, otherRequestedHours: 24, thisRequestHours: 16 }),
    ).toEqual({
      currentBalance: 80,
      otherRequestedHours: 24,
      thisRequestHours: 16,
      remainingHours: 40,
    });
  });

  it('keeps future-dated leave out of the current balance and inside other requested', () => {
    // The ledger holds an 80 h allocation and a 16 h `used` row dated next
    // month. As of today the balance is still 80; the 16 h are "other
    // requested", so Available is 64 — not 80, and not double-counted to 48.
    const current = 80;
    const upcomingApproved = 16;
    const waiting = 8;
    const lines = balanceLines({
      currentBalance: current,
      otherRequestedHours: upcomingApproved + waiting,
      thisRequestHours: 0,
    });
    expect(lines.currentBalance).toBe(80);
    expect(lines.remainingHours).toBe(56);
    expect(availableHours(current, upcomingApproved + waiting)).toBe(56);
  });

  it('goes negative rather than flooring, and rounds to two decimals', () => {
    const lines = balanceLines({
      currentBalance: 6.67,
      otherRequestedHours: 0,
      thisRequestHours: 8,
    });
    expect(lines.remainingHours).toBe(-1.33);
  });
});

describe('time off request lifecycle (PAC-165)', () => {
  it('allows only the transitions of the lifecycle', () => {
    expect(canTransition('draft', 'submit')).toBe('submitted');
    expect(canTransition('changes_requested', 'submit')).toBe('submitted');
    expect(canTransition('submitted', 'approve')).toBe('approved');
    expect(canTransition('submitted', 'request_changes')).toBe('changes_requested');
    expect(canTransition('submitted', 'decline')).toBe('declined');
    expect(canTransition('approved', 'cancel')).toBe('cancelled');
    // A decision is only ever taken on a Submitted request: first one wins.
    expect(canTransition('approved', 'approve')).toBeNull();
    expect(canTransition('approved', 'decline')).toBeNull();
    expect(canTransition('changes_requested', 'approve')).toBeNull();
    // Terminal.
    expect(canTransition('declined', 'submit')).toBeNull();
    expect(canTransition('cancelled', 'submit')).toBeNull();
    expect(canTransition('draft', 'cancel')).toBeNull();
  });

  const employee = { isEmployee: true, canReview: false };
  const reviewer = { isEmployee: false, canReview: true };
  const request = (status: Parameters<typeof canTransition>[0], firstDay = '2026-12-10') => ({
    source: 'self' as const,
    status,
    firstDay,
  });

  it('gives the employee their own actions per status', () => {
    const today = '2026-12-01';
    expect(requestActions(request('draft'), employee, today)).toEqual([
      'edit',
      'submit',
      'discard',
    ]);
    expect(requestActions(request('changes_requested'), employee, today)).toEqual([
      'edit',
      'submit',
      'cancel',
    ]);
    expect(requestActions(request('submitted'), employee, today)).toEqual(['cancel']);
    expect(requestActions(request('declined'), employee, today)).toEqual([]);
  });

  it('lets the employee cancel approved leave until the day before it starts', () => {
    expect(requestActions(request('approved'), employee, '2026-12-09')).toEqual(['cancel']);
    expect(requestActions(request('approved'), employee, '2026-12-10')).toEqual([]);
    expect(requestActions(request('approved'), employee, '2026-12-20')).toEqual([]);
  });

  it('gives a reviewer the decisions, and the cancellation of approved leave at any time', () => {
    expect(requestActions(request('submitted'), reviewer, '2026-12-01')).toEqual([
      'approve',
      'request_changes',
      'decline',
    ]);
    expect(requestActions(request('approved'), reviewer, '2027-03-01')).toEqual(['cancel']);
    expect(requestActions(request('changes_requested'), reviewer, '2026-12-01')).toEqual([]);
    expect(requestActions(request('draft'), reviewer, '2026-12-01')).toEqual([]);
  });

  it('never lets someone decide their own request, even holding the permission', () => {
    const both = { isEmployee: true, canReview: true };
    expect(requestActions(request('submitted'), both, '2026-12-01')).toEqual(['cancel']);
  });

  it('gives a bystander and an imported row nothing', () => {
    const nobody = { isEmployee: false, canReview: false };
    expect(requestActions(request('submitted'), nobody, '2026-12-01')).toEqual([]);
    const imported = { source: 'legacy' as const, status: null, firstDay: '2026-05-06' };
    expect(requestActions(imported, reviewer, '2026-12-01')).toEqual([]);
    expect(requestActions(imported, employee, '2026-12-01')).toEqual([]);
  });

  it('files approved leave as Taken once its last day has passed', () => {
    const approved = { source: 'self' as const, status: 'approved' as const };
    expect(requestGroup({ ...approved, lastDay: '2026-12-12' }, '2026-12-12')).toBe('approved');
    expect(requestGroup({ ...approved, lastDay: '2026-12-12' }, '2026-12-13')).toBe('taken');
    expect(
      requestGroup({ source: 'self', status: 'submitted', lastDay: '2026-01-01' }, '2026-12-13'),
    ).toBe('pending');
    expect(
      requestGroup({ source: 'legacy', status: null, lastDay: '2026-05-06' }, '2026-12-13'),
    ).toBe('imported');
  });
});

describe('time off request references (PAC-165)', () => {
  it('renders the year and a three-digit sequence that grows past it', () => {
    expect(formatTimeOffRequestRef(2026, 7)).toBe('TOR-2026-007');
    expect(formatTimeOffRequestRef(2026, 123)).toBe('TOR-2026-123');
    expect(formatTimeOffRequestRef(2027, 1234)).toBe('TOR-2027-1234');
  });

  it('refuses values a working allocator cannot produce', () => {
    expect(() => formatTimeOffRequestRef(2026, 0)).toThrow(RangeError);
    expect(() => formatTimeOffRequestRef(2026, 1.5)).toThrow(RangeError);
    expect(() => formatTimeOffRequestRef(Number.NaN, 1)).toThrow(RangeError);
    expect(() => formatTimeOffRequestRef(26, 1)).toThrow(RangeError);
  });
});
