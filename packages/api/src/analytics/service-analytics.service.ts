import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  type AccessContext,
  DataScope,
  normalizePolicyType,
  SERVICE_TICKET_ACTIVE_STATUSES,
  SERVICE_TICKET_STATUS_LABELS,
  type ServiceBreakdownResponse,
  type ServiceBreakdownRow,
  type ServiceGroupBy,
  type ServiceSummary,
  type ServiceTicketStatus,
  type ServiceTimeseriesResponse,
} from '@sfa/shared';
import { FilterQuery, Model, PipelineStage, Types } from 'mongoose';
import { resolvePeriod } from '../common/sales-metrics/sales-matches';
import { policyTypeValues } from '../common/sales-metrics/sales-pipelines';
import {
  ServiceTicket,
  ServiceTicketDocument,
} from '../crm/schemas/service-ticket.schema';
import { buildTicketScopeFilter } from '../crm/ticket-scope';
import { toTrend } from '../owner-dashboard/owner-dashboard.normalize';
import {
  fromYmd,
  type YmdRange,
  zonedDayStart,
} from '../performance/performance.range';
import {
  AnalyticsLabelsService,
  type LabelKind,
  UNKNOWN_LABEL,
} from './analytics-labels.service';
import {
  byMeasure,
  changeOf,
  mapKey,
  type RawService,
  sharePct,
  toServiceMetrics,
} from './analytics.normalize';
import type {
  ServiceBreakdownQuery,
  ServiceSummaryQuery,
  ServiceTimeseriesQuery,
} from './dto/analytics-query.dto';
import { keyText } from './key-text';
import { bucketsBetween, instantBucketExpr } from './time-buckets';

/** How each service dimension groups and names its keys. */
interface ServiceDimension {
  key: unknown;
  labels: LabelKind;
  nullLabel: string;
  /** Normalise a raw key into the row key; `null` is the empty bucket. */
  normalize: (raw: unknown) => { key: string | null; label: string | null };
}

const idKey = (raw: unknown) => ({ key: keyText(raw), label: null });

/** A self-describing key: its text is its label. */
const selfKey = (raw: unknown, label: (text: string) => string) => {
  const text = keyText(raw);
  return text === null
    ? { key: null, label: null }
    : { key: text, label: label(text) };
};

const titleCase = (value: string) =>
  value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, ' ');

const SERVICE_DIMENSIONS: Record<ServiceGroupBy, ServiceDimension> = {
  category: {
    key: { $ifNull: ['$category', null] },
    labels: 'self',
    nullLabel: 'Uncategorised',
    normalize: (raw) => selfKey(raw, (text) => text),
  },
  policyType: {
    key: { $ifNull: ['$policyType', null] },
    labels: 'self',
    nullLabel: 'Unspecified',
    normalize: (raw) => {
      const label = normalizePolicyType(keyText(raw) ?? '');
      return label ? { key: label, label } : idKey(null);
    },
  },
  status: {
    key: { $ifNull: ['$status', null] },
    labels: 'self',
    nullLabel: 'Unknown',
    normalize: (raw) =>
      selfKey(
        raw,
        (text) =>
          SERVICE_TICKET_STATUS_LABELS[text as ServiceTicketStatus] ??
          titleCase(text),
      ),
  },
  priority: {
    key: { $ifNull: ['$priority', null] },
    labels: 'self',
    nullLabel: 'No priority',
    normalize: (raw) => selfKey(raw, titleCase),
  },
  assignee: {
    key: { $ifNull: ['$assignedUserId', null] },
    labels: 'user',
    nullLabel: 'Unassigned',
    normalize: idKey,
  },
  branch: {
    key: { $ifNull: ['$branchId', null] },
    labels: 'branch',
    nullLabel: 'No branch',
    normalize: idKey,
  },
};

const ACTIVE = [...SERVICE_TICKET_ACTIVE_STATUSES];
const HAS_RESOLVED_AT = { $ne: [{ $ifNull: ['$resolvedAt', null] }, null] };
const HOURS_TO_RESOLVE = {
  $divide: [{ $subtract: ['$resolvedAt', '$openedAt'] }, 3_600_000],
};

/** Per-group service metrics over tickets opened in the window. */
const SERVICE_GROUP_METRICS = {
  opened: { $sum: 1 },
  resolved: { $sum: { $cond: [HAS_RESOLVED_AT, 1, 0] } },
  stillOpen: { $sum: { $cond: [{ $in: ['$status', ACTIVE] }, 1, 0] } },
  overdue: { $sum: { $cond: [{ $eq: ['$status', 'overdue'] }, 1, 0] } },
  hoursSum: { $sum: { $cond: [HAS_RESOLVED_AT, HOURS_TO_RESOLVE, 0] } },
};

interface Window {
  from: Date;
  to: Date;
}

