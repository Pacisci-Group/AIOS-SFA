import {
  MANAGEMENT_STALLED_HOURS,
  terminalLeadStatusValues,
} from '@sfa/shared';
import { FilterQuery, PipelineStage, Types } from 'mongoose';
import { HOUSEHOLD_KEY_EXPR } from '../common/sales-metrics/household-key';
import {
  LEAD_CREATED_YMD_EXPR,
  OwnerFilterClauses,
  policyTypeValues,
  sourceMatch,
  sourceStages,
  ymdWindow,
} from '../common/sales-metrics/sales-pipelines';
import type { ServiceTicketDocument } from '../crm/schemas/service-ticket.schema';
import type { YmdRange } from '../performance/performance.range';

/**
 * Stage builders for the Manager view (PAC-139). Pure functions of their
 * inputs, so each filter combination can be unit-tested without a database.
 *
 * Every alert card and its drawer share one *prefix*: the count is
 * `[...prefix, $count]` and the list is `[...prefix, $facet]`, which is what
 * makes "the card's number is always the drawer's row count" a property of
 * the code rather than a promise.
 */

/** The `$match` for a line-of-business selection on a field of stored labels. */
export function lobMatch(
  field: string,
  policyTypes: readonly string[] | undefined,
): PipelineStage[] {
  const values = policyTypeValues(policyTypes);
  return values ? [{ $match: { [field]: { $in: values } } }] : [];
}

/**
 * Stalled leads: no update for more than 48 hours, not finished.
 *
 * "Update" is the lead's own `lastActivityAt` — every edit, assignment and
 * logged activity moves it — never the Mongoose `updatedAt`, which the
 * migration stamped with the import time on every historic lead. A lead with
 * no `lastActivityAt` at all has, by construction, never been touched: `$not
 * $gte` keeps it in, where a bare `$lt` would drop it.
 *
 * Terminal statuses are out: a Sold or Lost lead that nobody touches again is
 * finished, not stalled — and on the real book every one of them is older
 * than 48 hours, so counting them would bury the ones that matter.
 */
export function stalledLeadsPrefix(
  match: Record<string, unknown>,
  filter: OwnerFilterClauses,
  range: YmdRange,
  now: Date,
): PipelineStage[] {
  const cutoff = new Date(now.getTime() - MANAGEMENT_STALLED_HOURS * 3_600_000);
  return [
    {
      $match: {
        ...match,
        status: { $nin: terminalLeadStatusValues() },
        lastActivityAt: { $not: { $gte: cutoff } },
      },
    },
    ...sourceMatch(filter.leadSourceIds, 'leadSourceId'),
    // What the lead asked to have quoted. Empty on every migrated lead, so
    // under a line-of-business filter history drops out — the same honest
    // limit the Owner view's quoted premium has.
    ...lobMatch('policiesOfInterest.policyType', filter.policyTypes),
    { $addFields: { createdYmd: LEAD_CREATED_YMD_EXPR } },
    { $match: ymdWindow('createdYmd', range) },
  ];
}

/**
 * The producer drawer's Active Pipeline: the same leads, without the 48-hour
 * clause — everything the producer is working on, stalled or not.
 */
export function activePipelinePrefix(
  match: Record<string, unknown>,
  filter: OwnerFilterClauses,
  range: YmdRange,
): PipelineStage[] {
  return [
    { $match: { ...match, status: { $nin: terminalLeadStatusValues() } } },
    ...sourceMatch(filter.leadSourceIds, 'leadSourceId'),
    ...lobMatch('policiesOfInterest.policyType', filter.policyTypes),
    { $addFields: { createdYmd: LEAD_CREATED_YMD_EXPR } },
    { $match: ymdWindow('createdYmd', range) },
  ];
}

