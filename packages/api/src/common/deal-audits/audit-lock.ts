import {
  DEFAULT_DEAL_AUDIT_STATUS,
  normalizeDealAuditStatus,
} from '@sfa/shared';
import type { DealAuditStatus } from '@sfa/shared';
import { Model, Types } from 'mongoose';
import { DealAudit } from '../../deal-audits/schemas/deal-audit.schema';

/** Where a deal's audit stands, as the sale's correction paths read it. */
export interface DealAuditLock {
  /** The furthest it has got, or `null` when it has none. */
  status: DealAuditStatus | null;
  /**
   * Whether the sale may no longer be corrected — a policy added, the sold
   * date moved, or a sold policy edited (PAC-104, PAC-106).
   *
   * Locked when the audit has **passed**, or a **person** submitted it and it
   * is with the reviewer: in both a manager has checked, or is checking, the
   * sale as it stands, and a change underneath would leave their "Correct
   * Sold Date" or "Correct Effective Date" pass vouching for a value that is
   * no longer there. Decided with the product owner for Add policy — block rather than
   * reopen — and extended to the other two edits in the PAC-106 review.
   *
   * Not locked when it was sent back (`Fail`) — the producer's "Fix it" exists
   * to correct the sale — nor when the *system* submitted it (`Pending` with no
   * `submittedById`): nobody has handed it over, and the strict Approve gate
   * makes the manager rule on every item as it then stands.
   */
  locked: boolean;
}

/**
 * The one definition of {@link DealAuditLock}, shared by the Edit sale page
 * (`SoldDealsService`), the Sold card's policy edit (`PoliciesService`) and the
 * Lead Detail read that decides whether to offer it.
 *
 * Every parent row is read, not just the newest: `dealAudits` is non-unique on
 * `{agencyId, dealId}` because migrated data can hold several, and a deal any
 * one of which is locked counts as locked.
 */
export async function loadDealAuditLock<TAudit extends DealAudit>(
  dealAuditModel: Model<TAudit>,
  agencyId: string,
  dealId: Types.ObjectId,
): Promise<DealAuditLock> {
  const audits = await dealAuditModel
    .find({ agencyId, dealId })
    .select('auditStatus submittedById')
    .lean<
      Array<{ auditStatus?: string; submittedById?: Types.ObjectId | null }>
    >();
  if (!audits.length) return { status: null, locked: false };

  const statuses = audits.map((audit) =>
    normalizeDealAuditStatus(audit.auditStatus),
  );
  return {
    status:
      statuses.find((status) => status !== DEFAULT_DEAL_AUDIT_STATUS) ??
      DEFAULT_DEAL_AUDIT_STATUS,
    locked: audits.some((audit, index) => {
      const status = statuses[index];
      return (
        status === 'Pass' || (status === 'Pending' && !!audit.submittedById)
      );
    }),
  };
}

/** What a refused correction says — the 409 and the page's hint alike. */
export const AUDIT_LOCKED_MESSAGE =
  "This sale's audit has been approved, or is with a reviewer. It has to be sent back before the sale can be changed.";
