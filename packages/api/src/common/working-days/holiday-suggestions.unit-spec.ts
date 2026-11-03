import {
  countryName,
  groupHolidaySuggestions,
  isKnownCountry,
  isKnownRegion,
  listCountries,
  listRegions,
  regionFromStateName,
  regionName,
  suggestHolidays,
  UnknownHolidayRegionError,
} from './holiday-suggestions';

const byDate = (rows: { date: string }[]) =>
  new Map(rows.map((row) => [row.date, row]));

describe('holiday suggestions (date-holidays, PAC-161)', () => {
  describe('federal vs other, against the real package', () => {
    it('offers the 2026 US federal set as 12 rows, one per date, pre-checked', () => {
      const rows = suggestHolidays({ country: 'US', region: null, year: 2026 });
      const federal = rows.filter((row) => row.group === 'federal');
      expect(federal).toHaveLength(12);
      expect(new Set(federal.map((row) => row.date)).size).toBe(12);
      expect(federal.map((row) => row.date)).toEqual([
        '2026-01-01',
        '2026-01-19',
        '2026-02-16',
        '2026-05-25',
        '2026-06-19',
        '2026-07-03',
        '2026-07-04',
        '2026-09-07',
        '2026-10-12',
        '2026-11-11',
        '2026-11-26',
        '2026-12-25',
      ]);
      expect(byDate(rows).get('2026-11-26')).toMatchObject({
        name: 'Thanksgiving Day',
        type: 'public',
        group: 'federal',
        preChecked: true,
      });
      // With no region, "other" is only what the national instance adds.
      const other = rows.filter((row) => row.group === 'other');
      expect(other.length).toBeGreaterThan(0);
      expect(other.every((row) => row.type !== 'public')).toBe(true);
      expect(other.every((row) => !row.preChecked)).toBe(true);
      expect(byDate(rows).get('2026-02-14')).toMatchObject({
        type: 'observance',
        group: 'other',
      });
    });

    it('offers 2027 as 15 federal rows: eleven plus four substitutes', () => {
      const rows = suggestHolidays({ country: 'US', region: null, year: 2027 });
      const federal = rows.filter((row) => row.group === 'federal');
      expect(federal).toHaveLength(15);
      expect(
        federal.filter((row) => row.substitute).map((row) => row.date),
      ).toEqual(['2027-06-18', '2027-07-05', '2027-12-24', '2027-12-31']);
    });

    it('unchecks the weekend original of a substitute pair, ticks the substitute', () => {
      const rows = byDate(
        suggestHolidays({ country: 'US', region: null, year: 2026 }),
      );
      // The Fourth is a Saturday; the office closes on the Friday.
      expect(rows.get('2026-07-03')).toMatchObject({
        group: 'federal',
        substitute: true,
        preChecked: true,
      });
      expect(rows.get('2026-07-04')).toMatchObject({
        name: 'Independence Day',
        group: 'federal',
        substitute: false,
        preChecked: false,
      });
    });

    it('ticks a substitute whose original is in another year', () => {
      const rows = byDate(
        suggestHolidays({ country: 'US', region: null, year: 2027 }),
      );
      // New Year's Day 2028 is a Saturday; the Friday is in 2027.
      expect(rows.get('2027-12-31')).toMatchObject({
        substitute: true,
        preChecked: true,
      });
      expect(rows.get('2027-12-24')).toMatchObject({
        name: 'Christmas Day (substitute day)',
        preChecked: true,
      });
      expect(rows.get('2027-12-25')).toMatchObject({
        name: 'Christmas Day',
        preChecked: false,
      });
    });

    it("keeps the federal label where a state renames it (Oklahoma's Presidents' Day)", () => {
      const rows = suggestHolidays({ country: 'US', region: 'OK', year: 2026 });
      expect(byDate(rows).get('2026-02-16')).toMatchObject({
        name: "Washington's Birthday",
        group: 'federal',
        preChecked: true,
      });
      expect(rows.some((row) => row.name === "Presidents' Day")).toBe(false);
      expect(byDate(rows).get('2026-11-27')).toMatchObject({
        name: 'Day after Thanksgiving',
        group: 'other',
        preChecked: false,
      });
    });

    it('keeps one row per date where a state adds a holiday on a federal date (Texas 2027)', () => {
      const rows = suggestHolidays({ country: 'US', region: 'TX', year: 2027 });
      const christmasEve = rows.filter((row) => row.date === '2027-12-24');
      expect(christmasEve).toHaveLength(1);
      expect(christmasEve[0]).toMatchObject({
        name: 'Christmas Day (substitute day)',
        group: 'federal',
        preChecked: true,
      });
      expect(rows.some((row) => row.name === 'Christmas Eve')).toBe(false);
      expect(byDate(rows).get('2027-12-26')).toMatchObject({
        name: 'Day after Christmas',
        group: 'other',
      });
    });

    it("lists a state's own public days under other, unchecked (Illinois 2026)", () => {
      const rows = suggestHolidays({ country: 'US', region: 'IL', year: 2026 });
      const names = rows
        .filter((row) => row.group === 'other' && row.type === 'public')
        .map((row) => row.name);
      expect(names).toEqual(
        expect.arrayContaining([
          "Lincoln's Birthday",
          'Casimir Pulaski Day',
          'Malcolm X Day',
          'Election Day',
        ]),
      );
      expect(
        rows
          .filter((row) => row.group === 'other')
          .every((row) => !row.preChecked),
      ).toBe(true);
    });

    it.each(['ME', 'NM', 'TX', 'OK', 'IL', 'CA'])(
      'emits a unique date per row for %s in 2026 and 2027',
      (region) => {
        for (const year of [2026, 2027]) {
          const rows = suggestHolidays({ country: 'US', region, year });
          expect(new Set(rows.map((row) => row.date)).size).toBe(rows.length);
          expect(rows.map((row) => row.date)).toEqual(
            [...rows.map((row) => row.date)].sort(),
          );
        }
      },
    );
  });

  describe('groupHolidaySuggestions (pure)', () => {
    const rule = '07-04 and if sunday then next monday if saturday then previous friday';

    it('lets a regional public extra outrank a national observance on the same day', () => {
      const rows = groupHolidaySuggestions(
        [
          { date: '2026-03-02 00:00:00', name: 'Read Across America', type: 'observance' },
          { date: '2026-01-01 00:00:00', name: "New Year's Day", type: 'public' },
        ],
        [
          { date: '2026-03-02 00:00:00', name: 'Texas Independence Day', type: 'public' },
          { date: '2026-01-01 00:00:00', name: "New Year's Day", type: 'public' },
        ],
      );
      expect(rows).toEqual([
        {
          date: '2026-01-01',
          name: "New Year's Day",
          type: 'public',
          substitute: false,
          group: 'federal',
          preChecked: true,
        },
        {
          date: '2026-03-02',
          name: 'Texas Independence Day',
          type: 'public',
          substitute: false,
          group: 'other',
          preChecked: false,
        },
      ]);
    });

    it('pairs a substitute with its original by rule text', () => {
      const rows = groupHolidaySuggestions(
        [
          { date: '2026-07-04 00:00:00', name: 'Independence Day', type: 'public', rule },
          {
            date: '2026-07-03 00:00:00',
            name: 'Independence Day (substitute day)',
            type: 'public',
            substitute: true,
            rule,
          },
        ],
        [],
      );
      expect(rows.map((row) => [row.date, row.preChecked])).toEqual([
        ['2026-07-03', true],
        ['2026-07-04', false],
      ]);
    });

    it('treats an unknown type as an observance and a Date as its UTC day', () => {
      const rows = groupHolidaySuggestions(
        [{ date: new Date('2026-05-10T00:00:00Z'), name: "Mother's Day", type: 'weird' }],
        [],
      );
      expect(rows).toEqual([
        {
          date: '2026-05-10',
          name: "Mother's Day",
          type: 'observance',
          substitute: false,
          group: 'other',
          preChecked: false,
        },
      ]);
    });
  });

  it('suggests a non-US country', () => {
    const ontario = suggestHolidays({
      country: 'CA',
      region: 'ON',
      year: 2026,
    });
    const names = ontario.map((row) => row.name);
    expect(names).toContain('Canada Day');
    expect(names).toContain('Boxing Day');
    expect(names).toContain('Family Day');
  });

  it('refuses an unknown country or region as a typed error', () => {
    expect(() =>
      suggestHolidays({ country: 'QQ', region: null, year: 2026 }),
    ).toThrow(UnknownHolidayRegionError);
    expect(() =>
      suggestHolidays({ country: 'US', region: 'ZZ', year: 2026 }),
    ).toThrow(UnknownHolidayRegionError);
  });

  it('case-folds the codes', () => {
    expect(
      suggestHolidays({ country: 'us', region: 'ok', year: 2026 }).length,
    ).toBeGreaterThan(0);
  });

  it('lists countries and regions with names', () => {
    expect(isKnownCountry('US')).toBe(true);
    expect(isKnownCountry('QQ')).toBe(false);
    expect(isKnownRegion('US', 'OK')).toBe(true);
    expect(isKnownRegion('US', 'ZZ')).toBe(false);
    expect(countryName('US')).toBe('United States of America');
    expect(regionName('US', 'OK')).toBe('Oklahoma');
    expect(listCountries().find((c) => c.code === 'CA')?.name).toBe('Canada');
    expect(listRegions('US').length).toBeGreaterThan(49);
    expect(listRegions('QQ')).toEqual([]);
  });

  it('maps a typed state name or code onto a region', () => {
    expect(regionFromStateName('US', 'Oklahoma')).toBe('OK');
    expect(regionFromStateName('US', 'ok')).toBe('OK');
    expect(regionFromStateName('US', ' OK ')).toBe('OK');
    expect(regionFromStateName('US', 'Narnia')).toBeNull();
    expect(regionFromStateName('US', '')).toBeNull();
    expect(regionFromStateName('US', undefined)).toBeNull();
  });
});
