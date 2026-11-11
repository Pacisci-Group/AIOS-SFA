import { DEAL_AUDIT_QUEUE_SORTS } from '@sfa/shared';
import { Types } from 'mongoose';
import { queueSortStages } from './deal-audit-queue.sort';

/** The queue's order, as stages (20 Oct 2026). */
describe('queueSortStages', () => {
  const sortOf = (stages: ReturnType<typeof queueSortStages>) =>
    (stages.at(-1) as { $sort: Record<string, 1 | -1> }).$sort;

  it('ends every order on _id, so paging is stable on a tie', () => {
    for (const sort of DEAL_AUDIT_QUEUE_SORTS) {
      const keys = Object.keys(sortOf(queueSortStages(sort)));
      expect(keys.at(-1)).toBe('_id');
    }
  });

  it('keeps the oldest sale first by default', () => {
    expect(queueSortStages('waiting')).toEqual([
      { $sort: { soldDate: 1, _id: 1 } },
    ]);
  });

  it('sorts clients on a lower-cased copy, not a collation', () => {
    const [addFields] = queueSortStages('client');
    expect(addFields).toEqual({
      $addFields: {
        clientSort: { $toLower: { $ifNull: ['$clientName', ''] } },
      },
    });
    expect(sortOf(queueSortStages('client'))).toEqual({
      clientSort: 1,
      _id: 1,
    });
  });

  it('ranks producers by the order handed in, unknown ones last', () => {
    const ids = [new Types.ObjectId(), new Types.ObjectId()];
    const [addFields] = queueSortStages('producer', ids);
    const rank = (
      addFields as {
        $addFields: {
          producerRank: {
            $let: {
              vars: { rank: { $indexOfArray: [Types.ObjectId[], string] } };
              in: { $cond: [unknown, number, string] };
            };
          };
        };
      }
    ).$addFields.producerRank.$let;
    expect(rank.vars.rank.$indexOfArray[0]).toEqual(ids);
    // `$indexOfArray` answers -1 for a producer not in the list; it becomes
    // one past the last rank rather than sorting first.
    expect(rank.in.$cond[1]).toBe(ids.length);
    expect(sortOf(queueSortStages('producer', ids))).toEqual({
      producerRank: 1,
      soldDate: 1,
      _id: 1,
    });
  });

  it('puts the newest submission first and never-submitted last', () => {
    expect(sortOf(queueSortStages('submitted'))).toEqual({
      submittedSort: -1,
      _id: 1,
    });
  });
});
