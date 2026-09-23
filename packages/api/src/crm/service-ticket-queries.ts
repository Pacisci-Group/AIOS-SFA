import { DataScope } from '@sfa/shared';
import type { AccessContext } from '@sfa/shared';
import { ForbiddenException } from '@nestjs/common';
import { FilterQuery, Types } from 'mongoose';
import type { ServiceTicketDocument } from './schemas/service-ticket.schema';

/**
 * Mongo predicates over `serviceTickets` that more than one reader needs.
 *
 * Extracted from `ServiceTicketsService` when the Manager view (PAC-139) became
 * the second reader of "which tickets are overdue": that service is 2,500 lines
 * of workflow, and importing it for one predicate would drag the whole CRM
 * module into a dashboard that only counts.
 */

/**
 * Tenancy + data scope for a ticket read. `own` sees tickets assigned to the
 * caller, `branch` the caller's branch, `agency` the whole agency.
 *
 * ⚠ `serviceTickets` stores `agencyId` / `branchId` as **ObjectIds**, unlike
 * every `TenantRecord` collection (strings) — which is why `buildScopeFilter`
 * cannot serve it and this exists. A string here silently matches nothing.
 */
export function ticketTenantFilter(
  access: AccessContext,
): FilterQuery<ServiceTicketDocument> {
  if (!access.agencyId) {
    // No agency context => nothing to see (defensive; guards prevent this).
    throw new ForbiddenException('Agency context required');
  }
  const filter: FilterQuery<ServiceTicketDocument> = {
    agencyId: new Types.ObjectId(access.agencyId),
  };

  if (access.dataScope === DataScope.Agency) {
    return filter;
  }
  if (access.dataScope === DataScope.Branch) {
    if (access.branchId) {
      filter.branchId = new Types.ObjectId(access.branchId);
    }
    return filter;
  }
  // own
  filter.assignedUserId = new Types.ObjectId(access.userId);
  return filter;
}

/**
 * "This ticket is overdue right now" — the Service dashboard's meaning, as a
 * query the database can answer.
 *
 * Overdue is only *partly* stored. An onboarding or renewal call carries a
 * scheduled step and derives its status from that step's timing on every read
 * (`deriveStepStatus` in `scheduling/step-status.ts`): incomplete and past
 * `dueAt` is overdue, whatever `status` says, unless a CSR set the status by
 * hand (`statusOverriddenAt`). Every other ticket is overdue only when its
 * stored `status` says so. This mirrors that derivation branch for branch, and
 * the unit spec pins the two together.
 *
 * Returns a `$or`, so a caller with its own `$or` must nest this under `$and`.
 */
export function overdueTicketMatch(
  now: Date,
): FilterQuery<ServiceTicketDocument> {
  return {
    $or: [
      // Neither kind of scheduled step — the stored status is the whole truth.
      { onboarding: null, renewal: null, status: 'overdue' },
      // A scheduled call whose status a CSR pinned by hand.
      { statusOverriddenAt: { $ne: null }, status: 'overdue' },
      // The derived branches. `$ne: null` before `$lt`: BSON sorts null before
      // dates, so a bare `$lt` would match an unscheduled step too.
      {
        statusOverriddenAt: null,
        'onboarding.completedAt': null,
        'onboarding.dueAt': { $ne: null, $lt: now },
      },
      {
        statusOverriddenAt: null,
        'renewal.completedAt': null,
        'renewal.dueAt': { $ne: null, $lt: now },
      },
    ],
  };
}
