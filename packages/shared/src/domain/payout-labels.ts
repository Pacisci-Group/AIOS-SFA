import type { ComplianceStatus, PremiumLineView, SomStatus } from './payouts';

/**
 * The words a commission statement prints, shared by the page and the PDF
 * (PAC-181) so the two can never name a line, a status or a statement
 * differently. Moved from the web's `payout-format.ts`, which re-exports
 * them.
 */

/** A statement's short reference: the id's last six characters and the version. */
export function statementReference(id: string, version: number): string {
  return `${id.slice(-6).toUpperCase()} · v${version}`;
}

/** "Allstate · JYA leads" for a lead-source line, else the carrier. */
export function premiumLineLabel(
  line: Pick<PremiumLineView, 'carrier' | 'leadSourceName'>,
): string {
  return line.leadSourceName
    ? `${line.carrier} · ${line.leadSourceName} leads`
    : line.carrier;
}

/**
 * A statement is non-compliant on a failed deal audit, or (2026 comp plans)
 * an entered compliance rate below its structure's floor.
 */
export function complianceLabel(
  status: ComplianceStatus,
  failedAudits: number,
  belowFloor = false,
): string {
  if (status === 'compliant') return 'Compliant';
  const audits =
    failedAudits > 0
      ? `${failedAudits} failed audit${failedAudits === 1 ? '' : 's'}`
      : null;
  return (
    [belowFloor ? 'Below the floor' : null, audits]
      .filter(Boolean)
      .join(' · ') || 'Not compliant'
  );
}

/**
 * Salesperson of the Month, as the statement shows it. `null` when the
 * agency has it off — the caller prints its own "not available" word.
 */
export function somStatusLabel(status: SomStatus): string | null {
  switch (status) {
    case 'winner':
      return 'Winner';
    case 'none':
      return 'Not this month';
    default:
      return null;
  }
}
