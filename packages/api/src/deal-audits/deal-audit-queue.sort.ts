import type { DealAuditQueueSort } from '@sfa/shared';
import type { PipelineStage, Types } from 'mongoose';

/**
 * The Deal Audits queue's order (20 Oct 2026), as the stages that run inside
 * the page facet — after the audit lookup, so `_audit` is there to sort on.
 *
 * Every order ends on `_id`, which is what keeps paging stable when two deals
 * tie. The helper fields these add never reach a row: the facet's `$project`
 * is a whitelist.
 *
 * - `waiting` — oldest sale first, the deal that has sat longest (PAC-106).
 * - `client` — on a lower-cased copy, **not** an aggregate `collation`: a
 *   collated aggregate compares every string in the first `$match`
 *   collation-aware, `deals.agencyId` is a string, and the `{ agencyId, … }`
 *   indexes would stop serving the queue.
 * - `producer` — names are resolved in Node, never stored on the deal, so the
 *   caller hands over the producer ids already in name order and each deal is
 *   ranked by its position. A producer not in the list (none, or a user since
 *   deleted) ranks after everyone.
 * - `submitted` — newest submission first; never-submitted audits last (a
 *   null sorts after every date when descending).
 */
export function queueSortStages(
  sort: DealAuditQueueSort,
  producersByName: readonly Types.ObjectId[] = [],
): PipelineStage.FacetPipelineStage[] {
  switch (sort) {
    case 'waiting':
      return [{ $sort: { soldDate: 1, _id: 1 } }];
    case 'client':
      return [
        {
          $addFields: {
            clientSort: { $toLower: { $ifNull: ['$clientName', ''] } },
          },
        },
        { $sort: { clientSort: 1, _id: 1 } },
      ];
    case 'producer':
      return [
        {
          $addFields: {
            producerRank: {
              $let: {
                vars: {
                  rank: {
                    $indexOfArray: [[...producersByName], '$producerId'],
                  },
                },
                in: {
                  $cond: [
                    { $lt: ['$$rank', 0] },
                    producersByName.length,
                    '$$rank',
                  ],
                },
              },
            },
          },
        },
        { $sort: { producerRank: 1, soldDate: 1, _id: 1 } },
      ];
    case 'submitted':
      return [
        {
          $addFields: {
            submittedSort: { $first: '$_audit.submittedAt' },
          },
        },
        { $sort: { submittedSort: -1, _id: 1 } },
      ];
  }
}
