import { AccessContext, AccessScope, DataScope } from '@sfa/shared';
import { ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { buildTicketScopeFilter } from './ticket-scope';

const AGENCY_ID = '6941fdb2dc9a6d024fd8c3a1';
const USER_ID = '507f1f77bcf86cd799439011';
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
    roleIds: [],
    ...overrides,
  };
}

/** Mongo compares ObjectIds by value, but `toEqual` on the wrapper does not. */
function id(filter: Record<string, unknown>, field: string): string | null {
  const value = filter[field];
  return value instanceof Types.ObjectId ? value.toString() : null;
}

describe('buildTicketScopeFilter', () => {
  it('always pins the agency, as an ObjectId', () => {
    const filter = buildTicketScopeFilter(access());

    // `ServiceTicket` stores tenancy as ObjectId, unlike `TenantRecord`
    // collections. A string here matches zero documents, silently.
    expect(id(filter, 'agencyId')).toBe(AGENCY_ID);
  });

  it('refuses a caller with no agency context', () => {
    expect(() => buildTicketScopeFilter(access({ agencyId: null }))).toThrow(
      ForbiddenException,
    );
  });

  describe('the branch floor (PAC-109)', () => {
    it('collapses `own` to the branch — a ticket is shared work', () => {
      const filter = buildTicketScopeFilter(
        access({ dataScope: DataScope.Own }),
      );

      expect(id(filter, 'branchId')).toBe(BRANCH_ID);
      // The point of the ticket: an `own`-scoped CSR is no longer pinned to
      // the rows assigned to them.
      expect(filter.assignedUserId).toBeUndefined();
    });

    it('leaves `branch` where it already was', () => {
      const filter = buildTicketScopeFilter(
        access({ dataScope: DataScope.Branch }),
      );

      expect(id(filter, 'branchId')).toBe(BRANCH_ID);
      expect(filter.assignedUserId).toBeUndefined();
    });

    it('does not narrow an agency-scoped caller to a branch', () => {
      const filter = buildTicketScopeFilter(
        access({ dataScope: DataScope.Agency }),
      );

      expect(filter.branchId).toBeUndefined();
      expect(filter.assignedUserId).toBeUndefined();
    });
  });

  describe('the Mine / Everyone toggle', () => {
    it.each([DataScope.Own, DataScope.Branch, DataScope.Agency])(
      'honours `own` at %s scope, because narrowing is always safe',
      (dataScope) => {
        const filter = buildTicketScopeFilter(access({ dataScope }), 'own');

        expect(id(filter, 'assignedUserId')).toBe(USER_ID);
        expect(filter.branchId).toBeUndefined();
      },
    );

    it('`others` excludes the caller, within the branch floor', () => {
      const filter = buildTicketScopeFilter(
        access({ dataScope: DataScope.Own }),
        'others',
      );

      expect(id(filter, 'branchId')).toBe(BRANCH_ID);
      expect(filter.assignedUserId).toEqual({
        $ne: new Types.ObjectId(USER_ID),
      });
    });

    it("`others` keeps unassigned tickets — nobody's is not mine", () => {
      const filter = buildTicketScopeFilter(access(), 'others');

      /*
       * `$ne` matches null and a missing field as well as another user's id,
       * which is the behaviour we want and the reason this is not
       * `{ $nin: [self] }` plus an explicit null branch. An unclaimed ticket
       * is exactly what a colleague should be able to find and pick up.
       */
      const clause = filter.assignedUserId as { $ne: Types.ObjectId };
      expect(clause.$ne.toString()).toBe(USER_ID);
    });

    it('`own` and `others` partition the branch — no overlap', () => {
      const mine = buildTicketScopeFilter(access(), 'own');
      const theirs = buildTicketScopeFilter(access(), 'others');

      // The dashboard's two parent tabs add up to the branch exactly once:
      // one pins `assignedUserId` to the caller, the other excludes it.
      expect(id(mine, 'assignedUserId')).toBe(USER_ID);
      expect(theirs.assignedUserId).toEqual({
        $ne: new Types.ObjectId(USER_ID),
      });
    });

    it('cannot widen: `agency` from an `own` caller still stops at the branch', () => {
      const filter = buildTicketScopeFilter(
        access({ dataScope: DataScope.Own }),
        'agency',
      );

      // `scope` is a request, not an authorization — a hand-edited query
      // reaches no further than the caller's own data scope.
      expect(id(filter, 'branchId')).toBe(BRANCH_ID);
    });
  });

  describe('fail-closed', () => {
    it.each([DataScope.Own, DataScope.Branch])(
      'pins %s scope to the caller when no branch is resolved',
      (dataScope) => {
        const filter = buildTicketScopeFilter(
          access({ dataScope, branchId: null }),
        );

        // The old `branch` arm returned an agency-wide filter here. Too few
        // rows is a support ticket; too many is a leak.
        expect(id(filter, 'assignedUserId')).toBe(USER_ID);
        expect(filter.branchId).toBeUndefined();
      },
    );

    it('returns the empty set for `others` when no branch is resolved', () => {
      const filter = buildTicketScopeFilter(
        access({ dataScope: DataScope.Own, branchId: null }),
        'others',
      );

      /*
       * Pinning to self — the fail-closed answer for every other scope — is
       * the *opposite* of what `others` asked for, and would show the caller
       * their own queue under a tab labelled "Agency Tickets". Empty is the
       * only honest answer when the scope could not be established.
       */
      expect(filter._id).toEqual({ $in: [] });
    });

    it('still lets an agency-scoped caller through without a branch', () => {
      const filter = buildTicketScopeFilter(
        access({ dataScope: DataScope.Agency, branchId: null }),
      );

      expect(filter.assignedUserId).toBeUndefined();
      expect(filter.branchId).toBeUndefined();
    });
  });
});
