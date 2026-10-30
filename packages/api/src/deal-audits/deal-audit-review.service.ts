import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  DataScope,
  MANAGEMENT_AUDIT_SLA_BUSINESS_DAYS,
  NEW_BUSINESS_MATCH,
  canReviewAudit,
  normalizeCarrier,
  normalizeDealAuditStatus,
  normalizeLeadStatus,
  normalizePolicyNumber,
  normalizePolicyType,
} from '@sfa/shared';
import type {
  AccessContext,
  AuditReviewCounts,
  DealAuditDocumentMeta,
  DealAuditQueueOptionsResponse,
  DealAuditQueueResponse,
  DealAuditQueueRow,
  DealAuditQueueStatus,
  DealAuditReviewLead,
  DealAuditReviewPolicy,
  DealAuditReviewQuoteRecap,
  DealAuditReviewView,
  SetAuditItemVerdictResponse,
} from '@sfa/shared';
import { FilterQuery, Model, PipelineStage, Types } from 'mongoose';
import { buildScopeFilter } from '../common/access/scope-filter';
import { businessDay } from '../common/dates/business-dates';
import {
  agingCutoff,
  businessDaysBetween,
} from '../common/dates/business-days';
import { latestDealAuditLookup } from '../common/deal-audits/latest-audit';
import { displayName, displayNamesFor } from '../common/domain/user-names';
import { escapeRegex } from '../common/mongo/escape-regex';
import { buildSearchFilter, tokenRegex } from '../common/mongo/search-filter';
import { policyTypeValues } from '../common/sales-metrics/sales-pipelines';
import { Contact } from '../contacts/schemas/contact.schema';
import {
  DealAuditItem,
  DealAuditItemDocument,
} from '../deal-audit-items/schemas/deal-audit-item.schema';
import { Deal, DealDocument } from '../deals/schemas/deal.schema';
import { Household } from '../households/schemas/household.schema';
import { LeadSourcesService } from '../lead-sources/lead-sources.service';
import { Lead } from '../leads/schemas/lead.schema';
import {
  instantWindow,
  resolveRange,
  zonedDate,
  zonedDayStart,
} from '../performance/performance.range';
import { Policy } from '../policies/schemas/policy.schema';
import { QuoteRecap } from '../quote-recaps/schemas/quote-recap.schema';
import { StorageService } from '../storage/storage.service';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  USER_CHILD_MATCH_CAP,
  USER_SEARCH_FIELDS,
  idsMatching,
} from '../users/user-search';
import { queueSortStages } from './deal-audit-queue.sort';
import { DealAuditsService } from './deal-audits.service';
import { ListDealAuditQueueDto } from './dto/list-deal-audit-queue.dto';
import { SetItemVerdictDto } from './dto/set-item-verdict.dto';
import { compareReviewItems, reviewGates } from './review-items';
import {
  AuditOwnerRef,
  AuditSentBack,
  DealAudit,
} from './schemas/deal-audit.schema';

/** Verification status a manager's pass leaves on an item it resolves. */
const VERIFIED_UPDATE_STATUS = 'complete';
const VERIFIED_UPDATE_STATUS_LABEL = 'Verified - Complete';

/** The `_audit` fields the queue reads, joined onto each deal. */
interface QueueAudit {
  _id: Types.ObjectId;
  auditStatus?: string;
  itemCount?: number;
  producerOpenCount?: number;
  submittedAt?: Date;
  submittedById?: Types.ObjectId | null;
  sentBack?: AuditSentBack | null;
  auditAssignee?: AuditOwnerRef | null;
}

interface QueueDeal {
  _id: Types.ObjectId;
  clientName?: string;
  householdId?: Types.ObjectId;
  producerId?: Types.ObjectId;
  soldDate?: Date;
  _audit: QueueAudit[];
}

/** Each queue status as a `$match` on the joined audit. */
function queueStatusMatch(
  status: DealAuditQueueStatus,
): Record<string, unknown> | null {
  switch (status) {
    // `$ne` keeps a legacy row with no status, which reads as Not Submitted.
    case 'open':
      return { '_audit.auditStatus': { $ne: 'Pass' } };
    case 'not_submitted':
      return { '_audit.auditStatus': { $in: ['Not Submitted', null] } };
    case 'pending':
      return { '_audit.auditStatus': 'Pending' };
    case 'fail':
      return { '_audit.auditStatus': 'Fail' };
    case 'pass':
      return { '_audit.auditStatus': 'Pass' };
    case 'all':
      return null;
  }
}

