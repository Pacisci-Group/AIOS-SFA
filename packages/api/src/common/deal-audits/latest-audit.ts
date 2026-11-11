import type { PipelineStage } from 'mongoose';

/**
 * A deal's audit, joined onto the deal as a 0- or 1-element array — the one
 * definition of "the deal's audit" for every pipeline that starts from
 * `deals` (PAC-139's Aging Audits card, PAC-106's Deal Audits queue).
 *
 * **The newest row wins.** `dealAudits` is deliberately non-unique on
 * `{agencyId, dealId}`: SmartSuite linked Deals as a *multiple* field, so a
 * legacy re-audit can leave two rows on one deal. Sorting newest-first and
 * taking one is what keeps both readers at one row per deal — "they don't
 * need to see Daniel Lopez eight times".
 *
 * `auditMatch` narrows *which* rows compete before the newest is taken (the
 * Aging card passes `auditStatus: { $ne: 'Pass' }`); pass `{}` to take the
 * newest row whatever its status and filter on it afterwards.
 *
 * Rides the `{agencyId, dealId}` index on `dealAudits`.
 */
export function latestDealAuditLookup(
  auditMatch: Record<string, unknown>,
  project: Record<string, 0 | 1>,
  as = '_audit',
): PipelineStage.Lookup {
  return {
    $lookup: {
      from: 'dealAudits',
      localField: '_id',
      foreignField: 'dealId',
      pipeline: [
        { $match: { isTestRecord: { $ne: true }, ...auditMatch } },
        { $sort: { createdAt: -1 } },
        { $limit: 1 },
        { $project: project },
      ],
      as,
    },
  };
}
