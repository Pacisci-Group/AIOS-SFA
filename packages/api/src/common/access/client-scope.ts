import { ForbiddenException } from '@nestjs/common';
import { AccessContext, DataScope } from '@sfa/shared';
import { FilterQuery } from 'mongoose';

/**
 * Tenancy + data scope for the client-record collections (`households`,
 * `contacts`, `policies`, `householdMembers`).
 *
 * Extracted from `ClientsService` when `UnlinkedRecordsService` needed the same
 * rule (PAC-91 §10). One copy, because the failure mode of two is silent: these
 * collections store `agencyId` / `branchId` as **plain strings** (unlike
 * `ServiceTicket`, where they are ObjectIds), and a filter built with the wrong
 * type returns zero documents with no error at all.
 *
 * `own` deliberately collapses to **branch**: client records are shared and
 * carry no per-user owner, so there is nothing for `own` to key on.
 */
export type ClientScopeFilter = FilterQuery<{
  agencyId: string;
  branchId: string;
}>;

/**
 * The caller's tenant, as the plain string these collections store.
 *
 * Separate from {@link clientScopeFilter} because a `FilterQuery` value is not
 * a `string` to TypeScript, and the membership queries need one. Both throw on
 * the same condition, which the guards already prevent.
 */
export function clientAgencyId(access: AccessContext): string {
  if (!access.agencyId) {
    throw new ForbiddenException('Agency context required');
  }
  return access.agencyId;
}

export function clientScopeFilter(access: AccessContext): ClientScopeFilter {
  const filter: ClientScopeFilter = { agencyId: clientAgencyId(access) };

  if (access.dataScope === DataScope.Agency) {
    return filter;
  }

  // `branch` and `own` both resolve to branch: client records are shared and
  // have no assigned user for `own` to key on.
  if (access.branchId) {
    filter.branchId = access.branchId;
  }
  return filter;
}
