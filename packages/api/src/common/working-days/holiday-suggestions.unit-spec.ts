import {
  countryName,
  isKnownCountry,
  isKnownRegion,
  listCountries,
  listRegions,
  regionFromStateName,
  regionName,
  suggestHolidays,
  UnknownHolidayRegionError,
} from './holiday-suggestions';

describe('holiday suggestions (date-holidays, PAC-161)', () => {
  it('suggests the US 2026 public holidays, with the substitute day', () => {
    const us = suggestHolidays({ country: 'US', region: 'OK', year: 2026 });
    const byDate = new Map(us.map((row) => [row.date, row]));

    expect(byDate.get('2026-11-26')).toMatchObject({
      name: 'Thanksgiving Day',
      type: 'public',
      substitute: false,
    });
    // The Fourth is a Saturday; the office closes on the Friday.
    expect(byDate.get('2026-07-03')).toMatchObject({
      type: 'public',
      substitute: true,
    });
    expect(byDate.get('2026-07-04')).toMatchObject({ substitute: false });
    // An observance is offered, unchecked by the caller.
    expect(byDate.get('2026-02-14')).toMatchObject({ type: 'observance' });
    expect(us.map((row) => row.date)).toEqual(
      [...us.map((row) => row.date)].sort(),
    );
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
