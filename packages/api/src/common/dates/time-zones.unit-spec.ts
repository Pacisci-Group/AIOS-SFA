import {
  DEFAULT_AGENCY_TIME_ZONE,
  isIanaTimeZone,
  localClock,
} from './time-zones';

describe('isIanaTimeZone', () => {
  it('accepts canonical names, aliases and UTC', () => {
    expect(isIanaTimeZone(DEFAULT_AGENCY_TIME_ZONE)).toBe(true);
    expect(isIanaTimeZone('Asia/Kolkata')).toBe(true);
    // Aliases resolve in the formatter, so they are valid to store.
    expect(isIanaTimeZone('US/Central')).toBe(true);
    expect(isIanaTimeZone('UTC')).toBe(true);
  });

  it('rejects what the formatter would throw on', () => {
    expect(isIanaTimeZone('America/Oklahoma_City')).toBe(false);
    expect(isIanaTimeZone('Central')).toBe(false);
    expect(isIanaTimeZone('')).toBe(false);
    expect(isIanaTimeZone('  ')).toBe(false);
    expect(isIanaTimeZone(null)).toBe(false);
    expect(isIanaTimeZone(undefined)).toBe(false);
    expect(isIanaTimeZone(-5)).toBe(false);
  });
});

describe('localClock', () => {
  it('reads Central Daylight Time (UTC-5) in September', () => {
    expect(
      localClock(new Date('2026-09-26T01:00:00Z'), 'America/Chicago'),
    ).toEqual({
      date: '2026-09-25',
      hour: 20,
      minute: 0,
    });
  });

  it('reads Central Standard Time (UTC-6) in January', () => {
    expect(
      localClock(new Date('2026-01-16T02:00:00Z'), 'America/Chicago'),
    ).toEqual({
      date: '2026-01-15',
      hour: 20,
      minute: 0,
    });
  });

  it('follows the spring-forward day, not a fixed offset', () => {
    // DST begins 2026-03-08 at 02:00 CST. The evening before is UTC-6 …
    expect(
      localClock(new Date('2026-03-08T02:00:00Z'), 'America/Chicago'),
    ).toEqual({
      date: '2026-03-07',
      hour: 20,
      minute: 0,
    });
    // … and the evening after is UTC-5.
    expect(
      localClock(new Date('2026-03-09T01:00:00Z'), 'America/Chicago'),
    ).toEqual({
      date: '2026-03-08',
      hour: 20,
      minute: 0,
    });
  });

  it('handles a half-hour zone', () => {
    expect(
      localClock(new Date('2026-09-25T14:30:00Z'), 'Asia/Kolkata'),
    ).toEqual({
      date: '2026-09-25',
      hour: 20,
      minute: 0,
    });
  });

  it('renders midnight as hour 0, never 24', () => {
    expect(localClock(new Date('2026-09-25T00:00:00Z'), 'UTC')).toEqual({
      date: '2026-09-25',
      hour: 0,
      minute: 0,
    });
    expect(localClock(new Date('2026-09-25T23:59:00Z'), 'UTC')).toEqual({
      date: '2026-09-25',
      hour: 23,
      minute: 59,
    });
  });
});
