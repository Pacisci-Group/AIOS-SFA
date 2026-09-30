import { AccessContext, DataScope } from '@sfa/shared';
import type { ServiceTicketScope } from '@sfa/shared';
import { ForbiddenException } from '@nestjs/common';
import { FilterQuery, Types } from 'mongoose';

/**
 * The tenancy + data-scope clamp every service-ticket read starts from.
 *
 * **A service ticket is shared work, so `own` collapses to branch** (PAC-109).
 * David, scrum 2026-09-09: *"all service people be able to see another
 * person's service tickets just in case they need to pick up where somebody
 * left off."* Before this, a CSR out sick took their whole queue with them.
 *
 * This is deliberately the *opposite* of `buildScopeFilter`, which backs the
 * leads list: there `own` pins to the assignee and nothing a client sends can
 * loosen it, because a lead is owned. It matches the call PAC-32/33 already
 * made for client records — `own` collapses to branch for the things the
 * office works together.
 *
 * ## Why this is not `buildScopeFilter`
 *
 * Two reasons, both of which would fail silently rather than loudly:
 *
 * 1. `buildScopeFilter` emits `agencyId`/`branchId` as **strings**, for
 *    collections extending `TenantRecord`. `ServiceTicket` stores both as
 *    **ObjectId**, and a mismatched type matches zero documents — an empty
 *    queue reads as "nothing to do", not as a bug.
 * 2. It excludes `isTestRecord` by default; no ticket query filters on that
 *    flag today, so adopting it would quietly change which rows come back.
 *
 * ## Why not just give the CSR `dataScope: agency`
 *
 * `DataScope` is **one value per user**, collapsed across their roles and read
 * by every module. Widening the CSR template would open leads, deals and
 * households at the same time. The widening belongs to the collection that
 * asked for it.
 *
 * @param requestedScope Which slice of that scope to return — `own`,
 * `others` (everyone else's, unassigned included) or `agency` (undivided).
 * See `SERVICE_TICKET_SCOPES`. It may only ever **narrow**: `own` is honoured
 * at every data scope, and neither `others` nor `agency` reaches past what the
 * caller's `DataScope` already covered.
 */
export function buildTicketScopeFilter<T>(
  access: AccessContext,
  requestedScope?: ServiceTicketScope,
): FilterQuery<T> {
  if (!access.agencyId) {
    // No agency context => nothing to see (defensive; guards prevent this).
    throw new ForbiddenException('Agency context required');
  }

  const filter: FilterQuery<T> = {
    agencyId: new Types.ObjectId(access.agencyId),
  };

  // Narrowing is always safe, so "Mine" is honoured whatever the caller's
  // scope — including for an owner, who uses it to read their own plate.
  if (requestedScope === 'own') {
    return pinToSelf(filter, access);
  }

  const fields = filter as Record<string, unknown>;

  if (access.dataScope === DataScope.Agency) {
    // Nothing to clamp beyond the tenant.
    return requestedScope === 'others' ? excludeSelf(filter, access) : filter;
  }

  // `branch` and `own` land in the same place: the branch floor.
  if (access.branchId) {
    fields.branchId = new Types.ObjectId(access.branchId);
    return requestedScope === 'others' ? excludeSelf(filter, access) : filter;
  }

  /*
   * Fail closed. A narrow scope with no resolved branch has nothing to clamp
   * to, and returning the `agencyId`-only filter would hand the caller the
   * whole agency — which is how the old `branch` arm behaved, quietly. Pin to
   * the caller instead: too few rows is a support ticket, too many is a leak.
   */
  if (requestedScope === 'others') {
    /*
     * ...and "everyone else's, within a scope we could not establish" is not
     * a set we can name. Pinning to self would be the *opposite* of what was
     * asked, so return the empty set explicitly rather than something
     * plausible-looking.
     */
    fields._id = { $in: [] };
    return filter;
  }
  return pinToSelf(filter, access);
}

/**
 * Everyone else's rows: the scope already built, minus the caller's own.
 *
 * `$ne` also matches `null` and a missing field, so **unassigned tickets are
 * included** — nobody's ticket is not the caller's, and an unclaimed one is
 * precisely the thing a colleague should be able to find and pick up.
 */
function excludeSelf<T>(
  filter: FilterQuery<T>,
  access: AccessContext,
): FilterQuery<T> {
  (filter as Record<string, unknown>).assignedUserId = {
    $ne: new Types.ObjectId(access.userId),
  };
  return filter;
}

function pinToSelf<T>(
  filter: FilterQuery<T>,
  access: AccessContext,
): FilterQuery<T> {
  (filter as Record<string, unknown>).assignedUserId = new Types.ObjectId(
    access.userId,
  );
  return filter;
}
