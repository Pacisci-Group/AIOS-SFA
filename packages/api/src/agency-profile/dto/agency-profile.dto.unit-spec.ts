import { updateAgencyProfileSchema } from './agency-profile.dto';

describe('updateAgencyProfileSchema', () => {
  it('accepts the zone alone, as PAC-141 sent it', () => {
    expect(
      updateAgencyProfileSchema.parse({ timezone: ' America/New_York ' }),
    ).toEqual({ timezone: 'America/New_York' });
  });

  it('accepts the hour alone (PAC-149)', () => {
    expect(updateAgencyProfileSchema.parse({ endOfDayHour: 18 })).toEqual({
      endOfDayHour: 18,
    });
  });

  it('accepts both, and either end of the day', () => {
    for (const endOfDayHour of [0, 23]) {
      expect(
        updateAgencyProfileSchema.parse({
          timezone: 'America/Chicago',
          endOfDayHour,
        }),
      ).toEqual({ timezone: 'America/Chicago', endOfDayHour });
    }
  });

  it('refuses a body naming neither field', () => {
    const result = updateAgencyProfileSchema.safeParse({});
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/timezone.*endOfDayHour/);
  });

  it.each([
    ['24', 24],
    ['-1', -1],
    ['a fraction', 7.5],
    ['a numeric string', '20'],
    ['null', null],
    ['NaN', NaN],
  ])('refuses %s as the hour', (_label, endOfDayHour) => {
    const result = updateAgencyProfileSchema.safeParse({ endOfDayHour });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['endOfDayHour']);
  });

  it('still refuses a zone the runtime does not know', () => {
    expect(
      updateAgencyProfileSchema.safeParse({ timezone: 'Mars/Olympus_Mons' })
        .success,
    ).toBe(false);
  });
});
