import { Injectable } from '@nestjs/common';
import {
  DataScope,
  normalizeLeadStatus,
  terminalLeadStatusValues,
} from '@sfa/shared';
import type {
  AccessContext,
  UnclaimedLeadListResponse,
  UnclaimedLeadRow,
} from '@sfa/shared';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, PipelineStage, Types } from 'mongoose';
import {
  loadContactDetails,
  type ContactDetails,
} from '../contacts/contact-details';
import { Contact, ContactDocument } from '../contacts/schemas/contact.schema';
import { initialsFrom } from '../common/domain/initials';
import { LeadSourcesService } from '../lead-sources/lead-sources.service';
import { ListUnclaimedLeadsDto } from './dto/list-unclaimed-leads.dto';
import { Lead, LeadDocument } from './schemas/lead.schema';

/** Lean projection of the fields the pool renders, plus its sort key. */
type UnclaimedLeadLean = Pick<
  Lead,
  'firstName' | 'lastName' | 'status' | 'temperature'
> & {
  _id: Types.ObjectId;
  leadSourceId?: Types.ObjectId;
  primaryContactId?: Types.ObjectId;
  /** `createdDate ?? createdAt`, computed in the pipeline — see {@link UnclaimedLeadsService}. */
  arrivedAt?: Date;
};

/**
 * The Unclaimed Agency Leads Pool on the Agency Command Center (PAC-138):
 * every lead in the agency that no producer owns yet, oldest arrival first.
 *
 * ---
 *
 * ## This service intentionally does NOT call `buildScopeFilter`
 *
 * `buildScopeFilter` pins `producerId` to the caller under `DataScope.Own`, and
 * every lead here has **no** `producerId` at all — so a producer would get an
 * empty pool, always. The whole product requirement is that a producer can see
 * work nobody has taken yet, which is a read past their own scope by design.
 *
 * `LeaderboardService` is the precedent and the shape to copy: bypass the
 * producer clamp, then put the safety in the **response contract** rather than
 * the query. Here that means `UnclaimedLeadRow` withholds phone and email from
 * a caller who could not open the lead anyway (`LeadAccessService.loadOwnedLead`
 * 404s an unassigned lead under `own` scope, deliberately). Seeing that a lead
 * exists and being able to work it are separate rights — PAC-59's distinction,
 * applied to the one list that needs it now.
 *
 * Everything else the clamp does still applies, written out below rather than
 * skipped: the agency pin, the test-record exclusion, and the branch pin for a
 * branch-scoped caller. **Only the producer pin is lifted.**
 *
 * ⚠ **Open product question — PAC-59 Q2:** whether pool visibility is agency-
 * wide or branch-wide for an `own`-scoped producer is not decided. This takes
 * the narrower reading available today (a branch-scoped caller stays in their
 * branch) and leaves a producer agency-wide, matching how `DataScope.Own` is
 * defined everywhere else — it constrains by *owner*, never by branch. Widening
 * or narrowing that is a product decision, not a refactor.
 *
 * ## Why an aggregation rather than `find().sort()`
 *
 * The pool's order is arrival time, and that is `createdDate ?? createdAt`, not
 * either one alone. `createdDate` is the source system's date and is what a
 * migrated lead actually arrived on; `createdAt` on those rows is the night the
 * import ran, identical across hundreds of leads. Sorting on `createdAt` would
 * order the migrated half of the pool arbitrarily, and sorting on `createdDate`
 * would put every app-created lead (which has none) ahead of everything, the
 * same way a missing `lastActivityAt` flooded the Hot Leads card.
 *
 * So the fallback is computed in the pipeline and sorted on. That gives up an
 * index for the *sort* — accepted, because the `$match` is still index-served
 * on `{agencyId, producerId, …}` and it reduces to the leads nobody owns, which
 * is a work queue measured in tens. No new index is added for this: the repo's
 * rule is not to add one ahead of a reader that needs it (see the note on
 * `activity.schema.ts`'s indexes), and the selective part of this query is
 * already covered.
 */
@Injectable()
export class UnclaimedLeadsService {
  constructor(
    @InjectModel(Lead.name) private readonly leadModel: Model<LeadDocument>,
    @InjectModel(Contact.name)
    private readonly contactModel: Model<ContactDocument>,
    private readonly leadSources: LeadSourcesService,
  ) {}