/**
 * The queue's bound on `soldDate`, or `null` when there is none: the chosen
 * period (`all` is no window), tightened to the aging cutoff when only aging
 * deals are asked for — the Aging Audits card's predicate, five business days
 * on the agency's calendar (PAC-139).
 */
function queueSoldWindow(
  query: Pick<ListDealAuditQueueDto, 'range' | 'from' | 'to' | 'aging'>,
  timeZone: string,
  now: Date = new Date(),
): { $gte?: Date; $lt?: Date } | null {
  const window: { $gte?: Date; $lt?: Date } =
    query.range === 'all'
      ? {}
      : {
          ...instantWindow(
            resolveRange(query.range, timeZone, query, now),
            timeZone,
          ),
        };

  if (query.aging) {
    const cutoff = zonedDayStart(
      agingCutoff(zonedDate(now, timeZone), MANAGEMENT_AUDIT_SLA_BUSINESS_DAYS),
      timeZone,
    );
    window.$lt = window.$lt && window.$lt < cutoff ? window.$lt : cutoff;
  }

  return window.$gte || window.$lt ? window : null;
}

/**
 * The manager's side of the deal audit (PAC-106): the Deal Audits queue, the
 * Deal Audit page, and the item-by-item ruling.
 *
 * The workflow transitions — submit, review, the send-back loop — stay on
 * `DealAuditsService` with the endpoints PAC-72 already shipped; this service
 * reads around them and writes the one thing they rule on, the verdict.
 *
 * Every route here requires `management:read` beside `deal_audits:*` (the
 * controller's AND-gate): this is the manager's page, not the producer's.
 */
@Injectable()
export class DealAuditReviewService {
  constructor(
    @InjectModel(DealAudit.name)
    private readonly dealAuditModel: Model<DealAudit>,
    @InjectModel(DealAuditItem.name)
    private readonly itemModel: Model<DealAuditItem>,
    @InjectModel(Deal.name) private readonly dealModel: Model<DealDocument>,
    @InjectModel(Policy.name) private readonly policyModel: Model<Policy>,
    @InjectModel(QuoteRecap.name)
    private readonly quoteRecapModel: Model<QuoteRecap>,
    @InjectModel(Lead.name) private readonly leadModel: Model<Lead>,
    @InjectModel(Household.name)
    private readonly householdModel: Model<Household>,
    @InjectModel(Contact.name) private readonly contactModel: Model<Contact>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly audits: DealAuditsService,
    private readonly leadSources: LeadSourcesService,
    private readonly storage: StorageService,
  ) {}

