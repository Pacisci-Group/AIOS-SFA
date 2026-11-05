import { businessDateInstant } from '../dates/business-dates';
import {
  isMonthAfter,
  isPayoutMonth,
  monthLabel,
  monthRange,
  monthWindow,
  nextMonth,
  previousMonth,
  previousMonthIn,
} from './month-window';

const CHICAGO = 'America/Chicago';
const HONOLULU = 'Pacific/Honolulu';

describe('month-window', () => {
  it('knows a pay month when it sees one', () => {
    expect(isPayoutMonth('2026-10')).toBe(true);
    expect(isPayoutMonth('2026-13')).toBe(false);
    expect(isPayoutMonth('2026-1')).toBe(false);
  });

  it('steps across the year boundary', () => {
    expect(nextMonth('2026-12')).toBe('2027-01');
    expect(previousMonth('2026-01')).toBe('2025-12');
    expect(previousMonth('2026-11')).toBe('2026-10');
  });

  it('covers the 1st to the last day, leap years included', () => {
    expect(monthRange('2026-10')).toMatchObject({
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect(monthRange('2028-02')).toMatchObject({
      from: '2028-02-01',
      to: '2028-02-29',
    });
    expect(monthRange('2026-02').to).toBe('2026-02-28');
  });

  it("cuts the month on the agency's clock, not UTC", () => {
    const window = monthWindow('2026-10', CHICAGO);
    expect(window.$gte.toISOString()).toBe('2026-10-01T05:00:00.000Z');
    // November 1st starts at 05:00Z: Chicago is still on CDT that night.
    expect(window.$lt.toISOString()).toBe('2026-11-01T05:00:00.000Z');

    // 11:30 pm Central on the 31st is the 1st in UTC, and still October.
    const lateSale = new Date('2026-11-01T04:30:00.000Z');
    expect(lateSale >= window.$gte && lateSale < window.$lt).toBe(true);
    expect(businessDateInstant('2026-11-01', CHICAGO) >= window.$lt).toBe(true);
  });

  it('drafts the month that just ended in each zone', () => {
    // 05:30Z on Nov 1 is 00:30 in Chicago (November) but 19:30 on Oct 31 in Honolulu.
    const now = new Date('2026-11-01T05:30:00.000Z');
    expect(previousMonthIn(CHICAGO, now)).toBe('2026-10');
    expect(previousMonthIn(HONOLULU, now)).toBe('2026-09');
    expect(previousMonthIn(CHICAGO, new Date('2027-01-01T07:00:00.000Z'))).toBe(
      '2026-12',
    );
  });

  it('labels and orders months', () => {
    expect(monthLabel('2026-10')).toBe('October 2026');
    expect(isMonthAfter('2026-11', '2026-10')).toBe(true);
    expect(isMonthAfter('2026-10', '2026-10')).toBe(false);
    expect(() => monthLabel('nope')).toThrow();
  });
});
