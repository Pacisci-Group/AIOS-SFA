import type { ReconciliationIgnoredReason } from '@sfa/shared';
import type { DashRow } from './dash-file-reader';

/**
 * Which Dash lines are new policies — the data team's rule, from the Excel
 * scrubber this feature replaces: transaction `New Issued Transaction - First
 * Term` or `Sales Issued`, disposition `New Policy Issued`, and not Motor
 * Club. Everything else (an item added to an existing policy, a renewal-term
 * endorsement) is kept as `ignored` so the file's line count still adds up.
 */
export const SALE_TRANSACTION_TYPES = [
  'New Issued Transaction - First Term',
  'Sales Issued',
] as const;

export const SALE_DISPOSITION_CODE = 'New Policy Issued';

const SALE_TRANSACTIONS = new Set(
  SALE_TRANSACTION_TYPES.map((type) => normalize(type)),
);

function normalize(value: string | null): string {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function classifyDashRow(
  row: Pick<
    DashRow,
    'transactionType' | 'dispositionCode' | 'product' | 'productDescription'
  >,
): { isSale: boolean; ignoredReason: ReconciliationIgnoredReason | null } {
  if (
    normalize(row.product) === 'motor club' ||
    normalize(row.productDescription) === 'motor club'
  ) {
    return { isSale: false, ignoredReason: 'motor_club' };
  }
  const transaction = normalize(row.transactionType);
  if (transaction.startsWith('endorsement')) {
    return { isSale: false, ignoredReason: 'endorsement' };
  }
  if (
    !SALE_TRANSACTIONS.has(transaction) ||
    normalize(row.dispositionCode) !== normalize(SALE_DISPOSITION_CODE)
  ) {
    return { isSale: false, ignoredReason: 'not_new_policy' };
  }
  return { isSale: true, ignoredReason: null };
}

/** Channels that mean Allstate sold it, not the agency. */
const DIRECT_CHANNELS = new Set(['1-800', 'allstate.com']);

export function isDirectChannel(channel: string | null): boolean {
  return DIRECT_CHANNELS.has(normalize(channel));
}