  async list(
    access: AccessContext,
    branchId: string | null,
    query: ListUnclaimedLeadsDto,
  ): Promise<UnclaimedLeadListResponse> {
    const filter = this.buildFilter(access, branchId);

    /*
     * `total` counts the whole pool, `items` holds the page the panel draws —
     * the count badge is allowed to say more than the list shows. Two queries
     * rather than a `$facet`, following `PerformanceService`: a facet runs both
     * halves through one cursor and loses the count's index-only plan.
     */
    const [records, total] = await Promise.all([
      this.leadModel.aggregate<UnclaimedLeadLean>(
        this.pipeline(filter, query.limit),
      ),
      this.leadModel.countDocuments(filter),
    ]);

    /*
     * Redacted for a caller who could not open these leads anyway. Skipping the
     * contact lookup entirely for them is not an optimisation to preserve — it
     * is the reason the data never reaches the response shaper, so a future
     * field cannot leak it by accident.
     */
    const mayOpen = access.dataScope !== DataScope.Own;

    const [contacts, sourceLabels] = await Promise.all([
      mayOpen
        ? loadContactDetails(
            this.contactModel,
            records.map((record) => record.primaryContactId),
          )
        : Promise.resolve(new Map<string, ContactDetails>()),
      this.leadSources.labelsFor(access.agencyId),
    ]);

    return {
      items: records.map((record) =>
        this.toRow(record, contacts, sourceLabels),
      ),
      total,
    };
  }

  /**
   * The clamp. See the class note for why this is written out rather than
   * delegated to `buildScopeFilter` — every line here matches what that helper
   * would emit, except the producer pin.
   */
  private buildFilter(
    access: AccessContext,
    branchId: string | null,
  ): FilterQuery<LeadDocument> {
    const filter: FilterQuery<LeadDocument> = {
      agencyId: access.agencyId,
      isTestRecord: { $ne: true },
      /*
       * Unowned. `$in: [null, undefined]` rather than `: null` because intake
       * writes both shapes — `LeadIntakeService.assignProducer` tests for
       * exactly this pair, and matching only one would hide half the pool.
       */
      producerId: { $in: [null, undefined] },
      /*
       * A Sold or Lost lead is not work waiting to be picked up, however long
       * it has sat unowned. Expanded through the raw SmartSuite codes so a
       * migrated lead stored as `jp76g` is caught too.
       */
      status: { $nin: terminalLeadStatusValues() },
    };

    // Conditional on a resolved branch, exactly as `buildScopeFilter` is: an
    // agency-scoped account acting without a branch header must not silently
    // fall through to no narrowing.
    if (access.dataScope === DataScope.Branch && branchId) {
      filter.branchId = branchId;
    }

    return filter;
  }

  /** `$match` → arrival fallback → oldest first → the fields the row renders. */
  private pipeline(
    filter: FilterQuery<LeadDocument>,
    limit: number,
  ): PipelineStage[] {
    return [
      { $match: filter },
      {
        $addFields: { arrivedAt: { $ifNull: ['$createdDate', '$createdAt'] } },
      },
      // `_id` is the tiebreaker so the panel does not reshuffle between the
      // 30-second refreshes the Command Center runs.
      { $sort: { arrivedAt: 1, _id: 1 } },
      { $limit: limit },
      {
        $project: {
          firstName: 1,
          lastName: 1,
          status: 1,
          temperature: 1,
          leadSourceId: 1,
          primaryContactId: 1,
          arrivedAt: 1,
        },
      },
    ];
  }

  private toRow(
    record: UnclaimedLeadLean,
    contacts: Map<string, ContactDetails>,
    sourceLabels: Map<string, string>,
  ): UnclaimedLeadRow {
    const name =
      [record.firstName, record.lastName]
        .filter((part) => Boolean(part?.trim()))
        .join(' ')
        .trim() || 'Unknown Lead';

    const source = LeadSourcesService.toRef(record.leadSourceId, sourceLabels);
    // Empty for a redacted caller, so every contact field below reads `null`.
    const contact = record.primaryContactId
      ? contacts.get(record.primaryContactId.toString())
      : undefined;

    return {
      id: record._id.toString(),
      name,
      initials: initialsFrom(name),
      temperature: record.temperature ?? 'Unknown',
      leadSource: source.label || 'Unknown',
      status: normalizeLeadStatus(record.status),
      phone: contact?.phone ?? null,
      email: contact?.email ?? null,
      primaryContactDeceasedAt: contact?.deceasedAt ?? null,
      arrivedAt: record.arrivedAt?.toISOString() ?? null,
    };
  }
}