/** The most recent quote recap per lead, for the pipeline's `value` column. */
export const LATEST_QUOTE_LOOKUP: PipelineStage = {
  $lookup: {
    from: 'quoteRecaps',
    localField: '_id',
    foreignField: 'leadId',
    pipeline: [
      { $match: { isTestRecord: { $ne: true } } },
      { $sort: { quoteDate: -1, createdAt: -1 } },
      { $limit: 1 },
      { $project: { _id: 0, premium: 1 } },
    ],
    as: '_quote',
  },
};

/**
 * Aging audits: deals sold before the business-day cutoff whose audit is not
 * `Pass`. The caller folds the cutoff into `match`'s `soldDateYmd` window, so
 * this stays a plain indexed range on `deals`; the audit is joined afterwards.
 *
 * One row per **deal**: a legacy re-audit can leave two `dealAudits` rows on
 * one deal (the index is deliberately not unique), and the newest is the one
 * whose status counts.
 */
export function agingAuditsPrefix(
  match: Record<string, unknown>,
  filter: OwnerFilterClauses,
): PipelineStage[] {
  return [
    { $match: match },
    ...(filter.leadSourceIds?.length
      ? [...sourceStages(true), ...sourceMatch(filter.leadSourceIds)]
      : []),
    ...lobMatch('policyTypes', filter.policyTypes),
    {
      $lookup: {
        from: 'dealAudits',
        localField: '_id',
        foreignField: 'dealId',
        pipeline: [
          // `$ne: 'Pass'` keeps Not Submitted, Pending and Fail — and a legacy
          // row with no status, which the schema defaults to Not Submitted.
          {
            $match: {
              isTestRecord: { $ne: true },
              auditStatus: { $ne: 'Pass' },
            },
          },
          { $sort: { createdAt: -1 } },
          { $limit: 1 },
          { $project: { _id: 1, auditStatus: 1, openFailedCount: 1 } },
        ],
        as: '_audit',
      },
    },
    { $match: { '_audit.0': { $exists: true } } },
  ];
}

/**
 * Overdue tickets: opened in the window, `status: 'overdue'` right now.
 *
 * Reads the stored column. Overdue is a *materialised* status (PAC-102):
 * `SyncTicketStatusFn` advances a scheduled onboarding or renewal call to
 * `overdue` once its `dueAt` passes, so the column is the single answer every
 * reader shares — this card, the Service dashboard's KPI strip and the ticket
 * queue's paged sort. Do not re-derive it from the step's `dueAt` here: that
 * was how this card first shipped, and it disagreed with the other two by
 * exactly the sweep's five-minute lag. `deriveStepStatus` in
 * `common/scheduling/step-status.ts` is the one definition of the rule.
 *
 * `tenant` is `ticketTenantFilter` (ObjectId tenancy — see there). The person
 * filter lands on `assignedUserId`, the CSR working the ticket: the filter bar
 * lists every active user, so picking a service rep narrows this card the way
 * picking a producer narrows the other two. Under `own` scope the tenant
 * filter has already pinned the assignee, and the multi-select is ignored.
 *
 * A ticket reaches a lead source only through its `leadId`, which most tickets
 * lack — under a source filter those drop out, which is the honest answer.
 */
export function overdueTicketsPrefix(
  tenant: FilterQuery<ServiceTicketDocument>,
  filter: OwnerFilterClauses & { producerIds?: readonly string[] },
  window: { from: Date; to: Date },
): PipelineStage[] {
  const match: Record<string, unknown> = {
    ...tenant,
    openedAt: { $gte: window.from, $lt: window.to },
    status: 'overdue',
  };
  if (!('assignedUserId' in tenant) && filter.producerIds?.length) {
    const ids = filter.producerIds
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
    match.assignedUserId = { $in: ids };
  }
  const lob = policyTypeValues(filter.policyTypes);
  if (lob) match.policyType = { $in: lob };

  return [
    { $match: match },
    ...(filter.leadSourceIds?.length
      ? [...sourceStages(false), ...sourceMatch(filter.leadSourceIds)]
      : []),
  ];
}

