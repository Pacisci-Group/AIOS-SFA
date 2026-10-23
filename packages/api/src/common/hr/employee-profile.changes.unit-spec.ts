import {
  diffProfileSnapshots,
  type ProfileDisplaySnapshot,
} from './employee-profile.changes';

const base: ProfileDisplaySnapshot = {
  status: 'pending',
  hireDate: null,
  workAnniversary: null,
  terminationDate: null,
  dateOfBirth: null,
  showBirthday: true,
  leavePolicyName: null,
  overriddenPaths: [],
  scheduleTemplateName: null,
  scheduleOverride: null,
  allocations: {},
};

describe('diffProfileSnapshots (PAC-162)', () => {
  it('reports nothing for two equal snapshots', () => {
    expect(diffProfileSnapshots(base, { ...base })).toEqual([]);
  });

  it('logs an activation as status, hire date, policy and anniversary', () => {
    const after: ProfileDisplaySnapshot = {
      ...base,
      status: 'active',
      hireDate: '2026-01-10',
      workAnniversary: '01-10',
      leavePolicyName: 'Standard',
      overriddenPaths: ['pto.annualAllocationHours'],
      allocations: { paid: 120 },
    };
    const changes = diffProfileSnapshots(base, after);
    expect(changes.map((c) => c.field)).toEqual([
      'status',
      'hireDate',
      'workAnniversary',
      'leavePolicy',
      'customRules',
      'allocations',
    ]);
    expect(changes[0]).toEqual({
      field: 'status',
      label: 'Status',
      kind: 'text',
      from: 'Pending onboarding',
      to: 'Active',
    });
    expect(changes[5].to).toEqual(['paid: 120 h']);
  });

  it('never writes the birthday itself, only that it was set', () => {
    const changes = diffProfileSnapshots(base, {
      ...base,
      dateOfBirth: '1990-05-05',
    });
    expect(changes).toEqual([
      {
        field: 'dateOfBirth',
        label: 'Date of birth',
        kind: 'text',
        from: null,
        to: 'Set',
      },
    ]);
  });

  it('summarises a schedule override day by day', () => {
    const changes = diffProfileSnapshots(base, {
      ...base,
      scheduleOverride: { 1: { start: '08:00', end: '16:00' }, 5: null },
    });
    expect(changes[0].to).toEqual(['Mon 08:00–16:00', 'Fri off']);
  });

  it('treats a missing before as everything being new', () => {
    const changes = diffProfileSnapshots(null, base);
    expect(changes.map((c) => c.field)).toEqual(['status', 'showBirthday']);
  });
});
