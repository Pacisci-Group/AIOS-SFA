import { BadRequestException } from '@nestjs/common';
import {
  assertDateOfBirth,
  assertHireBeforeTermination,
  assertHireDate,
  isIsoDay,
} from './employee-profile.rules';

const TODAY = '2026-11-04';

describe('employee profile rules (PAC-162)', () => {
  it('recognises a real calendar day', () => {
    expect(isIsoDay('2026-02-28')).toBe(true);
    expect(isIsoDay('2028-02-29')).toBe(true);
    expect(isIsoDay('2026-02-30')).toBe(false);
    expect(isIsoDay('2026-13-01')).toBe(false);
    expect(isIsoDay('26-01-01')).toBe(false);
    expect(isIsoDay('2026-01-01T00:00:00Z')).toBe(false);
  });

  it('refuses a hire date after today on the agency calendar', () => {
    expect(() => assertHireDate(TODAY, TODAY)).not.toThrow();
    expect(() => assertHireDate('2019-06-03', TODAY)).not.toThrow();
    expect(() => assertHireDate('2026-11-05', TODAY)).toThrow(
      BadRequestException,
    );
    expect(() => assertHireDate('yesterday', TODAY)).toThrow(
      BadRequestException,
    );
  });

  it('keeps a date of birth in the past and after 1900', () => {
    expect(() => assertDateOfBirth('1990-04-12', TODAY)).not.toThrow();
    expect(() => assertDateOfBirth(TODAY, TODAY)).toThrow(BadRequestException);
    expect(() => assertDateOfBirth('1899-12-31', TODAY)).toThrow(
      BadRequestException,
    );
    expect(() => assertDateOfBirth('1900-01-01', TODAY)).not.toThrow();
  });

  it('refuses a hire date after the termination date, and ignores a missing one', () => {
    expect(() =>
      assertHireBeforeTermination('2026-11-10', '2026-11-04'),
    ).toThrow(BadRequestException);
    expect(() =>
      assertHireBeforeTermination('2026-11-04', '2026-11-04'),
    ).not.toThrow();
    expect(() => assertHireBeforeTermination(null, '2026-11-04')).not.toThrow();
    expect(() => assertHireBeforeTermination('2026-11-10', null)).not.toThrow();
  });
});
