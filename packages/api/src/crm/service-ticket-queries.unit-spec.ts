import { AccessScope, DataScope } from '@sfa/shared';
import type { AccessContext } from '@sfa/shared';
import { Types } from 'mongoose';
import { ticketTenantFilter } from './service-ticket-queries';

describe('ticketTenantFilter', () => {
  const agencyId = new Types.ObjectId().toString();
  const branchId = new Types.ObjectId().toString();
  const userId = new Types.ObjectId().toString();
  const access = (dataScope: DataScope): AccessContext => ({
    userId,
    agencyId,
    branchId,
    isPlatformAdmin: false,
    scope: AccessScope.Agency,
    dataScope,
    permissions: [],
    roleIds: [],
  });

  it('pins the agency as an ObjectId, never a string', () => {
    const filter = ticketTenantFilter(access(DataScope.Agency));
    expect(filter.agencyId).toBeInstanceOf(Types.ObjectId);
    expect(filter.branchId).toBeUndefined();
    expect(filter.assignedUserId).toBeUndefined();
  });

  it('adds the branch under branch scope', () => {
    const filter = ticketTenantFilter(access(DataScope.Branch));
    expect(String(filter.branchId)).toBe(branchId);
  });

  it('pins the assignee under own scope', () => {
    const filter = ticketTenantFilter(access(DataScope.Own));
    expect(String(filter.assignedUserId)).toBe(userId);
  });

  it('refuses a caller with no agency', () => {
    expect(() =>
      ticketTenantFilter({ ...access(DataScope.Agency), agencyId: null }),
    ).toThrow('Agency context required');
  });
});
