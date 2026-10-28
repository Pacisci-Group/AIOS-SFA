import type {
  ReconciliationAppSide,
  ReconciliationAssignment,
  ReconciliationDashSide,
  ReconciliationProducerSummary,
  ReconciliationRowView,
  ReconciliationRunStatus,
  ReconciliationRunView,
} from '@sfa/shared';
import type { Model, Types } from 'mongoose';
import type { RowAssignment } from '../common/carrier-reconciliation/carry-forward';
import type { DashRow } from '../common/carrier-reconciliation/dash-file-reader';
import { displayNamesFor } from '../common/domain/user-names';
import type { UserDocument } from '../users/schemas/user.schema';
import type {
  AppPolicyLite,
  ProducerSummaryRaw,
} from '../common/carrier-reconciliation/reconcile';
import type { ReconciliationRow } from './schemas/reconciliation-row.schema';
import type { ReconciliationRun } from './schemas/reconciliation-run.schema';

/**
 * Stored documents → wire views. Pure: names arrive resolved, so every id a
 * view names is batched into one `displayNamesFor` — {@link resolveRowViews}
 * does that for a page of rows.
 */

/**
 * A run still `processing` this long after it started died with its request
 * (processing happens inside the upload). It reads as failed, and its file
 * hash no longer blocks a retry.
 */
export const STALE_RUN_MINUTES = 10;

export type LeanRun = ReconciliationRun & { _id: Types.ObjectId };
export type LeanRow = ReconciliationRow & { _id: Types.ObjectId };

export function isStale(
  run: Pick<LeanRun, 'status' | 'startedAt'>,
  now = Date.now(),
): boolean {
  return (
    run.status === 'processing' &&
    !!run.startedAt &&
    now - run.startedAt.getTime() > STALE_RUN_MINUTES * 60_000
  );
}

export function toRunView(
  run: LeanRun,
  openReviews: number,
  names: ReadonlyMap<string, string>,
): ReconciliationRunView {
  const stale = isStale(run);
  const status: ReconciliationRunStatus = stale ? 'failed' : run.status;
  const createdBy = run.createdBy ? String(run.createdBy) : null;
  return {
    id: String(run._id),
    status,
    error: stale
      ? 'Processing was interrupted. Upload the report again.'
      : run.error,
    filename: run.file.filename,
    fileMeta: {
      agentNumber: run.fileMeta.agentNumber,
      agentName: run.fileMeta.agentName,
      downloadedBy: run.fileMeta.downloadedBy,
      downloadedAt: run.fileMeta.downloadedAt,
      startDate: run.window?.from ?? run.fileMeta.startDate,
      endDate: run.window?.to ?? run.fileMeta.endDate,
      rowCount: run.fileMeta.rowCount,
    },
    // A run classified before premiums were compared stored neither figure;
    // it has no rows in that tab either, until it is re-checked.
    totals: run.totals
      ? {
          ...run.totals,
          premiumMismatch: run.totals.premiumMismatch ?? 0,
          premiumMismatchDelta: run.totals.premiumMismatchDelta ?? 0,
        }
      : null,
    openReviews,
    supersedesRunId: run.supersedesRunId ? String(run.supersedesRunId) : null,
    supersededByRunId: run.supersededByRunId
      ? String(run.supersededByRunId)
      : null,
    createdAt: (run.createdAt ?? new Date()).toISOString(),
    createdBy: createdBy
      ? { id: createdBy, name: names.get(createdBy) ?? 'Former user' }
      : null,
  };
}

export function toProducerSummary(
  raw: ProducerSummaryRaw,
  names: ReadonlyMap<string, string>,
): ReconciliationProducerSummary {
  let name: string;
  if (raw.userId) name = names.get(raw.userId) ?? raw.dashName ?? 'Former user';
  else if (raw.producerKey.startsWith('bind:')) {
    const bindId = raw.producerKey.slice(5);
    name = raw.dashName ? `${raw.dashName} (${bindId})` : `Bind ID ${bindId}`;
  } else if (raw.producerKey.startsWith('code:')) {
    // A sub-producer line from a run classified before codes were set aside
    // (28 Oct 2026); its Re-check regroups it by Bind ID.
    name = raw.dashName ?? raw.producerKey.slice(5);
  } else name = 'No Bind ID';
  return {
    producerKey: raw.producerKey,
    userId: raw.userId,
    name,
    dashSales: raw.dashSales,
    dashPremium: raw.dashPremium,
    matched: raw.matched,
    missing: raw.missing,
    missingPremium: raw.missingPremium,
    appOnly: raw.appOnly,
    appOnlyPremium: raw.appOnlyPremium,
    mismatches: raw.mismatches,
    captureRate: raw.captureRate,
  };
}

