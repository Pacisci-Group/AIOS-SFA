import {
  RECONCILIATION_OUTCOME_KIND_LABELS,
  RECONCILIATION_OUTCOME_STEP_LABELS,
  type ReconciliationAppSide,
  type ReconciliationAssignment,
  type ReconciliationDashSide,
  type ReconciliationOutcome,
  type ReconciliationPrefill,
  type ReconciliationProducerSummary,
  type ReconciliationRowView,
  type ReconciliationRunStatus,
  type ReconciliationRunView,
} from '@sfa/shared';
import type { Model, Types } from 'mongoose';
import type {
  RowAssignment,
  RowOutcome,
} from '../common/carrier-reconciliation/carry-forward';
import { splitDashCustomerName } from '../common/carrier-reconciliation/dash-customer-name';
import type { DashRow } from '../common/carrier-reconciliation/dash-file-reader';
import { dashProductPolicyType } from '../common/carrier-reconciliation/dash-product-map';
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
    row.outcome?.startedById,
    row.outcome?.completedById,
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
    // Nor one stored before outcomes did.
    outcome: row.outcome ? outcomeView(row.outcome, names) : null,
  };
}

export function outcomeView(
  outcome: RowOutcome,
  names: ReadonlyMap<string, string>,
): ReconciliationOutcome {
  const person = (id: string | null) =>
    id ? { id, name: names.get(id) ?? 'Former user' } : null;
  return {
    kind: outcome.kind,
    status: outcome.status,
    step: outcome.step,
    note: outcome.note,
    leadId: outcome.leadId,
    dealId: outcome.dealId,
    policyId: outcome.policyId,
    householdId: outcome.householdId,
    replacementPolicyId: outcome.replacementPolicyId,
    chargebackId: outcome.chargebackId,
    // Absent on outcomes stored before service intakes existed.
    onboardingId: outcome.onboardingId ?? null,
    ticketId: outcome.ticketId ?? null,
    startedBy: person(outcome.startedById),
    startedAt: new Date(outcome.startedAt).toISOString(),
    completedBy: person(outcome.completedById),
    completedAt: outcome.completedAt
      ? new Date(outcome.completedAt).toISOString()
      : null,
  };
}

/**
 * An outcome in one phrase, for the export: `Sold — done`, `Cancel rewrite —
 * writing the replacement`.
 */
export function outcomeLabel(
  outcome: Pick<ReconciliationOutcome, 'kind' | 'status' | 'step'> | null,
): string | null {
  if (!outcome) return null;
  const kind = RECONCILIATION_OUTCOME_KIND_LABELS[outcome.kind];
  if (outcome.status === 'done' || !outcome.step) return `${kind} — done`;
  return `${kind} — ${RECONCILIATION_OUTCOME_STEP_LABELS[outcome.step].toLowerCase()}`;
}

/**
 * The Dash line as the New Lead and Sold forms want it (PAC-173 PR 4), so the
 * assignee confirms what Dash says rather than retyping it. `null` without a
 * Dash line — an app policy Dash does not show has nothing to enter.
 *
 * - **Sold date** is the day Dash says the policy was written, else issued;
 *   the **effective date** the day it was issued, else written.
 * - The lead is dated the sold date: a sale may not predate its lead
 *   (`assertSoldDateAllowed`), so a lead dated today could not carry it.
 * - **Carrier** is the catalog name of the carrier the run was uploaded for —
 *   the one the report is from — which the Sold form's carrier list carries.
 *
 * - **Service intake** (PAC-173 PR 5), only on a row that offers one: the
 *   welcome call's opening note, saying where the policy came from.
 *
 * Tolerant of a `dash` snapshot missing fields (one stored by hand, or by an
 * older reader): anything absent reads as unknown.
 */
export function reconciliationPrefill(
  dash: Partial<DashRow> | null,
  carrierName: string | null,
  { offersServiceIntake = false }: { offersServiceIntake?: boolean } = {},
): ReconciliationPrefill | null {
  if (!dash) return null;
  const soldDate = dash.dateWritten ?? dash.issuedDate ?? null;
  const name = splitDashCustomerName(dash.customerName);
  return {
    lead: name ? { ...name, createdDate: soldDate } : null,
    policy: {
      policyNumber: dash.policyNumber ?? null,
      policyType: dashProductPolicyType(dash.product, dash.productDescription),
      carrier: carrierName,
      premium: dash.writtenPremium ?? null,
      itemCount: Math.max(1, dash.itemCount ?? 1),
      effectiveDate: dash.issuedDate ?? dash.dateWritten ?? null,
      soldDate,
    },
    serviceIntake: offersServiceIntake
      ? { openingNote: serviceIntakeOpeningNote(dash) }
      : null,
  };
}

/**
 * "1-800 policy from Dash — bound by OSCVANJ on 2026-10-15 through 1-800,
 * Standard Auto, written premium $793.08." Whatever Dash left blank is left
 * out. The CSR reads it first on the welcome call, so it says where the client
 * came from before anything else.
 */
export function serviceIntakeOpeningNote(dash: Partial<DashRow>): string {
  const day = dash.dateWritten ?? dash.issuedDate ?? null;
  const bound = [
    dash.bindId ? `bound by ${dash.bindId}` : null,
    day ? `on ${day}` : null,
    dash.channel ? `through ${dash.channel}` : null,
  ]
    .filter(Boolean)
    .join(' ');
  const details = [
    dash.product?.trim() || null,
    dash.writtenPremium != null
      ? `written premium $${dash.writtenPremium.toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`
      : null,
  ].filter(Boolean);
  return `1-800 policy from Dash${bound ? ` — ${bound}` : ''}${
    details.length ? `, ${details.join(', ')}` : ''
  }.`;
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
    // Absent on snapshots stored before 1-800 policies were serviced.
    origin: app.origin ?? null,
  };
}