  /**
   * `GET /deal-audits/queue` — one row per **deal**, longest-waiting first.
   *
   * Starts from `deals` (scope + new business — a company transfer is not a
   * sale and has nothing to audit) and joins each deal's newest audit, the
   * same shape as the Manager view's Aging Audits card, so the card's rows and
   * the queue's agree. "Days sitting" is business days since the sold date —
   * the card's clock.
   *
   * Scope: a branch-scoped manager sees their branch, the owner the agency.
   * An `own`-scoped caller (a custom role holding `management:read`) sees the
   * audits they are the **reviewer** of — the audit-side meaning of "mine",
   * not the deals they sold.
   *
   * Search, filters and sort (20 Oct 2026): everything that reads the deal —
   * producers, line, the sold-date window, the aging cutoff, the search —
   * narrows the **first** `$match`, before the audit lookup, so a narrow
   * filter never pays for joining every deal's audit. Only what reads the
   * audit (status, aging's "not approved") follows the lookup.
   */
  async listQueue(
    access: AccessContext,
    branchId: string | null,
    query: ListDealAuditQueueDto,
  ): Promise<DealAuditQueueResponse> {
    const { status, page, pageSize, sort } = query;
    const own = access.dataScope === DataScope.Own;

    const dealMatch: FilterQuery<DealDocument> = {
      ...this.queueScope(access, branchId),
      ...NEW_BUSINESS_MATCH,
      ...(await this.queueDealFilter(access, query)),
    };
    const statusMatch = queueStatusMatch(status);
    const reviewerPin = own
      ? {
          '_audit.auditReviewer.id': {
            $in: [access.userId, ...access.roleIds]
              .filter((id) => Types.ObjectId.isValid(id))
              .map((id) => new Types.ObjectId(id)),
          },
        }
      : null;

    // Producer A–Z ranks deals by a name order resolved here, in Node — names
    // are never stored on the deal.
    const producersByName =
      sort === 'producer' ? await this.producersByName(dealMatch) : [];

    const pipeline: PipelineStage[] = [
      { $match: dealMatch },
      latestDealAuditLookup(
        {},
        {
          _id: 1,
          auditStatus: 1,
          itemCount: 1,
          producerOpenCount: 1,
          submittedAt: 1,
          submittedById: 1,
          sentBack: 1,
          auditAssignee: 1,
          auditReviewer: 1,
        },
      ),
      { $match: { '_audit.0': { $exists: true } } },
      ...(statusMatch ? [{ $match: statusMatch }] : []),
      // An approved audit is never aging, however old the sale — the row's own
      // `aging` flag says the same. Redundant under `open`, decisive under
      // `all`, and an empty page under `pass`, which is the honest answer.
      ...(query.aging
        ? [{ $match: { '_audit.auditStatus': { $ne: 'Pass' } } }]
        : []),
      ...(reviewerPin ? [{ $match: reviewerPin }] : []),
      {
        $facet: {
          total: [{ $count: 'count' }],
          items: [
            ...queueSortStages(sort, producersByName),
            { $skip: (page - 1) * pageSize },
            { $limit: pageSize },
            {
              $project: {
                clientName: 1,
                householdId: 1,
                producerId: 1,
                soldDate: 1,
                _audit: 1,
              },
            },
          ],
        },
      },
    ];

    const [facet] = await this.dealModel.aggregate<{
      total: Array<{ count: number }>;
      items: QueueDeal[];
    }>(pipeline);
    const total = facet?.total[0]?.count ?? 0;
    const deals = facet?.items ?? [];

    const audits = deals.map((deal) => deal._audit[0]);
    const [countsByAudit, names] = await Promise.all([
      this.verdictCounts(
        access.agencyId,
        audits.map((audit) => audit._id),
      ),
      // `displayNamesFor`, not `resolveUserNames`: a user with no name on file
      // reads as their email's local part — the name the search box and the
      // producer filter offer — rather than a blank cell.
      displayNamesFor(
        this.userModel,
        deals.flatMap((deal) => {
          const audit = deal._audit[0];
          const ids: string[] = [];
          if (deal.producerId) ids.push(deal.producerId.toString());
          if (audit.auditAssignee?.type === 'user') {
            ids.push(audit.auditAssignee.id.toString());
          }
          if (audit.sentBack?.byId) ids.push(audit.sentBack.byId.toString());
          return [...new Set(ids)];
        }),
      ),
    ]);

    const today = zonedDate(new Date(), access.timeZone);
    const items: DealAuditQueueRow[] = deals.map((deal) => {
      const audit = deal._audit[0];
      const auditStatus = normalizeDealAuditStatus(audit.auditStatus);
      const businessDaysOpen = deal.soldDate
        ? businessDaysBetween(zonedDate(deal.soldDate, access.timeZone), today)
        : 0;
      const assigneeId =
        audit.auditAssignee?.type === 'user'
          ? audit.auditAssignee.id.toString()
          : null;
      const producerId = deal.producerId?.toString() ?? null;

      return {
        dealAuditId: audit._id.toString(),
        dealId: deal._id.toString(),
        householdId: deal.householdId?.toString() ?? null,
        clientName: deal.clientName?.trim() || 'Unknown client',
        producerId,
        producerName: producerId ? (names.get(producerId) ?? null) : null,
        assigneeId,
        assigneeName: assigneeId ? (names.get(assigneeId) ?? null) : null,
        auditStatus,
        soldDate: deal.soldDate ? deal.soldDate.toISOString() : null,
        businessDaysOpen,
        // An approved audit is finished, however long it took.
        aging:
          auditStatus !== 'Pass' &&
          businessDaysOpen > MANAGEMENT_AUDIT_SLA_BUSINESS_DAYS,
        itemCount: audit.itemCount ?? 0,
        counts: countsByAudit.get(audit._id.toString()) ?? {
          passed: 0,
          failed: 0,
          remaining: audit.itemCount ?? 0,
        },
        producerOpenCount: audit.producerOpenCount ?? 0,
        submittedAt: audit.submittedAt ? audit.submittedAt.toISOString() : null,
        sentBack: this.audits.toSentBackView(audit.sentBack, names),
        canReview:
          canReviewAudit(auditStatus) &&
          audit.submittedById?.toString() !== access.userId,
      };
    });

    return {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      items,
    };
  }