/** `[...prefix, count]` — the card. */
export const COUNT_STAGE: PipelineStage = { $count: 'count' };

/** `[...prefix, page]` — the drawer. `total` is the same count as the card. */
export function pagedFacet(
  sort: Record<string, 1 | -1>,
  page: number,
  pageSize: number,
): PipelineStage {
  return {
    $facet: {
      total: [{ $count: 'count' }],
      items: [
        { $sort: sort },
        { $skip: (page - 1) * pageSize },
        { $limit: pageSize },
      ],
    },
  };
}

/**
 * Distinct households per producer over a `linesPrefix` output — the Team
 * Activity table's Households Quoted / Households Sold. `HOUSEHOLD_KEY_EXPR`
 * is the same identity the Owner view and the producer scorecard use, so all
 * three agree on what a household is.
 */
export function householdsByProducer(prefix: PipelineStage[]): PipelineStage[] {
  return [
    ...prefix,
    {
      $group: {
        _id: { $ifNull: ['$producerId', null] },
        households: { $addToSet: HOUSEHOLD_KEY_EXPR },
      },
    },
    { $project: { _id: 1, count: { $size: '$households' } } },
  ];
}

/**
 * Open audit items per producer — the **all-time backlog**, not the period:
 * every audit with something outstanding, attributed through its deal.
 *
 * Starts from `dealAudits` rather than `deals` because the audits with open
 * items are the small side (a few hundred on the real book) and the deal is
 * one primary-key lookup away. `dealScope` is the deals clamp (tenancy, branch
 * and — for the drawer — one producer); the audit's own `agencyId` keeps the
 * first stage on the tenant.
 */
export function openAuditItemsByProducer(
  agencyId: string,
  dealScope: Record<string, unknown>,
): PipelineStage[] {
  return [
    {
      $match: {
        agencyId,
        isTestRecord: { $ne: true },
        openFailedCount: { $gt: 0 },
      },
    },
    {
      $lookup: {
        from: 'deals',
        localField: 'dealId',
        foreignField: '_id',
        pipeline: [{ $match: dealScope }, { $project: { producerId: 1 } }],
        as: '_deal',
      },
    },
    { $unwind: '$_deal' },
    {
      $group: {
        _id: { $ifNull: ['$_deal.producerId', null] },
        openAuditItems: { $sum: '$openFailedCount' },
      },
    },
  ];
}

/** The most open items the producer drawer lists. */
export const MAX_OPEN_AUDIT_ITEMS = 200;

/**
 * One row per outstanding audit item on the producer's deals, oldest first —
 * the items `openAuditItemsByProducer` counts, so the two agree by construction
 * as long as the counters are in step (`syncAuditCounters`).
 */
export function producerOpenAuditItems(
  agencyId: string,
  dealScope: Record<string, unknown>,
): PipelineStage[] {
  return [
    {
      $match: {
        agencyId,
        isFailed: true,
        isResolved: { $ne: true },
        isTestRecord: { $ne: true },
      },
    },
    {
      $lookup: {
        from: 'deals',
        localField: 'dealId',
        foreignField: '_id',
        pipeline: [
          { $match: dealScope },
          { $project: { clientName: 1, householdId: 1, soldDate: 1 } },
        ],
        as: '_deal',
      },
    },
    { $unwind: '$_deal' },
    {
      $addFields: { raisedAt: { $ifNull: ['$firstCreatedAt', '$createdAt'] } },
    },
    { $sort: { raisedAt: 1, _id: 1 } },
    { $limit: MAX_OPEN_AUDIT_ITEMS },
    {
      $project: {
        _id: 1,
        dealAuditId: 1,
        dealId: 1,
        itemName: 1,
        title: 1,
        raisedAt: 1,
        clientName: '$_deal.clientName',
        householdId: '$_deal.householdId',
        soldDate: '$_deal.soldDate',
      },
    },
  ];
}
