import { AccessContext, AccessScope, DataScope } from '@sfa/shared';
import { Types } from 'mongoose';
import { buildScopeFilter } from './scope-filter';

const AGENCY_ID = '6941fdb2dc9a6d024fd8c3a1';
const USER_ID = '507f1f77bcf86cd799439011';
const OTHER_USER_ID = '507f191e810c19729de860ea';
const BRANCH_ID = '6941fdb2dc9a6d024fd8bc53';

function access(overrides: Partial<AccessContext> = {}): AccessContext {
  return {
    userId: USER_ID,
    agencyId: AGENCY_ID,
    branchId: BRANCH_ID,
    isPlatformAdmin: false,
    scope: AccessScope.Branch,
    dataScope: DataScope.Own,
    permissions: [],
    ...overrides,
  };
}

describe('buildScopeFilter', () => {
  describe('tenancy base', () => {
    it('always pins the agency and excludes test records', () => {
      const filter = buildScopeFilter(access(), BRANCH_ID);

      expect(filter.agencyId).toBe(AGENCY_ID);
      expect(filter.isTestRecord).toEqual({ $ne: true });
    });

    it('omits the test-record clause when the collection lacks the flag', () => {
      const filter = buildScopeFilter(access(), BRANCH_ID, {
        excludeTestRecords: false,
      });

      expect(filter).not.toHaveProperty('isTestRecord');
    });
  });

  // The reason this helper exists at all. `agencyId`/`branchId` are strings on
  // TenantRecord and `producerId` is an ObjectId; mixing them matches zero
  // documents silently, which reads as "no data" rather than as a bug.
  describe('field types', () => {
    it('emits agencyId and branchId as strings, producerId as an ObjectId', () => {
      const filter = buildScopeFilter(
        access({ dataScope: DataScope.Branch }),
        BRANCH_ID,
      );

      expect(typeof filter.agencyId).toBe('string');
      expect(typeof filter.branchId).toBe('string');

      const own = buildScopeFilter(access(), BRANCH_ID);
      expect(own.producerId).toBeInstanceOf(Types.ObjectId);
      expect((own.producerId as Types.ObjectId).toString()).toBe(USER_ID);
    });
  });

  describe('own scope', () => {
    it('pins the caller and ignores a request to widen to agency', () => {
      const filter = buildScopeFilter(access(), BRANCH_ID, {
        requestedScope: 'agency',
      });

      expect((filter.producerId as Types.ObjectId).toString()).toBe(USER_ID);
    });

    it('ignores a foreign producerId rather than honouring or rejecting it', () => {
      // A tampered query returns the caller's own rows — never someone else's,
      // and never an error that would leak that the other producer exists.
      const filter = buildScopeFilter(access(), BRANCH_ID, {
        producerId: OTHER_USER_ID,
      });

      expect((filter.producerId as Types.ObjectId).toString()).toBe(USER_ID);
    });

    it('does not add a branch clause — the producer pin is already narrower', () => {
      const filter = buildScopeFilter(access(), BRANCH_ID);

      expect(filter).not.toHaveProperty('branchId');
    });
  });

  describe('branch scope', () => {
    const branchAccess = access({ dataScope: DataScope.Branch });

    it('pins the branch', () => {
      const filter = buildScopeFilter(branchAccess, BRANCH_ID);

      expect(filter.branchId).toBe(BRANCH_ID);
      expect(filter).not.toHaveProperty('producerId');
    });

    it('does NOT narrow when no branch is resolved', () => {
      // Falling back to an unclamped read would be the dangerous failure here,
      // so the absence of a branchId must leave the filter agency-wide rather
      // than inventing a clause.
      const filter = buildScopeFilter(branchAccess, null);

      expect(filter).not.toHaveProperty('branchId');
      expect(filter).not.toHaveProperty('producerId');
    });

    it('applies a requested producerId *within* the branch clamp', () => {
      const filter = buildScopeFilter(branchAccess, BRANCH_ID, {
        producerId: OTHER_USER_ID,
      });

      expect(filter.branchId).toBe(BRANCH_ID);
      expect((filter.producerId as Types.ObjectId).toString()).toBe(
        OTHER_USER_ID,
      );
    });

    it('honours a voluntary narrowing to own', () => {
      const filter = buildScopeFilter(branchAccess, BRANCH_ID, {
        requestedScope: 'own',
      });

      expect((filter.producerId as Types.ObjectId).toString()).toBe(USER_ID);
    });
  });

  describe('agency scope', () => {
    const agencyAccess = access({
      dataScope: DataScope.Agency,
      scope: AccessScope.Agency,
    });

    it('narrows to the agency and nothing else', () => {
      const filter = buildScopeFilter(agencyAccess, BRANCH_ID);

      expect(filter.agencyId).toBe(AGENCY_ID);
      expect(filter).not.toHaveProperty('branchId');
      expect(filter).not.toHaveProperty('producerId');
    });

    it('honours a voluntary narrowing to own', () => {
      const filter = buildScopeFilter(agencyAccess, BRANCH_ID, {
        requestedScope: 'own',
      });

      expect((filter.producerId as Types.ObjectId).toString()).toBe(USER_ID);
    });

    it('ignores a malformed producerId instead of throwing', () => {
      // `new Types.ObjectId('not-an-id')` throws; an unparseable query param
      // must degrade to "no producer narrowing", not a 500.
      const filter = buildScopeFilter(agencyAccess, BRANCH_ID, {
        producerId: 'not-an-object-id',
      });

      expect(filter).not.toHaveProperty('producerId');
    });
  });

  describe('producerField override', () => {
    it('pins the named field instead of producerId', () => {
      const filter = buildScopeFilter(access(), BRANCH_ID, {
        producerField: 'assignedCrmId',
      });

      expect((filter.assignedCrmId as Types.ObjectId).toString()).toBe(USER_ID);
      expect(filter).not.toHaveProperty('producerId');
    });
  });
});
