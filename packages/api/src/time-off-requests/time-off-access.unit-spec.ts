import { DataScope } from '@sfa/shared';
import {
  coversBranch,
  HR_REVIEW_PERMISSION,
  reviewScopeFilter,
  reviewsBranch,
} from './time-off-access';

const reviewer = (
  dataScope: DataScope,
  branchId: string | null,
  permissions = ['hr:read', HR_REVIEW_PERMISSION],
) => ({ dataScope, branchId, permissions });

describe('time off access (PAC-165)', () => {
  it('names the HR module write permission as the reviewer capability', () => {
    expect(HR_REVIEW_PERMISSION).toBe('hr:write');
  });

  it('reaches every branch from agency scope, one from branch scope, none from own', () => {
    expect(coversBranch(DataScope.Agency, null, 'north')).toBe(true);
    expect(coversBranch(DataScope.Branch, 'north', 'north')).toBe(true);
    expect(coversBranch(DataScope.Branch, 'north', 'south')).toBe(false);
    expect(coversBranch(DataScope.Own, 'north', 'north')).toBe(false);
  });

  it('reaches nothing from a branch scope with no branch — never everything', () => {
    expect(coversBranch(DataScope.Branch, null, 'north')).toBe(false);
    expect(coversBranch(DataScope.Branch, undefined, 'north')).toBe(false);
    expect(coversBranch(DataScope.Branch, null, null)).toBe(false);
    expect(reviewScopeFilter(reviewer(DataScope.Branch, null))).toBeNull();
  });

  it('gives a reader no reach at all, however wide their data scope', () => {
    // CRM is branch scope and Data Team agency scope, both with `hr:read` only.
    const crm = reviewer(DataScope.Branch, 'north', ['hr:read']);
    const dataTeam = reviewer(DataScope.Agency, null, ['hr:read']);
    expect(reviewsBranch(crm, 'north')).toBe(false);
    expect(reviewsBranch(dataTeam, 'north')).toBe(false);
    expect(reviewScopeFilter(crm)).toBeNull();
    expect(reviewScopeFilter(dataTeam)).toBeNull();
  });

  it('builds the team list clause from the scope', () => {
    expect(reviewScopeFilter(reviewer(DataScope.Agency, null))).toEqual({});
    expect(reviewScopeFilter(reviewer(DataScope.Branch, 'north'))).toEqual({
      branchId: 'north',
    });
    expect(reviewScopeFilter(reviewer(DataScope.Own, 'north'))).toBeNull();
    expect(reviewsBranch(reviewer(DataScope.Branch, 'north'), 'north')).toBe(
      true,
    );
    expect(reviewsBranch(reviewer(DataScope.Branch, 'north'), 'south')).toBe(
      false,
    );
  });
});
