import { AccessContext, AccessScope, DataScope } from '@sfa/shared';
import { Types } from 'mongoose';
import { buildScopeFilter } from './scope-filter';

const AGENCY_ID = '6941fdb2dc9a6d024fd8c3a1';
const USER_ID = '507f1f77bcf86cd799439011';
const OTHER_USER_ID = '507f191e810c19729de860ea';
const BRANCH_ID = '6941fdb2dc9a6d024fd8bc53';
const ROLE_ID = '68a1f77bcf86cd7994390abc';
const OTHER_ROLE_ID = '68a1f77bcf86cd7994390def';

function access(overrides: Partial<AccessContext> = {}): AccessContext {
  return {
    userId: USER_ID,
    agencyId: AGENCY_ID,
    branchId: BRANCH_ID,
    isPlatformAdmin: false,
    scope: AccessScope.Branch,
    dataScope: DataScope.Own,
    permissions: [],
    roleIds: [ROLE_ID],
    ...overrides,
  };
}

/** The polymorphic-ownership option, as `dealAudits` passes it (PAC-72). */
const ASSIGNEE = { path: 'auditAssignee', polymorphic: true } as const;

/** `$in` members as comparable strings. */
function owners(filter: Record<string, unknown>): string[] {
  const clause = filter['auditAssignee.id'] as { $in: Types.ObjectId[] };
  return clause.$in.map((id) => id.toString());
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

  // PAC-72: `dealAudits.auditAssignee` is `{ type: 'user' | 'role', id }`, so
  // "mine" means assigned to me *or* to a role I hold.
  describe('polymorphic ownership', () => {
    it('matches the caller and every role they hold under own scope', () => {
      const filter = buildScopeFilter(
        access({ roleIds: [ROLE_ID, OTHER_ROLE_ID] }),
        BRANCH_ID,
        { ownerField: ASSIGNEE },
      );

      expect(owners(filter)).toEqual([USER_ID, ROLE_ID, OTHER_ROLE_ID]);
      expect(filter).not.toHaveProperty('producerId');
    });

    it('still matches the caller when they hold no roles', () => {
      const filter = buildScopeFilter(access({ roleIds: [] }), BRANCH_ID, {
        ownerField: ASSIGNEE,
      });

      expect(owners(filter)).toEqual([USER_ID]);
    });

    it('ignores a malformed roleId instead of throwing', () => {
      // Same contract as a malformed `producerId`: bad data degrades to "not
      // one of my owners", never a 500.
      const filter = buildScopeFilter(
        access({ roleIds: ['not-an-object-id', ROLE_ID] }),
        BRANCH_ID,
        { ownerField: ASSIGNEE },
      );

      expect(owners(filter)).toEqual([USER_ID, ROLE_ID]);
    });

    it('emits ObjectIds, not strings', () => {
      // The trap this whole helper exists for: `auditAssignee.id` is an
      // ObjectId, so a string `$in` matches zero documents in silence.
      const filter = buildScopeFilter(access(), BRANCH_ID, {
        ownerField: ASSIGNEE,
      });
      const clause = filter['auditAssignee.id'] as { $in: unknown[] };

      for (const id of clause.$in) {
        expect(id).toBeInstanceOf(Types.ObjectId);
      }
    });

    it('ignores a request to widen to agency under own scope', () => {
      const filter = buildScopeFilter(access(), BRANCH_ID, {
        ownerField: ASSIGNEE,
        requestedScope: 'agency',
      });

      expect(owners(filter)).toEqual([USER_ID, ROLE_ID]);
    });

    it('honours a voluntary narrowing to own from agency scope', () => {
      const filter = buildScopeFilter(
        access({ dataScope: DataScope.Agency, scope: AccessScope.Agency }),
        BRANCH_ID,
        { ownerField: ASSIGNEE, requestedScope: 'own' },
      );

      expect(owners(filter)).toEqual([USER_ID, ROLE_ID]);
    });

    it('leaves an agency-scoped read unclamped by owner', () => {
      const filter = buildScopeFilter(
        access({ dataScope: DataScope.Agency, scope: AccessScope.Agency }),
        BRANCH_ID,
        { ownerField: ASSIGNEE },
      );

      expect(filter).not.toHaveProperty('auditAssignee.id');
      expect(filter.agencyId).toBe(AGENCY_ID);
    });

    it('narrows a requested producerId to that *user*, never a role', () => {
      // A role is a queue, so "show me Dana's audits" must not also return
      // everything sitting on a team Dana happens to belong to.
      const filter = buildScopeFilter(
        access({ dataScope: DataScope.Agency, scope: AccessScope.Agency }),
        BRANCH_ID,
        { ownerField: ASSIGNEE, producerId: OTHER_USER_ID },
      );

      expect(filter['auditAssignee.type']).toBe('user');
      expect((filter['auditAssignee.id'] as Types.ObjectId).toString()).toBe(
        OTHER_USER_ID,
      );
    });

    it('never emits a top-level $or, so callers can use their own', () => {
      // The clause is a single-field `$in` precisely so a caller spreading this
      // filter and adding `$or` cannot clobber the tenancy clamp.
      const filter = buildScopeFilter(access(), BRANCH_ID, {
        ownerField: ASSIGNEE,
      });

      expect(filter).not.toHaveProperty('$or');
    });
  });
});
