import { DataScope } from '@sfa/shared';
import type { AccessContext } from '@sfa/shared';
import { ForbiddenException } from '@nestjs/common';
import { FilterQuery, Types } from 'mongoose';
import type { ServiceTicketDocument } from './schemas/service-ticket.schema';

/**
 * Mongo predicates over `serviceTickets` that more than one reader needs.
 *
 * Extracted from `ServiceTicketsService` when the Manager view (PAC-139) became
 * the second reader of the collection: that service is 2,500 lines of
 * workflow, and importing it for one predicate would drag the whole CRM module
 * into a dashboard that only counts.
 *
 * "Which tickets are overdue" is deliberately *not* here any more. It used to
 * be — a derived `$or` over the steps' `dueAt` — until PAC-102 materialised
 * `status`, at which point the stored column became the one answer and the
 * predicate a second implementation of the rule. Readers match
 * `status: 'overdue'`; `common/scheduling/step-status.ts` owns the derivation.
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