/**
 * Service analytics (PAC-152, part 2) — the AgencyZoom "Service Center" view:
 * tickets opened and resolved, by category, line, status, priority, assignee
 * or branch, and over time.
 *
 * ## Scope is the CRM's, not the sales clamp
 *
 * `buildTicketScopeFilter` is the rule every ticket reader uses: `own`
 * collapses to the caller's **branch**, because a ticket belongs to the
 * office's service desk rather than to the person who happens to hold it. A
 * producer granted this page therefore sees their own sales and their branch's
 * tickets — the same as they would on the service pages.
 *
 * ## Resolved means `resolvedAt`
 *
 * A ticket is resolved in a window when its `resolvedAt` falls in it. A
 * `closed` ticket has no timestamp (only `resolved` sets one), so it is never
 * counted as resolved — it is not open work either.
 */
@Injectable()
export class ServiceAnalyticsService {
  constructor(
    @InjectModel(ServiceTicket.name)
    private readonly ticketModel: Model<ServiceTicketDocument>,
    private readonly labels: AnalyticsLabelsService,
  ) {}

  async summary(
    access: AccessContext,
    query: ServiceSummaryQuery,
  ): Promise<ServiceSummary> {
    const { period, current, previous } = resolvePeriod(query, access.timeZone);
    const scope = this.scope(access, query);
    const now = this.window(current, access.timeZone);
    const before = this.window(previous, access.timeZone);

    const counts = (window: Window) => ({
      opened: [
        { $match: { openedAt: { $gte: window.from, $lt: window.to } } },
        { $count: 'n' },
      ],
      resolved: [
        { $match: { resolvedAt: { $gte: window.from, $lt: window.to } } },
        {
          $group: {
            _id: null,
            n: { $sum: 1 },
            hoursSum: { $sum: HOURS_TO_RESOLVE },
          },
        },
      ],
    });

    const [row] = await this.ticketModel.aggregate<{
      opened: { n: number }[];
      resolved: { n: number; hoursSum: number }[];
      priorOpened: { n: number }[];
      priorResolved: { n: number; hoursSum: number }[];
      byStatus: { _id: string; count: number }[];
    }>([
      { $match: scope },
      {
        $facet: {
          ...counts(now),
          priorOpened: counts(before).opened,
          priorResolved: counts(before).resolved,
          byStatus: [
            { $match: { status: { $in: ACTIVE } } },
            { $group: { _id: '$status', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
          ],
        },
      },
    ] as PipelineStage[]);

    const opened = row?.opened[0]?.n ?? 0;
    const resolved = row?.resolved[0]?.n ?? 0;
    const priorOpened = row?.priorOpened[0]?.n ?? 0;
    const priorResolved = row?.priorResolved[0]?.n ?? 0;
    const avg = (n: number, hours: number | undefined) =>
      n > 0 ? Math.round(((hours ?? 0) / n) * 10) / 10 : null;
    const hasPrior = priorOpened + priorResolved > 0;
    const byStatus = row?.byStatus ?? [];

    return {
      period,
      opened: toTrend(opened, priorOpened, hasPrior),
      resolved: toTrend(resolved, priorResolved, hasPrior),
      avgHoursToResolve: toTrend(
        avg(resolved, row?.resolved[0]?.hoursSum),
        avg(priorResolved, row?.priorResolved[0]?.hoursSum),
        hasPrior,
      ),
      openNow: byStatus.reduce((sum, entry) => sum + entry.count, 0),
      overdueNow: byStatus.find((entry) => entry._id === 'overdue')?.count ?? 0,
      byStatusNow: byStatus.map((entry) => ({
        status: entry._id,
        count: entry.count,
      })),
    };
  }

  async breakdown(
    access: AccessContext,
    query: ServiceBreakdownQuery,
  ): Promise<ServiceBreakdownResponse> {
    const { period, current, previous } = resolvePeriod(query, access.timeZone);
    const dimension = SERVICE_DIMENSIONS[query.groupBy];

    const [now, before] = await Promise.all([
      this.breakdownWindow(access, query, current, dimension),
      query.compare
        ? this.breakdownWindow(access, query, previous, dimension)
        : null,
    ]);

    const keys = new Map<
      string,
      { key: string | null; label: string | null }
    >();
    for (const [id, bucket] of [...now.rows, ...(before?.rows ?? [])]) {
      if (!keys.has(id)) keys.set(id, bucket);
    }
    const names = await this.labels.labels(
      access.agencyId!,
      dimension.labels,
      [...keys.values()]
        .map((entry) => entry.key)
        .filter((key): key is string => key !== null),
    );

    const totals = toServiceMetrics(now.total);
    const previousTotals = before ? toServiceMetrics(before.total) : null;
    const hasPrior = (before?.total?.opened ?? 0) > 0;

    const rows: ServiceBreakdownRow[] = [...keys].map(([id, entry]) => {
      const metrics = toServiceMetrics(now.rows.get(id)?.raw);
      const prior = before ? toServiceMetrics(before.rows.get(id)?.raw) : null;
      return {
        key: entry.key,
        label:
          entry.key === null
            ? dimension.nullLabel
            : (entry.label ??
              names.get(entry.key) ??
              UNKNOWN_LABEL[dimension.labels]),
        metrics,
        share: sharePct(metrics.opened, totals.opened),
        previous: prior,
        change: prior ? changeOf(metrics, prior, hasPrior) : null,
      };
    });
    rows.sort(byMeasure((row) => row.metrics.opened));

    return {
      period,
      groupBy: query.groupBy,
      rows,
      totals,
      previousTotals,
    };
  }

  async timeseries(
    access: AccessContext,
    query: ServiceTimeseriesQuery,
  ): Promise<ServiceTimeseriesResponse> {
    const { period, current } = resolvePeriod(query, access.timeZone);
    const window = this.window(current, access.timeZone);
    const tz = access.timeZone;

    const [row] = await this.ticketModel.aggregate<{
      opened: { _id: string; n: number }[];
      resolved: { _id: string; n: number }[];
    }>([
      { $match: this.scope(access, query) },
      {
        $facet: {
          opened: [
            { $match: { openedAt: { $gte: window.from, $lt: window.to } } },
            {
              $group: {
                _id: instantBucketExpr('openedAt', query.interval, tz),
                n: { $sum: 1 },
              },
            },
          ],
          resolved: [
            { $match: { resolvedAt: { $gte: window.from, $lt: window.to } } },
            {
              $group: {
                _id: instantBucketExpr('resolvedAt', query.interval, tz),
                n: { $sum: 1 },
              },
            },
          ],
        },
      },
    ] as PipelineStage[]);

    const opened = new Map((row?.opened ?? []).map((r) => [r._id, r.n]));
    const resolved = new Map((row?.resolved ?? []).map((r) => [r._id, r.n]));

    return {
      period,
      interval: query.interval,
      buckets: bucketsBetween(current, query.interval).map((bucket) => ({
        ...bucket,
        opened: opened.get(bucket.key) ?? 0,
        resolved: resolved.get(bucket.key) ?? 0,
      })),
    };
  }

  // ---------------------------------------------------------------------------

  private async breakdownWindow(
    access: AccessContext,
    query: ServiceBreakdownQuery,
    range: YmdRange,
    dimension: ServiceDimension,
  ): Promise<{
    rows: Map<
      string,
      { key: string | null; label: string | null; raw: RawService }
    >;
    total: RawService | undefined;
  }> {
    const window = this.window(range, access.timeZone);
    const [row] = await this.ticketModel.aggregate<{
      rows: RawService[];
      total: RawService[];
    }>([
      {
        $match: {
          ...this.scope(access, query),
          openedAt: { $gte: window.from, $lt: window.to },
        },
      },
      {
        $facet: {
          rows: [{ $group: { _id: dimension.key, ...SERVICE_GROUP_METRICS } }],
          total: [{ $group: { _id: null, ...SERVICE_GROUP_METRICS } }],
        },
      },
    ] as PipelineStage[]);

    // Merge buckets that normalise to one key (`Auto` / `PYgez`).
    const rows = new Map<
      string,
      { key: string | null; label: string | null; raw: RawService }
    >();
    for (const raw of row?.rows ?? []) {
      const { key, label } = dimension.normalize(raw._id);
      const id = mapKey(key);
      const existing = rows.get(id);
      if (existing) {
        existing.raw.opened += raw.opened;
        existing.raw.resolved += raw.resolved;
        existing.raw.stillOpen += raw.stillOpen;
        existing.raw.overdue += raw.overdue;
        existing.raw.hoursSum += raw.hoursSum;
      } else {
        rows.set(id, { key, label, raw: { ...raw } });
      }
    }
    return { rows, total: row?.total[0] };
  }

  /**
   * Tenancy + the CRM scope rule + the filters. Every value here is an
   * **ObjectId**: `serviceTickets` stores tenancy that way, unlike every
   * TenantRecord collection, and a string would match nothing.
   */
  private scope(
    access: AccessContext,
    query: ServiceSummaryQuery,
  ): FilterQuery<ServiceTicketDocument> {
    const filter = {
      ...buildTicketScopeFilter<ServiceTicketDocument>(access),
      isTestRecord: { $ne: true },
    } as Record<string, unknown>;

    if (access.dataScope === DataScope.Agency && query.branchId) {
      filter.branchId = new Types.ObjectId(query.branchId);
    }
    // Under a scope that already pinned the assignee, the filter is moot.
    if (!('assignedUserId' in filter) && query.assigneeIds?.length) {
      filter.assignedUserId = {
        $in: query.assigneeIds.map((id) => new Types.ObjectId(id)),
      };
    }
    const lob = policyTypeValues(query.policyTypes);
    if (lob) filter.policyType = { $in: lob };
    return filter;
  }

  /** A calendar window on the agency's clock, as two instants. */
  private window(range: YmdRange, timeZone: string): Window {
    return {
      from: zonedDayStart(fromYmd(range.startYmd), timeZone),
      to: zonedDayStart(fromYmd(range.endYmd), timeZone),
    };
  }
}
