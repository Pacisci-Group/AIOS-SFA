import { normalizePolicyType } from '@sfa/shared';
import { ChangeFieldSpec, changeBusinessDate } from '../activities/change-log';
import type { Deal } from '../deals/schemas/deal.schema';

/**
 * What an edit to a booked sale speaks about in the edit log (PAC-104): the
 * deal, and the policies it holds.
 *
 * Both halves, because the two edits change different things — correcting the
 * sold date moves only the date, while adding a policy changes the list *and*
 * the totals it rolls up into.
 */
export interface DealChangeSubject {
  deal: Pick<Deal, 'soldDate' | 'premium' | 'itemCount' | 'dealType'>;
  policies: Array<{ policyType?: string; policyNumber?: string }>;
}

/**
 * How one policy reads in the log's `policies` list — "Home 1789062605978".
 *
 * Normalized at write time, like every `read` in a change spec: a migrated
 * policy holds a raw SmartSuite code, and nothing re-normalizes a stored change
 * row (see `activities/change-log.ts`).
 */
export function policyChangeLabel(policy: {
  policyType?: string;
  policyNumber?: string;
}): string {
  return [
    normalizePolicyType(policy.policyType) || 'Policy',
    policy.policyNumber?.trim(),
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * The fields the deal's edit log speaks about.
 *
 * The totals are logged alongside the list because they are what a manager is
 * actually auditing: adding a policy moves the premium the Sold scorecard sums
 * and can turn an Auto deal into a Bundle. `policyCount` is left out — it is
 * the list's length. The sold date is logged as the agency-calendar day it
 * falls on (PAC-159), which is the day the form shows and edits.
 */
export const DEAL_CHANGE_FIELDS: ChangeFieldSpec<DealChangeSubject>[] = [
  {
    field: 'soldDate',
    label: 'Sold date',
    kind: 'date',
    read: ({ deal }, { timeZone }) =>
      changeBusinessDate(deal.soldDate, timeZone),
  },
  {
    field: 'policies',
    label: 'Policies',
    kind: 'list',
    read: ({ policies }) => policies.map(policyChangeLabel),
  },
  {
    field: 'premium',
    label: 'Total premium',
    kind: 'currency',
    read: ({ deal }) => deal.premium ?? 0,
  },
  {
    field: 'itemCount',
    label: 'Total items',
    kind: 'number',
    read: ({ deal }) => deal.itemCount ?? 0,
  },
  {
    field: 'dealType',
    label: 'Deal type',
    kind: 'text',
    read: ({ deal }) => deal.dealType ?? null,
  },
];
