import {
  AGENCY_EVENT_MAX_DAYS,
  agencyEventDates,
  agencyEventError,
  eventAppliesTo,
  isClockTime,
  type AgencyEventAudience,
  type AgencyEventInput,
} from './agency-event';

const everyone: AgencyEventAudience = { kind: 'agency', branchIds: [], userIds: [] };

const event = (over: Partial<AgencyEventInput> = {}): AgencyEventInput => ({
  name: 'Christmas party',
  description: null,
  firstDay: '2026-12-18',
  lastDay: '2026-12-18',
  startTime: null,
  endTime: null,
  effect: 'none',
  audience: everyone,
  ...over,
});

describe('agency events (PAC-169)', () => {
  it('accepts a one-day event with no time', () => {
    expect(agencyEventError(event())).toBeNull();
  });

  it('accepts a timed evening on one day and a range with times in any order', () => {
    expect(agencyEventError(event({ startTime: '18:00', endTime: '21:00' }))).toBeNull();
    // Across several days the times are a daily window or a start and a
    // finish; either way the end may be the earlier clock.
    expect(
      agencyEventError(
        event({ lastDay: '2026-12-20', startTime: '18:00', endTime: '09:00' }),
      ),
    ).toBeNull();
  });

  it('needs a name, real dates and an end on or after the start', () => {
    expect(agencyEventError(event({ name: '   ' }))).toMatch(/name/);
    expect(agencyEventError(event({ name: 'x'.repeat(121) }))).toMatch(/under 120/);
    expect(agencyEventError(event({ firstDay: '2026-02-30' }))).toMatch(/start date/);
    expect(agencyEventError(event({ lastDay: 'soon' }))).toMatch(/end date/);
    expect(agencyEventError(event({ lastDay: '2026-12-17' }))).toMatch(/before the start/);
  });

  it(`runs at most ${AGENCY_EVENT_MAX_DAYS} days`, () => {
    expect(agencyEventError(event({ firstDay: '2026-12-01', lastDay: '2026-12-31' }))).toBeNull();
    expect(agencyEventError(event({ firstDay: '2026-12-01', lastDay: '2027-01-01' }))).toMatch(
      /at most 31 days/,
    );
  });

  it('checks the display time', () => {
    expect(agencyEventError(event({ startTime: '6pm' }))).toMatch(/start time/);
    expect(agencyEventError(event({ startTime: '18:00', endTime: '25:00' }))).toMatch(/end time/);
    expect(agencyEventError(event({ endTime: '21:00' }))).toMatch(/Add a start time/);
    expect(agencyEventError(event({ startTime: '18:00', endTime: '18:00' }))).toMatch(
      /not after the start/,
    );
    expect(isClockTime('00:00')).toBe(true);
    expect(isClockTime('23:59')).toBe(true);
    expect(isClockTime('24:00')).toBe(false);
    expect(isClockTime('9:00')).toBe(false);
  });

  it('needs somebody in a branch or people audience', () => {
    expect(
      agencyEventError(event({ audience: { kind: 'branches', branchIds: [], userIds: [] } })),
    ).toMatch(/at least one branch/);
    expect(
      agencyEventError(event({ audience: { kind: 'people', branchIds: [], userIds: [] } })),
    ).toMatch(/at least one person/);
    expect(
      agencyEventError(event({ audience: { kind: 'people', branchIds: [], userIds: ['u1'] } })),
    ).toBeNull();
  });

  it('lists every day of an event, weekends too', () => {
    expect(agencyEventDates({ firstDay: '2026-12-30', lastDay: '2027-01-02' })).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
    ]);
  });

  describe('eventAppliesTo', () => {
    const sam = { userId: 'sam', homeBranchId: 'main' };

    it('an agency event is for everyone, branch or not', () => {
      expect(eventAppliesTo(everyone, sam)).toBe(true);
      expect(eventAppliesTo(everyone, { userId: 'owner', homeBranchId: null })).toBe(true);
    });

    it('a branch event is for people whose home branch is named', () => {
      const audience: AgencyEventAudience = { kind: 'branches', branchIds: ['main'], userIds: [] };
      expect(eventAppliesTo(audience, sam)).toBe(true);
      expect(eventAppliesTo(audience, { userId: 'kai', homeBranchId: 'north' })).toBe(false);
      // No home branch reaches no branch event — never "every branch".
      expect(eventAppliesTo(audience, { userId: 'owner', homeBranchId: null })).toBe(false);
    });

    it('a people event is for the people named, whatever their branch', () => {
      const audience: AgencyEventAudience = { kind: 'people', branchIds: [], userIds: ['kai'] };
      expect(eventAppliesTo(audience, sam)).toBe(false);
      expect(eventAppliesTo(audience, { userId: 'kai', homeBranchId: 'north' })).toBe(true);
    });

    it('ignores ids left over from another audience kind', () => {
      const audience: AgencyEventAudience = { kind: 'people', branchIds: ['main'], userIds: [] };
      expect(eventAppliesTo(audience, sam)).toBe(false);
    });
  });
});