/** Every user id a row view names. */
export function rowUserIds(row: LeanRow): string[] {
  return [
    row.credit?.userId,
    row.app?.producerId,
    row.review?.reviewedById,
    row.assignment?.userId,
    row.assignment?.assignedById,
  ].filter((id): id is string => typeof id === 'string' && id.length === 24);
}

/** A page of rows as views, with every name they mention in one lookup. */
export async function resolveRowViews(
  userModel: Model<UserDocument>,
  rows: readonly LeanRow[],
): Promise<ReconciliationRowView[]> {
  const names = await displayNamesFor(userModel, [
    ...new Set(rows.flatMap(rowUserIds)),
  ]);
  return rows.map((row) => toRowView(row, names));
}

export function toRowView(
  row: LeanRow,
  names: ReadonlyMap<string, string>,
): ReconciliationRowView {
  const reviewer = row.review.reviewedById;
  return {
    id: String(row._id),
    side: row.side,
    match: row.match,
    isSale: row.isSale,
    ignoredReason: row.ignoredReason,
    bindIdStatus: row.bindIdStatus,
    issues: row.issues,
    tabs: row.tabs,
    needsReview: row.needsReview,
    dash: row.dash ? dashView(row.dash) : null,
    app: row.app ? appView(row.app, names) : null,
    credit: {
      name: row.credit.name,
      userId: row.credit.userId,
      userName: row.credit.userId
        ? (names.get(row.credit.userId) ?? null)
        : null,
    },
    suggestions: row.suggestions.map((suggestion) => ({
      kind: suggestion.kind,
      policyId: suggestion.policyId,
      dealId: suggestion.dealId,
      householdId: suggestion.householdId,
      rowId: suggestion.rowId,
      policyNumber: suggestion.policyNumber,
      name: suggestion.name,
      premium: suggestion.premium,
      day: suggestion.day,
      reasons: suggestion.reasons,
    })),
    review: {
      status: row.review.status,
      resolution: row.review.resolution,
      note: row.review.note,
      reviewedBy: reviewer
        ? { id: reviewer, name: names.get(reviewer) ?? 'Former user' }
        : null,
      reviewedAt: row.review.reviewedAt
        ? new Date(row.review.reviewedAt).toISOString()
        : null,
      carriedForward: !!row.review.carriedForwardFromRowId,
    },
    runId: String(row.runId),
    // A row stored before assignment existed has no field at all.
    assignment: row.assignment ? assignmentView(row.assignment, names) : null,
  };
}

function assignmentView(
  assignment: RowAssignment,
  names: ReadonlyMap<string, string>,
): ReconciliationAssignment {
  const by = assignment.assignedById;
  return {
    user: {
      id: assignment.userId,
      name: names.get(assignment.userId) ?? 'Former user',
    },
    assignedBy: by ? { id: by, name: names.get(by) ?? 'Former user' } : null,
    assignedAt: new Date(assignment.assignedAt).toISOString(),
    note: assignment.note,
  };
}

function dashView(dash: DashRow): ReconciliationDashSide {
  return {
    rowNumber: dash.rowNumber,
    agentNumber: dash.agentNumber,
    subProducerCode: dash.subProducerCode,
    subProducerName: dash.subProducerName,
    bindId: dash.bindId,
    bindIdName: dash.bindIdName,
    policyNumber: dash.policyNumber,
    customerName: dash.customerName,
    issuedDate: dash.issuedDate,
    dateWritten: dash.dateWritten,
    product: dash.product,
    productDescription: dash.productDescription,
    lineGroup: dash.lineGroup,
    packageName: dash.packageName,
    transactionType: dash.transactionType,
    dispositionCode: dash.dispositionCode,
    itemCount: dash.itemCount,
    writtenPremium: dash.writtenPremium,
    channel: dash.channel,
    channelIndicator: dash.channelIndicator,
    scenarioName: dash.scenarioName,
  };
}

function appView(
  app: AppPolicyLite,
  names: ReadonlyMap<string, string>,
): ReconciliationAppSide {
  return {
    policyId: app.policyId,
    dealId: app.dealId,
    householdId: app.householdId,
    producerId: app.producerId,
    producerName: app.producerId ? (names.get(app.producerId) ?? null) : null,
    policyNumber: app.policyNumber,
    policyType: app.policyType,
    carrier: app.carrier,
    policyStatus: app.policyStatus,
    soldDay: app.soldDay,
    premium: app.premium,
    items: app.items,
    clientName: app.clientName,
    businessType: app.businessType,
  };
}
