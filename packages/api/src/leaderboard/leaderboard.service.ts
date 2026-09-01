import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { NEW_BUSINESS_MATCH } from '@sfa/shared';
import type {
  AccessContext,
  LeaderboardEntry,
  LeaderboardResponse,
  LeaderboardSelf,
} from '@sfa/shared';
import { Model, PipelineStage, Types } from 'mongoose';
import { Deal, DealDocument } from '../deals/schemas/deal.schema';
import { roundCents } from '../common/domain/money';
import {
  ProducerGoal,
  ProducerGoalDocument,
} from '../producer-goals/schemas/producer-goal.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  currentChicagoMonth,
  resolveRange,
} from '../performance/performance.range';
import { GetLeaderboardDto } from './dto/get-leaderboard.dto';
import { initialsFrom } from '../common/domain/initials';
import { LeaderboardRow, attainment, rankRows } from './leaderboard.normalize';

/** `$facet` output: one rollup per producer, plus the office-wide total. */
interface LeaderboardFacet {
  byProducer: Array<{ _id: Types.ObjectId; premium: number }>;
  office: Array<{ premium: number }>;
}

type UserLean = {
  _id: Types.ObjectId;
  firstName?: string;
  lastName?: string;
  email: string;
};

type GoalLean = { producerId: Types.ObjectId; goalPremium: number };

/**
 * The Motivation Hub (PAC-13).
 *
 * ---
 *
 * **This service intentionally does NOT call `buildScopeFilter`.**
 *
 * It reads agency-wide regardless of the caller's `DataScope`, because a
 * producer (`own`) must be able to see the office total and other producers'
 * standings — that is the entire product requirement, not an oversight. The
 * gate is `leaderboard:read`, which the Producer role template grants.
 *
 * What that gate buys is bounded by the response contract in
 * `@sfa/shared/domain/leaderboard`: another producer's row carries a rank and a
 * percentage, never a dollar figure. Dollars appear only on `officeTotalPremium`
 * (an aggregate) and on `self` (the caller's own data).
 *
 * Do not "fix" this by adding a scope clamp — it would make the board show a
 * producer only themselves — and do not add `premium` to `LeaderboardEntry`.
 * Both are load-bearing, and both are asserted in the e2e suite.
 *
 * `X-Branch-Id` is ignored for the same reason: "office" means the agency.
 * A per-branch leaderboard has no product definition yet.
 */
