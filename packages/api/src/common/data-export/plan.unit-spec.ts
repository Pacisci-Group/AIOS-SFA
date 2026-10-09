import { BadRequestException } from '@nestjs/common';
import { type AccessContext, AccessScope, DataScope } from '@sfa/shared';
import { countStages, planExport } from './plan';

const AGENCY = '64b7f1d2e4b0a1c2d3e4f5a6';
const BRANCH = '64b7f1d2e4b0a1c2d3e4f5a7';
const OTHER_BRANCH = '64b7f1d2e4b0a1c2d3e4f5a8';
const USER = '64b7f1d2e4b0a1c2d3e4f5a9';

function access(dataScope: DataScope): AccessContext {
  return {
    userId: USER,
    agencyId: AGENCY,
    branchId: BRANCH,
    isPlatformAdmin: false,
    scope: AccessScope.Branch,
    dataScope,
    permissions: [],
    roleIds: [],
    timeZone: 'America/Chicago',
  };
}

const firstMatch = (stages: ReturnType<typeof planExport>['pipeline']) =>
  (stages[0] as { $match: Record<string, unknown> }).$match;

/**
 * The planner both the API (to validate and count) and the worker (to write
 * the file) run. Its contract is that the same input plans the same export —
 * which is what lets the worker re-plan from a stored request.
 */
describe('planExport', () => {
  it("uses the dataset's default date field when none is given", () => {
    const plan = planExport(access(DataScope.Agency), null, 'leads', {});
    expect(plan.dateField.isDefault).toBe(true);
    expect(plan.echo.dateField).toBe(plan.dateField.key);
  });

  it('plans identically from a request body and from its stored echo', () => {
    const body = {
      from: '2026-05-01',
      to: '2026-05-31',
      producerIds: [USER],
      status: ['New'],
    };
    const fromBody = planExport(access(DataScope.Agency), null, 'leads', body);
    const fromEcho = planExport(
      access(DataScope.Agency),
      null,
      'leads',
      fromBody.echo,
    );
    expect(fromEcho.pipeline).toEqual(fromBody.pipeline);
    expect(fromEcho.echo).toEqual(fromBody.echo);
  });

  it('refuses a filter the dataset cannot apply', () => {
    expect(() =>
      planExport(access(DataScope.Agency), null, 'contacts', {
        producerIds: [USER],
      }),
    ).toThrow(BadRequestException);
  });

  it('refuses an unknown date field and an unknown status', () => {
    expect(() =>
      planExport(access(DataScope.Agency), null, 'leads', {
        dateField: 'nonsense',
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      planExport(access(DataScope.Agency), null, 'leads', {
        status: ['Bogus'],
      }),
    ).toThrow(BadRequestException);
  });

  it('narrows to a requested branch at agency scope only', () => {
    const agency = planExport(access(DataScope.Agency), null, 'households', {
      branchId: OTHER_BRANCH,
    });
    expect(firstMatch(agency.pipeline).branchId).toBe(OTHER_BRANCH);
    expect(agency.branchId).toBe(OTHER_BRANCH);

    const branch = planExport(access(DataScope.Branch), BRANCH, 'households', {
      branchId: OTHER_BRANCH,
    });
    expect(firstMatch(branch.pipeline).branchId).toBe(BRANCH);
  });

  it('never exports a test client record', () => {
    const plan = planExport(access(DataScope.Agency), null, 'contacts', {});
    expect(firstMatch(plan.pipeline).isTestRecord).toEqual({ $ne: true });
  });

  it('counts without sorting', () => {
    const plan = planExport(access(DataScope.Agency), null, 'leads', {});
    const stages = countStages(plan);
    expect(stages.some((stage) => '$sort' in stage)).toBe(false);
    expect(stages[stages.length - 1]).toEqual({ $count: 'n' });
  });
});
