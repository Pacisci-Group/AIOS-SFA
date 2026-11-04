import { peopleStatus } from './people-status';

describe('peopleStatus (PAC-162)', () => {
  const removed = { isActive: false, deactivatedAt: new Date('2026-10-01') };
  const invited = { isActive: false, deactivatedAt: null };
  const active = { isActive: true, deactivatedAt: null };

  it('lets the account win over the profile', () => {
    expect(peopleStatus(removed, { status: 'active' })).toBe('deactivated');
    expect(peopleStatus(removed, { status: 'terminated' })).toBe('deactivated');
    expect(peopleStatus(invited, { status: 'active' })).toBe('invited');
    expect(peopleStatus(invited, { status: 'pending' })).toBe('invited');
  });

  it('splits an active account by the profile', () => {
    expect(peopleStatus(active, { status: 'active' })).toBe('active');
    expect(peopleStatus(active, { status: 'pending' })).toBe(
      'pending_onboarding',
    );
    expect(peopleStatus(active, { status: 'terminated' })).toBe(
      'pending_onboarding',
    );
  });

  it('reads a missing profile as pending', () => {
    expect(peopleStatus(active, null)).toBe('pending_onboarding');
    expect(peopleStatus(active, undefined)).toBe('pending_onboarding');
  });
});