@Injectable()
export class LeaderboardService {
  constructor(
    @InjectModel(Deal.name) private dealModel: Model<DealDocument>,
    @InjectModel(ProducerGoal.name)
    private producerGoalModel: Model<ProducerGoalDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {}

  async get(
    access: AccessContext,
    query: GetLeaderboardDto,
  ): Promise<LeaderboardResponse> {
    const month = query.month ?? currentChicagoMonth();
    const range = this.monthRange(month);
    const agencyId = access.agencyId;

    const [facet] = await this.dealModel.aggregate<LeaderboardFacet>(
      this.pipeline(agencyId, range.startYmd, range.endYmd),
    );

    const premiumByProducer = new Map<string, number>(
      (facet?.byProducer ?? []).map((row) => [
        row._id.toString(),
        roundCents(row.premium),
      ]),
    );
    const officeTotalPremium = roundCents(facet?.office?.[0]?.premium ?? 0);

    const goals = await this.producerGoalModel
      .find({ agencyId, month }, { producerId: 1, goalPremium: 1 })
      .lean<GoalLean[]>();
    const goalByProducer = new Map<string, number>(
      goals.map((goal) => [goal.producerId.toString(), goal.goalPremium]),
    );

    /*
     * The union, not just the producers who sold.
     *
     * A producer with a goal but no sales this month must still appear — they
     * are exactly who a motivation panel is for, and a board that silently
     * shrinks in a slow month is the opposite of motivating.
     */
    const producerIds = [
      ...new Set([...premiumByProducer.keys(), ...goalByProducer.keys()]),
    ];

    const names = await this.namesFor(producerIds);

    const rows: LeaderboardRow[] = producerIds.map((producerId) => {
      const premium = premiumByProducer.get(producerId) ?? 0;
      const goalPremium = goalByProducer.get(producerId) ?? null;
      return {
        producerId,
        name: names.get(producerId) ?? 'Unknown Producer',
        premium,
        goalPremium,
        attainmentPct: attainment(premium, goalPremium),
      };
    });

    const ranked = rankRows(rows);
    const selfRow = ranked.find((row) => row.producerId === access.userId);

    const entries: LeaderboardEntry[] = ranked
      .slice(0, query.limit)
      .map((row) => this.toEntry(row, access.userId));

    /*
     * Always include the caller, appended at their true rank when they fall
     * outside the top N. "Own row highlighted" is meaningless for a producer
     * ranked 12th, and seeing your own position is the point of the card.
     */
    const isOutsideTop = Boolean(
      selfRow && !entries.some((entry) => entry.isSelf),
    );
    if (selfRow && isOutsideTop) {
      entries.push(this.toEntry(selfRow, access.userId));
    }

    const self: LeaderboardSelf | null = selfRow
      ? {
          producerId: selfRow.producerId,
          rank: selfRow.rank,
          premium: selfRow.premium,
          goalPremium: selfRow.goalPremium,
          attainmentPct: selfRow.attainmentPct,
          isOutsideTop,
        }
      : null;

    return {
      month,
      officeTotalPremium,
      producerCount: ranked.length,
      // Lets the card distinguish "nobody hit their goal" from "nobody has one"
      // (PAC-80). On migrated data this is 0 for every month.
      goalsConfigured: goalByProducer.size,
      self,
      entries,
    };
  }

  private toEntry(
    row: LeaderboardRow & { rank: number },
    selfUserId: string,
  ): LeaderboardEntry {
    return {
      producerId: row.producerId,
      name: row.name,
      initials: initialsFrom(row.name),
      rank: row.rank,
      attainmentPct: row.attainmentPct,
      isSelf: row.producerId === selfUserId,
    };
  }

  /** The whole calendar month, as the `YYYYMMDD` bounds deals are indexed by. */
  private monthRange(month: string): { startYmd: number; endYmd: number } {
    const [year, monthPart] = month.split('-');
    const first = `${year}-${monthPart}-01`;
    // The last day of the month, found by stepping back from the 1st of the
    // next one — `resolveRange('lastMonth')` does the same walk.
    const nextMonth = new Date(Date.UTC(Number(year), Number(monthPart), 1));
    const lastDay = new Date(nextMonth.getTime() - 86_400_000);
    const to = lastDay.toISOString().slice(0, 10);
    return resolveRange('custom', { from: first, to });
  }

  private pipeline(
    agencyId: string | null,
    startYmd: number,
    endYmd: number,
  ): PipelineStage[] {
    return [
      {
        $match: {
          agencyId,
          isTestRecord: { $ne: true },
          producerId: { $ne: null },
          /*
           * New business only. A company transfer is attributed to the CSR who
           * recorded it, so without this a CSR would rank on the *producer*
           * leaderboard the moment they moved a client to a cheaper package —
           * and every transfer would inflate `attainmentPct`, which moves
           * everyone's rank, not just theirs.
           *
           * Spelled out here rather than inherited: this service deliberately
           * does not use `buildScopeFilter` (see the docblock above), so it gets
           * no exclusion for free.
           */
          ...NEW_BUSINESS_MATCH,
          soldDateYmd: { $gte: startYmd, $lt: endYmd },
        },
      },
      {
        // One pass, two rollups. This is the case `$facet` is actually for:
        // the office total is not derivable from a truncated per-producer list.
        $facet: {
          byProducer: [
            {
              $group: {
                _id: '$producerId',
                premium: { $sum: { $ifNull: ['$premium', 0] } },
              },
            },
          ],
          office: [
            {
              $group: {
                _id: null,
                premium: { $sum: { $ifNull: ['$premium', 0] } },
              },
            },
          ],
        },
      },
    ];
  }

  /**
   * Display names, resolved by id.
   *
   * Legacy grouped by display *name*, which silently merged two producers who
   * shared one and split anybody who was renamed mid-month. Grouping happens on
   * the id; the name is only ever presentation.
   */
  private async namesFor(producerIds: string[]): Promise<Map<string, string>> {
    if (producerIds.length === 0) return new Map();

    const users = await this.userModel
      .find(
        { _id: { $in: producerIds.map((id) => new Types.ObjectId(id)) } },
        { firstName: 1, lastName: 1, email: 1 },
      )
      .lean<UserLean[]>();

    return new Map(
      users.map((user) => {
        const name = [user.firstName, user.lastName]
          .filter(Boolean)
          .join(' ')
          .trim();
        // Falls back to the email handle rather than a raw ObjectId, which
        // would be meaningless on a leaderboard row.
        return [user._id.toString(), name || user.email.split('@')[0]];
      }),
    );
  }
}