  /**
   * `GET /deal-audits/queue/options` — who the producer filter can offer.
   *
   * The sellers of the new-business deals in the caller's reach, not the
   * holders of the producer role: an owner's own sales and a departed
   * producer's are real rows in this queue, and a role list would leave them
   * unfilterable. A departed seller is marked, as the Analytics page does.
   */
  async queueOptions(
    access: AccessContext,
    branchId: string | null,
  ): Promise<DealAuditQueueOptionsResponse> {
    const ids = await this.producerIdsIn({
      ...this.queueScope(access, branchId),
      ...NEW_BUSINESS_MATCH,
    });
    if (!ids.length) return { producers: [] };

    const users = await this.userModel
      .find(
        { _id: { $in: ids } },
        { firstName: 1, lastName: 1, email: 1, isActive: 1 },
      )
      .lean<
        Array<{
          _id: Types.ObjectId;
          firstName?: string;
          lastName?: string;
          email: string;
          isActive?: boolean;
        }>
      >();

    return {
      producers: users
        .map((user) => ({
          id: user._id.toString(),
          name:
            user.isActive === false
              ? `${displayName(user)} (inactive)`
              : displayName(user),
        }))
        .sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
        ),
    };
  }

  /**
   * The deals the queue may show, before any filter.
   *
   * `own` is hand-built because its "mine" is audit-side — the audits the
   * caller reviews, pinned after the lookup — so the deal side is the agency.
   */
  private queueScope(
    access: AccessContext,
    branchId: string | null,
  ): FilterQuery<DealDocument> {
    return access.dataScope === DataScope.Own
      ? { agencyId: access.agencyId, isTestRecord: { $ne: true } }
      : buildScopeFilter<DealDocument>(access, branchId);
  }

  /**
   * The queue's filters on the deal itself — one object, spread into the first
   * `$match` whatever the scope arm.
   *
   * - **Producers** and **line of business** are the management dashboards'
   *   fields, expanded the same way (`policyTypeValues`), so "Home" here is
   *   "Home" on the Owner and Manager views.
   * - The **sold-date window** and the **aging cutoff** both bound `soldDate`,
   *   so they merge into one clause — the tighter end wins, as on the Aging
   *   Audits card — rather than two spreads, the second overwriting the first.
   * - The **search** carries its own `$or` / `$and`, so it is appended under
   *   `$and`, never spread.
   */
  private async queueDealFilter(
    access: AccessContext,
    query: ListDealAuditQueueDto,
  ): Promise<FilterQuery<DealDocument>> {
    const filter: FilterQuery<DealDocument> = {};

    if (query.producerIds?.length) {
      filter.producerId = {
        $in: query.producerIds.map((id) => new Types.ObjectId(id)),
      };
    }
    const lines = policyTypeValues(query.policyTypes);
    if (lines) filter.policyTypes = { $in: lines };

    const soldDate = queueSoldWindow(query, access.timeZone);
    if (soldDate) filter.soldDate = soldDate;

    const search = await this.queueSearch(access, query.q);
    if (search) filter.$and = [search];

    return filter;
  }

  /**
   * The search box: a client name, a producer name or a policy number —
   * `buildSearchFilter`'s rule, AND across words, OR across what each word
   * may be.
   *
   * - **Producer** is per word: a word matching a user's first name, last
   *   name or email narrows to that user's sales. `users.agencyId` is an
   *   ObjectId where the deal's is a string; the tenancy key stays outside
   *   the `$or`, so the scan covers one agency.
   * - **Policy number** is the whole term, never per word: the tokenizer
   *   splits `AS-1234567` into `as` and `1234567`, neither of which would
   *   match. Anchored on the normalised key, which the partial
   *   `{ agencyId, policyNumberKey }` index serves — the Clients page's rule.
   */
  private queueSearch(
    access: AccessContext,
    q: string | undefined,
  ): Promise<FilterQuery<DealDocument> | null> {
    const agencyId = access.agencyId;
    if (!q || !agencyId) return Promise.resolve(null);

    return buildSearchFilter<DealDocument>(q, {
      fields: ['clientName'],
      tokenBranches: [
        async (token) => {
          const ids = await idsMatching<UserDocument>(this.userModel, {
            agencyId: new Types.ObjectId(agencyId),
            $or: USER_SEARCH_FIELDS.map((field) => ({
              [field]: tokenRegex(token),
            })),
          });
          return ids.length ? { producerId: { $in: ids } } : null;
        },
      ],
      termBranches: [
        async (term) => {
          const key = normalizePolicyNumber(term);
          if (!key) return null;
          const policies = await this.policyModel
            .find({
              agencyId,
              policyNumberKey: new RegExp(`^${escapeRegex(key)}`),
              dealId: { $ne: null },
              isTestRecord: { $ne: true },
            })
            .select({ dealId: 1 })
            .limit(USER_CHILD_MATCH_CAP)
            .lean<Array<{ dealId?: Types.ObjectId }>>();
          const dealIds = new Map<string, Types.ObjectId>();
          for (const policy of policies) {
            if (policy.dealId)
              dealIds.set(String(policy.dealId), policy.dealId);
          }
          return dealIds.size ? { _id: { $in: [...dealIds.values()] } } : null;
        },
      ],
    });
  }

  /**
   * Every producer on a deal the queue matches, in name order — the ranking
   * `sort=producer` sorts by. A handful of ids, so a `distinct` and one names
   * read rather than a `$lookup` on users for every deal. A producer with no
   * user record left is not listed; the rank puts their deals last.
   */
  private async producersByName(
    match: FilterQuery<DealDocument>,
  ): Promise<Types.ObjectId[]> {
    const ids = await this.producerIdsIn(match);
    const names = await displayNamesFor(
      this.userModel,
      ids.map((id) => id.toString()),
    );
    return ids
      .filter((id) => names.has(id.toString()))
      .sort((a, b) =>
        (names.get(a.toString()) ?? '').localeCompare(
          names.get(b.toString()) ?? '',
          undefined,
          { sensitivity: 'base' },
        ),
      );
  }

  /** The distinct sellers of the deals a match finds. */
  private async producerIdsIn(
    match: FilterQuery<DealDocument>,
  ): Promise<Types.ObjectId[]> {
    const ids = (await this.dealModel.distinct('producerId', match)) as Array<
      Types.ObjectId | null | undefined
    >;
    return ids.filter((id): id is Types.ObjectId => !!id);
  }

  /** Passed / failed / unreviewed per audit, for one page of the queue. */
  private async verdictCounts(
    agencyId: string | null,
    auditIds: Types.ObjectId[],
  ): Promise<Map<string, AuditReviewCounts>> {
    const map = new Map<string, AuditReviewCounts>();
    if (!auditIds.length) return map;

    const rows = await this.itemModel.aggregate<{
      _id: Types.ObjectId;
      total: number;
      passed: number;
      failed: number;
    }>([
      { $match: { agencyId, dealAuditId: { $in: auditIds } } },
      {
        $group: {
          _id: '$dealAuditId',
          total: { $sum: 1 },
          passed: {
            $sum: { $cond: [{ $eq: ['$reviewVerdict', 'pass'] }, 1, 0] },
          },
          failed: {
            $sum: { $cond: [{ $eq: ['$reviewVerdict', 'fail'] }, 1, 0] },
          },
        },
      },
    ]);
    for (const row of rows) {
      map.set(row._id.toString(), {
        passed: row.passed,
        failed: row.failed,
        remaining: row.total - row.passed - row.failed,
      });
    }
    return map;
  }

  /**
   * `GET /deal-audits/deals/:dealId/review` — everything the Deal Audit page
   * renders, in one request: the workflow, the deal, the policies it bound
   * (with their new business applications), the quote it came from, the lead,
   * and every checklist item — manager-only ones included.
   *
   * Readable in any status; the page disables its actions unless the audit is
   * `Pending` and the caller may review it (`audit.canReview`).
   */
  async getReviewView(
    access: AccessContext,
    branchId: string | null,
    dealId: string,
  ): Promise<DealAuditReviewView> {
    const audit = await this.audits.loadAuditForDeal(access, branchId, dealId);
    const deal = await this.dealModel
      .findOne({ _id: audit.dealId, agencyId: access.agencyId })
      .lean<Deal & { _id: Types.ObjectId }>();
    if (!deal) {
      throw new NotFoundException('Deal not found.');
    }

    const [workflow, items, policies, household, quoteRecap, lead, names] =
      await Promise.all([
        this.audits.toWorkflowView(audit, access),
        this.audits.loadReviewItems(audit),
        this.policyModel
          .find({
            agencyId: access.agencyId,
            dealId: deal._id,
            isTestRecord: { $ne: true },
          })
          .sort({ effectiveDate: 1, _id: 1 })
          .lean<Array<Policy & { _id: Types.ObjectId }>>(),
        deal.householdId
          ? this.householdModel
              .findOne({ _id: deal.householdId, agencyId: access.agencyId })
              .select('name primaryContactId')
              .lean<{ name?: string; primaryContactId?: Types.ObjectId }>()
          : null,
        this.resolveQuoteRecap(deal, access.timeZone),
        deal.leadId
          ? this.leadModel
              .findOne({ _id: deal.leadId, agencyId: access.agencyId })
              .lean<Lead & { _id: Types.ObjectId }>()
          : null,
        this.audits.resolveUserNames(deal.producerId ? [deal.producerId] : []),
      ]);

    items.sort(compareReviewItems);
    const today = zonedDate(new Date(), access.timeZone);
    const businessDaysOpen = deal.soldDate
      ? businessDaysBetween(zonedDate(deal.soldDate, access.timeZone), today)
      : 0;
    const producerId = deal.producerId?.toString() ?? null;

    return {
      audit: {
        ...workflow,
        ...reviewGates(workflow.canReview, items),
      },
      deal: {
        id: deal._id.toString(),
        clientName:
          deal.clientName?.trim() ||
          household?.name?.trim() ||
          'Unknown client',
        householdId: deal.householdId?.toString() ?? null,
        householdName: household?.name?.trim() || null,
        leadId: deal.leadId?.toString() ?? null,
        soldDate: deal.soldDate ? deal.soldDate.toISOString() : null,
        soldDay: businessDay(deal.soldDate, access.timeZone),
        dealType: deal.dealType ?? 'Other',
        policyTypes: (deal.policyTypes ?? [])
          .map((value) => normalizePolicyType(value))
          .filter(Boolean),
        premium: deal.premium ?? 0,
        producerId,
        producerName: producerId ? (names.get(producerId) ?? null) : null,
        businessDaysOpen,
        aging:
          workflow.auditStatus !== 'Pass' &&
          businessDaysOpen > MANAGEMENT_AUDIT_SLA_BUSINESS_DAYS,
      },
      policies: policies.map((policy) => this.toReviewPolicy(policy)),
      quoteRecap: quoteRecap ? await this.toReviewQuoteRecap(quoteRecap) : null,
      lead: lead
        ? await this.toReviewLead(
            lead,
            lead.primaryContactId ?? household?.primaryContactId,
          )
        : null,
      items,
    };
  }

  /**
   * `PATCH /deal-audits/:itemId/verdict` — the manager rules on one item.
   *
   * Only while the audit is `Pending` (decided 19 Oct 2026) and only by a
   * manager who did not submit it (`assertReviewer`). Idempotent: the same
   * ruling twice changes nothing but its timestamp.
   *
   * A `pass` resolves the item — the manager's verification is the stronger
   * fact, and it is the only way a manager-only item ever closes. A `fail`
   * leaves the producer's claim alone until the audit is sent back, which
   * reopens every failed item at once. Withdrawing a pass does not un-resolve
   * the item; the Approve gate reads verdicts, never `isResolved`.
   */
  async setItemVerdict(
    access: AccessContext,
    branchId: string | null,
    itemId: string,
    dto: SetItemVerdictDto,
  ): Promise<SetAuditItemVerdictResponse> {
    const item = await this.loadItem(access, itemId);
    const audit = await this.audits.loadAuditForDeal(
      access,
      branchId,
      item.dealId!.toString(),
    );
    // An item of an older duplicate audit is not on this audit's page.
    if (!item.dealAuditId?.equals(audit._id)) {
      throw new NotFoundException('Audit item not found.');
    }
    if (!canReviewAudit(audit.auditStatus)) {
      throw new ConflictException(
        'Items can only be reviewed while the audit is awaiting review.',
      );
    }
    this.audits.assertReviewer(access, audit);

    const now = new Date();
    if (dto.verdict === null) {
      item.reviewVerdict = null;
      item.reviewedAt = undefined;
      item.reviewedById = undefined;
    } else if (dto.verdict !== undefined) {
      item.reviewVerdict = dto.verdict;
      item.reviewedAt = now;
      item.reviewedById = new Types.ObjectId(access.userId);
      if (dto.verdict === 'pass' && !item.isResolved) {
        item.isResolved = true;
        item.resolvedAt = item.resolvedAt ?? now;
        item.updateStatus = VERIFIED_UPDATE_STATUS;
        item.updateStatusLabel = VERIFIED_UPDATE_STATUS_LABEL;
      }
    }
    if (dto.note !== undefined) {
      item.reviewNote = dto.note || undefined;
    }
    await item.save();
    await this.audits.syncCountersQuietly(audit);

    const items = await this.audits.loadReviewItems(audit);
    items.sort(compareReviewItems);
    const updated = items.find((entry) => entry.id === item._id.toString());
    if (!updated) {
      throw new NotFoundException('Audit item not found.');
    }

    // The same gates the page read returns, clamped the same way — true here
    // whenever `assertReviewer` let the request through, but decided by one
    // rule so the two responses cannot drift apart.
    return {
      item: updated,
      ...reviewGates(this.audits.canReview(audit, access), items),
    };
  }

  /**
   * `GET /deal-audits/deals/:dealId/quote-recap/document/download` — the
   * uploaded quote document, inline, for the "View quote recap" drawer.
   *
   * Its own route rather than `GET /quote-recaps/:id/document/download`
   * because that one is gated on `quote_recaps:read`, which the Branch Manager
   * template does not hold; reaching the document *through the audit* is the
   * access the manager has.
   */
  async getQuoteRecapDocumentUrl(
    access: AccessContext,
    branchId: string | null,
    dealId: string,
  ): Promise<{
    downloadUrl: string;
    filename: string;
    contentType: string;
    expiresIn: number;
  }> {
    const audit = await this.audits.loadAuditForDeal(access, branchId, dealId);
    const deal = await this.dealModel
      .findOne({ _id: audit.dealId, agencyId: access.agencyId })
      .lean<Deal & { _id: Types.ObjectId }>();
    const recap = deal
      ? await this.resolveQuoteRecap(deal, access.timeZone)
      : null;
    const document = recap?.quoteDocument;
    if (!document) {
      throw new NotFoundException('This sale has no quote document.');
    }

    const downloadUrl = await this.storage.createPresignedDownload(
      document.key,
      {
        disposition: 'inline',
        filename: document.filename,
        contentType: document.contentType,
      },
    );
    return {
      downloadUrl,
      filename: document.filename,
      contentType: document.contentType,
      expiresIn: this.storage.downloadUrlTtlSeconds,
    };
  }

  /** An item of the caller's agency, or 404. Scope is the audit's to decide. */
  private async loadItem(
    access: AccessContext,
    itemId: string,
  ): Promise<DealAuditItemDocument> {
    if (!Types.ObjectId.isValid(itemId)) {
      throw new NotFoundException('Audit item not found.');
    }
    const item = await this.itemModel.findOne({
      _id: new Types.ObjectId(itemId),
      agencyId: access.agencyId,
    });
    if (!item?.dealId) {
      throw new NotFoundException('Audit item not found.');
    }
    return item;
  }

  /**
   * The quote the sale came from — the rule of
   * `common/sales-metrics/quote-conversion.ts`, from the deal's side:
   *
   * 1. the recap the deal names (`quoteRecapId`, written by the Sold form);
   * 2. otherwise the lead's most recent recap on or before the sold day, on
   *    the agency's calendar. Most migrated deals name no recap, so this is
   *    load-bearing. A recap with no quote date cannot be placed and is
   *    accepted as a candidate.
   */
  private async resolveQuoteRecap(
    deal: Pick<Deal, 'quoteRecapId' | 'leadId' | 'soldDate' | 'agencyId'>,
    timeZone: string,
  ): Promise<(QuoteRecap & { _id: Types.ObjectId }) | null> {
    if (deal.quoteRecapId) {
      const named = await this.quoteRecapModel
        .findOne({ _id: deal.quoteRecapId, agencyId: deal.agencyId })
        .lean<QuoteRecap & { _id: Types.ObjectId }>();
      if (named) return named;
    }
    if (!deal.leadId) return null;

    const recaps = await this.quoteRecapModel
      .find({
        agencyId: deal.agencyId,
        leadId: deal.leadId,
        isTestRecord: { $ne: true },
      })
      .sort({ quoteDate: -1, createdAt: -1 })
      .lean<Array<QuoteRecap & { _id: Types.ObjectId }>>();
    const soldDay = businessDay(deal.soldDate, timeZone);
    return (
      recaps.find((recap) => {
        const quoteDay = businessDay(recap.quoteDate, timeZone);
        return !soldDay || !quoteDay || quoteDay <= soldDay;
      }) ?? null
    );
  }

  private toReviewPolicy(
    policy: Policy & { _id: Types.ObjectId },
  ): DealAuditReviewPolicy {
    return {
      id: policy._id.toString(),
      policyNumber: policy.policyNumber ?? null,
      policyType: normalizePolicyType(policy.policyType),
      carrier: normalizeCarrier(policy.carrier) || null,
      premium: policy.premium ?? 0,
      // A calendar date — see `policyDate` in `policies/policy-view.ts`.
      effectiveDate: policy.effectiveDate
        ? policy.effectiveDate.toISOString().slice(0, 10)
        : null,
      newBusinessApplication: documentMeta(policy.newBusinessApplication),
    };
  }

  private async toReviewQuoteRecap(
    recap: QuoteRecap & { _id: Types.ObjectId },
  ): Promise<DealAuditReviewQuoteRecap> {
    const names = await this.audits.resolveUserNames(
      recap.producerId ? [recap.producerId] : [],
    );
    return {
      id: recap._id.toString(),
      quoteDate: recap.quoteDate ? recap.quoteDate.toISOString() : null,
      premium: recap.premium ?? 0,
      itemCount: recap.itemCount ?? 0,
      productsQuoted: (recap.productsQuoted ?? [])
        .map((value) => normalizePolicyType(value))
        .filter(Boolean),
      policies: (recap.policies ?? []).map((row) => ({
        policyType: normalizePolicyType(row.policyType),
        premium: row.premium ?? 0,
        itemCount: row.itemCount ?? 0,
      })),
      notes: recap.notes?.trim() || null,
      producerName: recap.producerId
        ? (names.get(recap.producerId.toString()) ?? null)
        : null,
      document: documentMeta(recap.quoteDocument),
    };
  }

  private async toReviewLead(
    lead: Lead & { _id: Types.ObjectId },
    contactId: Types.ObjectId | undefined,
  ): Promise<DealAuditReviewLead> {
    const [labels, contact, names] = await Promise.all([
      lead.leadSourceId
        ? this.leadSources.labelsFor(lead.agencyId)
        : Promise.resolve(new Map<string, string>()),
      contactId
        ? this.contactModel
            .findOne({ _id: contactId, agencyId: lead.agencyId })
            .select('email phone')
            .lean<{ email?: string; phone?: string }>()
        : null,
      this.audits.resolveUserNames(lead.producerId ? [lead.producerId] : []),
    ]);
    const name = [lead.firstName, lead.lastName]
      .filter(Boolean)
      .join(' ')
      .trim();
    return {
      id: lead._id.toString(),
      name: name || 'Unnamed lead',
      status: lead.status ? normalizeLeadStatus(lead.status) : null,
      temperature: lead.temperature ?? null,
      leadSourceName: lead.leadSourceId
        ? (labels.get(lead.leadSourceId.toString()) ?? null)
        : null,
      createdDate: lead.createdDate ? lead.createdDate.toISOString() : null,
      producerName: lead.producerId
        ? (names.get(lead.producerId.toString()) ?? null)
        : null,
      phone: contact?.phone?.trim() || null,
      email: contact?.email?.trim() || null,
    };
  }
}

/** Document metadata for the wire — never the storage key. */
function documentMeta(
  document:
    | { filename: string; contentType: string; size: number; uploadedAt?: Date }
    | null
    | undefined,
): DealAuditDocumentMeta | null {
  if (!document) return null;
  return {
    filename: document.filename,
    contentType: document.contentType,
    size: document.size,
    uploadedAt: document.uploadedAt
      ? new Date(document.uploadedAt).toISOString()
      : null,
  };
}
