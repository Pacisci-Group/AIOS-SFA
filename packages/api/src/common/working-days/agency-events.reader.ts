import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  addIsoDays,
  AGENCY_EVENT_MAX_DAYS,
  eventAppliesTo,
  type AgencyEventAudience,
  type AgencyEventEffect,
} from '@sfa/shared';
import { type FilterQuery, Model, Types } from 'mongoose';
import { AgencyEvent } from '../../hr/schemas/agency-event.schema';
import { HomeBranchService } from '../hr/home-branch.service';

/** An `agencyEvents` row as `.lean()` returns it — no defaults applied. */
export interface AgencyEventLean {
  _id: Types.ObjectId;
  agencyId: string;
  name: string;
  description?: string | null;
  firstDay: string;
  lastDay: string;
  startTime?: string | null;
  endTime?: string | null;
  effect?: AgencyEventEffect;
  audience?: {
    kind?: AgencyEventAudience['kind'];
    branchIds?: string[];
    userIds?: Types.ObjectId[];
  };
  deletedAt?: Date | null;
}

/**
 * A stored audience as the shared rules take it: ids as strings, the lists
 * a kind does not use emptied. `.lean()` fills in no defaults, so a row
 * written before a field existed is read as "everyone" — the schema default.
 */
export function audienceOf(
  event: Pick<AgencyEventLean, 'audience'>,
): AgencyEventAudience {
  const kind = event.audience?.kind ?? 'agency';
  return {
    kind,
    branchIds: kind === 'branches' ? (event.audience?.branchIds ?? []) : [],
    userIds:
      kind === 'people'
        ? (event.audience?.userIds ?? []).map((id) => id.toString())
        : [],
  };
}

export function effectOf(
  event: Pick<AgencyEventLean, 'effect'>,
): AgencyEventEffect {
  return event.effect ?? 'none';
}

/**
 * Reads live agency events (PAC-169) for the two things that depend on
 * them: the working-day service (a `day_off` event closes a person's day, a
 * `blackout` one blocks their request) and the HR calendar.
 *
 * In `common/` beside the working-day service because the worker may import
 * that; the events' HTTP surface is `hr/agency-events.*`.
 */
@Injectable()
export class AgencyEventsReader {
  constructor(
    @InjectModel(AgencyEvent.name)
    private readonly events: Model<AgencyEvent>,
    private readonly homeBranches: HomeBranchService,
  ) {}

  /**
   * Live events touching `[from, to]` (inclusive `YYYY-MM-DD`), oldest
   * first. Bounded on `firstDay` — see the schema's index.
   */
  async inRange(
    agencyId: string,
    from: string,
    to: string,
    options: { effects?: readonly AgencyEventEffect[] } = {},
  ): Promise<AgencyEventLean[]> {
    const filter: FilterQuery<AgencyEvent> = {
      agencyId,
      deletedAt: null,
      firstDay: {
        $gte: addIsoDays(from, -(AGENCY_EVENT_MAX_DAYS - 1)),
        $lte: to,
      },
      lastDay: { $gte: from },
    };
    if (options.effects) filter.effect = { $in: [...options.effects] };
    return this.events
      .find(filter)
      .sort({ firstDay: 1, _id: 1 })
      .lean<AgencyEventLean[]>();
  }

  /**
   * The events in a range that are **for this person**. Their home branch is
   * read only when a candidate event names branches — most agencies' events
   * are for everyone, and the request form asks this on every keystroke.
   */
  async forPerson(
    agencyId: string,
    userId: string,
    from: string,
    to: string,
    options: { effects?: readonly AgencyEventEffect[] } = {},
  ): Promise<AgencyEventLean[]> {
    const candidates = await this.inRange(agencyId, from, to, options);
    if (candidates.length === 0) return [];
    const needsBranch = candidates.some(
      (event) => audienceOf(event).kind === 'branches',
    );
    const homeBranchId = needsBranch
      ? await this.homeBranches.homeBranchOf(agencyId, userId)
      : null;
    return candidates.filter((event) =>
      eventAppliesTo(audienceOf(event), { userId, homeBranchId }),
    );
  }
}
