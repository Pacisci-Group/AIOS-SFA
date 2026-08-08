import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  normalizeLeadSource,
  normalizeLeadStatus,
  terminalLeadStatusValues,
} from '@sfa/shared';
import type {
  AccessContext,
  ActivityType,
  HotLeadListResponse,
  HotLeadRow,
  LeadTemperature,
  NormalizedLeadSource,
} from '@sfa/shared';
import { FilterQuery, Model, Types } from 'mongoose';
import {
  Activity,
  ActivityDocument,
} from '../activities/schemas/activity.schema';
import { buildScopeFilter } from '../common/access/scope-filter';
import { initialsFrom } from '../common/domain/initials';
import { ListHotLeadsDto } from './dto/list-hot-leads.dto';
import { Lead, LeadDocument } from './schemas/lead.schema';

/** Lean projection of the fields the panel renders. */
type HotLeadLean = Pick<
  Lead,
  'firstName' | 'lastName' | 'emails' | 'phones' | 'status' | 'temperature'
> & {
  _id: Types.ObjectId;
  leadSource?: NormalizedLeadSource;
  lastActivityAt?: Date;
};

/** Latest activity per lead, from the `$group … $first` rollup. */
interface LatestActivity {
  _id: Types.ObjectId;
  summary?: string | null;
  type?: ActivityType;
  occurredAt?: Date;
}

/**
 * Temperatures drawn on, in priority order, when the caller does not say.
 * Hot first, then Warm to top the card up — a producer with two Hot leads
 * should still see a full list rather than a mostly-empty panel.
 */
const DEFAULT_TEMPERATURES: LeadTemperature[] = ['Hot', 'Warm'];

/**
 * Hot Leads / Priority Contact List (PAC-15).
 *
 * A separate service from `LeadsService`, and a separate route from
 * `GET /leads`, for two reasons that are not stylistic:
 *
 *  1. **The sort is inverted.** The Leads page orders `lastActivityAt`
 *     descending — most recently touched first. A priority contact list wants
 *     the opposite: the lead you last spoke to is the one who least needs a
 *     call. It is not the same query with a filter on it.
 *  2. **The narrative line needs an `activities` join** that the 50-row Leads
 *     table would pay for on every keystroke of its search box, and never
 *     render.
 */
@Injectable()
export class HotLeadsService {
  constructor(
    @InjectModel(Lead.name) private leadModel: Model<LeadDocument>,
    @InjectModel(Activity.name)
    private activityModel: Model<ActivityDocument>,
  ) {}

  async list(
    access: AccessContext,
    branchId: string | null,
    query: ListHotLeadsDto,
  ): Promise<HotLeadListResponse> {
    const temperatures = query.temperature?.length
      ? query.temperature
      : DEFAULT_TEMPERATURES;

    const scope = buildScopeFilter<LeadDocument>(access, branchId, {
      requestedScope: query.scope,
    });

    /*
     * One index-served query per temperature, in priority order, stopping as
     * soon as the card is full.
     *
     * Deliberately not a single `$in` over all temperatures: that would need an
     * in-memory sort to keep Hot above Warm, because the index orders by
     * `lastActivityAt` *within* a temperature, not across them. Two bounded
     * queries beat one unbounded sort, and "Hot always outranks Warm" then
     * holds by construction rather than by a comparator someone can break.
     */
    const records: HotLeadLean[] = [];
    for (const temperature of temperatures) {
      if (records.length >= query.limit) break;

      const filter: FilterQuery<LeadDocument> = {
        ...scope,
        temperature,
        // A Sold or Lost lead must not sit on a contact list, however hot it
        // was left. Expanded through the raw SmartSuite codes so migrated
        // documents storing `jp76g` are caught too.
        status: { $nin: terminalLeadStatusValues() },
      };

      const batch = await this.leadModel
        .find(filter)
        // Ascending: stalest first. `_id` is a stable tiebreaker so a card of
        // never-touched leads doesn't reshuffle between refreshes.
        .sort({ lastActivityAt: 1, _id: 1 })
        .limit(query.limit - records.length)
        .lean<HotLeadLean[]>();

      records.push(...batch);
    }

    const summaries = await this.latestActivityByLead(
      access.agencyId,
      records.map((record) => record._id),
    );

    return {
      items: records.map((record) => this.toRow(record, summaries)),
    };
  }

  /**
   * The most recent activity for each of at most `limit` leads.
   *
   * `$sort` then `$group … $first` is the standard latest-per-group idiom, and
   * the sort here is served by `{ agencyId, leadId, occurredAt: -1 }`.
   */
  private async latestActivityByLead(
    agencyId: string | null,
    leadIds: Types.ObjectId[],
  ): Promise<Map<string, LatestActivity>> {
    if (leadIds.length === 0) return new Map();

    const rows = await this.activityModel.aggregate<LatestActivity>([
      { $match: { agencyId, leadId: { $in: leadIds } } },
      // `_id` breaks ties between two activities stamped the same second.
      { $sort: { leadId: 1, occurredAt: -1, _id: -1 } },
      {
        $group: {
          _id: '$leadId',
          summary: { $first: '$summary' },
          type: { $first: '$type' },
          occurredAt: { $first: '$occurredAt' },
        },
      },
    ]);

    return new Map(rows.map((row) => [row._id.toString(), row]));
  }

  private toRow(
    record: HotLeadLean,
    summaries: Map<string, LatestActivity>,
  ): HotLeadRow {
    const id = record._id.toString();
    const name =
      [record.firstName, record.lastName]
        .filter((part) => Boolean(part?.trim()))
        .join(' ')
        .trim() || 'Unknown Lead';

    const source = normalizeLeadSource(
      record.leadSource?.code,
      record.leadSource?.label,
    );
    const latest = summaries.get(id);

    return {
      id,
      name,
      initials: initialsFrom(name),
      temperature: record.temperature ?? 'Unknown',
      leadSource: source.label,
      status: normalizeLeadStatus(record.status),
      phone: record.phones?.[0] ?? null,
      email: record.emails?.[0] ?? null,
      // Null rather than invented copy — the UI falls back to the status.
      lastActivitySummary: latest?.summary ?? null,
      lastActivityType: latest?.type ?? null,
      /*
       * The lead's own `lastActivityAt`, deliberately — **not** the activity
       * row's `occurredAt`.
       *
       * This is the field the list is sorted by, and it is what the row's
       * "2h ago" means: how long since anyone touched this lead. Showing the
       * activity's timestamp instead lets the visible column disagree with the
       * ordering whenever the two drift, which makes a correctly-sorted panel
       * look broken.
       */
      lastActivityAt: record.lastActivityAt?.toISOString() ?? null,
    };
  }
}
