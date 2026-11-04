import {
  completeOnboardingSchema,
  updatePersonFactsSchema,
} from './people.dto';

const USER = '66f1a2b3c4d5e6f7a8b9c0d1';

describe('people DTOs (PAC-162)', () => {
  describe('updatePersonFactsSchema', () => {
    it('refuses an empty body and accepts a single cleared field', () => {
      expect(updatePersonFactsSchema.safeParse({}).success).toBe(false);
      const parsed = updatePersonFactsSchema.parse({ phone: '' });
      expect(parsed.phone).toBeNull();
    });

    it('caps the phone and keeps it free text', () => {
      expect(
        updatePersonFactsSchema.parse({ phone: ' (312) 555-0100 ' }).phone,
      ).toBe('(312) 555-0100');
      expect(
        updatePersonFactsSchema.safeParse({ phone: 'x'.repeat(31) }).success,
      ).toBe(false);
    });

    it('wants real calendar days', () => {
      expect(
        updatePersonFactsSchema.safeParse({ hireDate: '2026-02-30' }).success,
      ).toBe(false);
      expect(
        updatePersonFactsSchema.safeParse({ dateOfBirth: '12/04/1990' })
          .success,
      ).toBe(false);
      expect(
        updatePersonFactsSchema.parse({
          hireDate: '2026-02-28',
          dateOfBirth: null,
        }),
      ).toEqual({ hireDate: '2026-02-28', dateOfBirth: null });
    });
  });

  describe('completeOnboardingSchema', () => {
    it('requires the hire date and defaults the policies to none', () => {
      expect(completeOnboardingSchema.safeParse({}).success).toBe(false);
      expect(
        completeOnboardingSchema.parse({ hireDate: '2026-01-05' }),
      ).toEqual({ hireDate: '2026-01-05', policies: [] });
    });

    it('rounds a starting balance and wants a record id per policy', () => {
      const parsed = completeOnboardingSchema.parse({
        hireDate: '2026-01-05',
        policies: [{ policyId: USER, startingBalanceHours: 12.345 }],
      });
      expect(parsed.policies[0].startingBalanceHours).toBe(12.35);
      expect(
        completeOnboardingSchema.safeParse({
          hireDate: '2026-01-05',
          policies: [{ policyId: 'pto' }],
        }).success,
      ).toBe(false);
      expect(
        completeOnboardingSchema.safeParse({
          hireDate: '2026-01-05',
          policies: [{ policyId: USER }, { policyId: USER }],
        }).success,
      ).toBe(false);
      expect(
        completeOnboardingSchema.safeParse({
          hireDate: '2026-01-05',
          policies: [{ policyId: USER, startingBalanceHours: -1 }],
        }).success,
      ).toBe(false);
    });
  });
});
