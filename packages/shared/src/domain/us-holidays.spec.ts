import {
  customHolidayError,
  FEDERAL_HOLIDAY_KEYS,
  HOLIDAY_CATALOG,
  HOLIDAY_KEYS,
  holidayInstance,
  holidaysBetween,
  holidaysInYear,
  nextHolidayInstance,
  type CustomHoliday,
} from './us-holidays';

const federal = { holidays: [...FEDERAL_HOLIDAY_KEYS], customHolidays: [] };
const dates = (rows: { date: string }[]) => rows.map((row) => row.date);

describe('US holidays (PAC-161 v3)', () => {
  it('lists every key once in the catalog, eleven of them federal', () => {
    expect(HOLIDAY_CATALOG.map((h) => h.key).sort()).toEqual([...HOLIDAY_KEYS].sort());
    expect(FEDERAL_HOLIDAY_KEYS).toHaveLength(11);
  });

  it('computes the 2026 federal closures, Independence Day observed on Friday', () => {
    expect(dates(holidaysInYear(federal, 2026))).toEqual([
      '2026-01-01',
      '2026-01-19',
      '2026-02-16',
      '2026-05-25',
      '2026-06-19',
      '2026-07-03',
      '2026-09-07',
      '2026-10-12',
      '2026-11-11',
      '2026-11-26',
      '2026-12-25',
    ]);
    const july = holidayInstance('independence_day', 2026);
    expect(july).toMatchObject({ date: '2026-07-03', observedFor: '2026-07-04' });
  });

  it("puts New Year's Day 2028 in 2027, observed on Friday 31 December", () => {
    const rows = holidaysInYear(federal, 2027);
    expect(rows.at(-1)).toMatchObject({
      date: '2027-12-31',
      key: 'new_years_day',
      observedFor: '2028-01-01',
    });
    // …and 2028 does not list it again.
    expect(dates(holidaysInYear(federal, 2028))).not.toContain('2027-12-31');
    expect(dates(holidaysInYear(federal, 2028))[0]).toBe('2028-01-17');
  });

  it('observes a Sunday holiday on the Monday after', () => {
    // Juneteenth 2033 is a Sunday.
    expect(holidayInstance('juneteenth', 2033)).toMatchObject({
      date: '2033-06-20',
      observedFor: '2033-06-19',
    });
  });

  it('computes the common extras without shifting them', () => {
    expect(holidayInstance('good_friday', 2026).date).toBe('2026-04-03');
    expect(holidayInstance('good_friday', 2027).date).toBe('2027-03-26');
    expect(holidayInstance('day_after_thanksgiving', 2026).date).toBe('2026-11-27');
    // Saturday — not moved, so it closes nothing that week.
    expect(holidayInstance('christmas_eve', 2033)).toMatchObject({
      date: '2033-12-24',
      observedFor: null,
    });
  });

  it('lists a shared date once, under the federal name', () => {
    // Christmas 2027 is a Saturday: observed Fri 24 Dec, which is Christmas Eve.
    const rows = holidaysInYear(
      { holidays: ['christmas_day', 'christmas_eve'], customHolidays: [] },
      2027,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ date: '2027-12-24', name: 'Christmas Day' });
  });

  describe('custom holidays', () => {
    const closure: CustomHoliday = {
      id: 'winter',
      name: 'Winter closure',
      start: '2026-12-28',
      end: '2027-01-02',
      repeatsYearly: true,
    };

    it('lists every day of a range, across the year boundary, every year', () => {
      const select = { holidays: [], customHolidays: [closure] };
      expect(dates(holidaysInYear(select, 2026))).toEqual([
        '2026-12-28',
        '2026-12-29',
        '2026-12-30',
        '2026-12-31',
      ]);
      // 2027 gets the tail of the 2026 instance and the head of its own.
      expect(dates(holidaysInYear(select, 2027))).toEqual([
        '2027-01-01',
        '2027-01-02',
        '2027-12-28',
        '2027-12-29',
        '2027-12-30',
        '2027-12-31',
      ]);
    });

    it('keeps a one-off holiday to the year it names', () => {
      const once = { ...closure, repeatsYearly: false };
      const select = { holidays: [], customHolidays: [once] };
      expect(dates(holidaysInYear(select, 2027))).toEqual(['2027-01-01', '2027-01-02']);
      expect(holidaysInYear(select, 2028)).toEqual([]);
    });

    it('gives way to a catalog holiday on the same day', () => {
      const select = {
        holidays: ['new_years_day' as const],
        customHolidays: [closure],
      };
      const jan1 = holidaysInYear(select, 2027).find((row) => row.date === '2027-01-01');
      expect(jan1).toMatchObject({ key: 'new_years_day', customId: null });
    });

    it('moves 29 February to the 28th in a common year', () => {
      const leap: CustomHoliday = {
        id: 'leap',
        name: 'Leap day',
        start: '2028-02-29',
        end: '2028-02-29',
        repeatsYearly: true,
      };
      expect(dates(holidaysInYear({ holidays: [], customHolidays: [leap] }, 2029))).toEqual([
        '2029-02-28',
      ]);
    });

    it('refuses an unnamed, inverted or over-long range', () => {
      expect(customHolidayError({ name: ' ', start: '2026-01-01', end: '2026-01-01' })).toMatch(/name/);
      expect(customHolidayError({ name: 'x', start: '2026-01-05', end: '2026-01-01' })).toMatch(/before/);
      expect(customHolidayError({ name: 'x', start: '2026-01-01', end: '2026-03-01' })).toMatch(/at most/);
      expect(customHolidayError({ name: 'x', start: '2026-02-30', end: '2026-03-01' })).toMatch(/start/);
      expect(customHolidayError({ name: 'x', start: '2026-01-01', end: '2026-01-31' })).toBeNull();
    });
  });

  it('reads a range that spans years', () => {
    expect(dates(holidaysBetween(federal, '2026-12-20', '2027-01-20'))).toEqual([
      '2026-12-25',
      '2027-01-01',
      '2027-01-18',
    ]);
  });

  it('finds the next closure from today', () => {
    expect(nextHolidayInstance('thanksgiving', '2026-11-03').date).toBe('2026-11-26');
    expect(nextHolidayInstance('memorial_day', '2026-11-03').date).toBe('2027-05-31');
    // New Year's Day 2028 is next from mid-December 2027, a Friday in 2027.
    expect(nextHolidayInstance('new_years_day', '2027-12-15').date).toBe('2027-12-31');
  });
});
