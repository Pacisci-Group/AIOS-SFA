import { AccessScope, DataScope } from '@sfa/shared';
import type { AccessContext } from '@sfa/shared';
import { Types } from 'mongoose';
import { deriveStepStatus } from './scheduling/step-status';
import {
  overdueTicketMatch,
  ticketTenantFilter,
} from './service-ticket-queries';

/**
 * A tiny evaluator for the subset of Mongo query syntax the predicate uses —
 * equality, `null`, dotted paths, `$or`, `$ne`, `$lt` — so the predicate can be
 * checked against the same fixtures `deriveStepStatus` is checked against,
 * without a database.
 */
function matches(doc: Record<string, unknown>, query: unknown): boolean {
  const q = query as Record<string, unknown>;
  return Object.entries(q).every(([key, expected]) => {
    if (key === '$or') {
      return (expected as unknown[]).some((clause) => matches(doc, clause));
    }
    const actual = key
      .split('.')
      .reduce<unknown>(
        (value, part) =>
          value && typeof value === 'object'
            ? (value as Record<string, unknown>)[part]
            : undefined,
        doc,
      );
    if (
      expected &&
      typeof expected === 'object' &&
      !(expected instanceof Date)
    ) {
      const ops = expected as Record<string, unknown>;
      return Object.entries(ops).every(([op, operand]) => {
        if (op === '$ne') return (actual ?? null) !== (operand ?? null);
        if (op === '$lt')
          return actual instanceof Date && actual < (operand as Date);
        throw new Error(`unsupported operator ${op}`);
      });
    }
    return (actual ?? null) === (expected ?? null);
  });
}

describe('overdueTicketMatch', () => {
  const now = new Date('2026-09-23T12:00:00.000Z');
  const past = new Date('2026-09-20T12:00:00.000Z');
  const future = new Date('2026-09-30T12:00:00.000Z');
  const query = overdueTicketMatch(now);

  const step = (dueAt: Date | null, completedAt: Date | null) => ({
    availableAt: past,
    dueAt,
    completedAt,
  });

  it.each([
    [
      'a plain ticket marked overdue',
      { status: 'overdue', onboarding: null, renewal: null },
      true,
    ],
    [
      'a plain open ticket',
      { status: 'open', onboarding: null, renewal: null },
      false,
    ],
    [
      'a resolved plain ticket',
      { status: 'resolved', onboarding: null, renewal: null },
      false,
    ],
    [
      'an onboarding call past due',
      {
        status: 'open',
        statusOverriddenAt: null,
        onboarding: step(past, null),
        renewal: null,
      },
      true,
    ],
    [
      'a renewal call past due',
      {
        status: 'open',
        statusOverriddenAt: null,
        onboarding: null,
        renewal: step(past, null),
      },
      true,
    ],
    [
      'an onboarding call completed after its due date',
      {
        status: 'open',
        statusOverriddenAt: null,
        onboarding: step(past, now),
        renewal: null,
      },
      false,
    ],
    [
      'an onboarding call not yet due',
      {
        status: 'open',
        statusOverriddenAt: null,
        onboarding: step(future, null),
        renewal: null,
      },
      false,
    ],
    [
      'a scheduled call with no due date',
      {
        status: 'open',
        statusOverriddenAt: null,
        onboarding: step(null, null),
        renewal: null,
      },
      false,
    ],
    [
      'a past-due call a CSR pinned to open',
      {
        status: 'open',
        statusOverriddenAt: past,
        onboarding: step(past, null),
        renewal: null,
      },
      false,
    ],
    [
      'a not-yet-due call a CSR pinned to overdue',
      {
        status: 'overdue',
        statusOverriddenAt: past,
        onboarding: step(future, null),
        renewal: null,
      },
      true,
    ],
  ])('%s → %s', (_name, doc, expected) => {
    expect(matches(doc, query)).toBe(expected);
  });

  it('agrees with deriveStepStatus for an un-overridden scheduled call', () => {
    for (const dueAt of [past, future, null]) {
      for (const completedAt of [null, now]) {
        const doc = {
          status: 'open',
          statusOverriddenAt: null,
          onboarding: step(dueAt, completedAt),
          renewal: null,
        };
        expect(matches(doc, query)).toBe(
          deriveStepStatus(doc.onboarding, now) === 'overdue',
        );
      }
    }
  });
});

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
