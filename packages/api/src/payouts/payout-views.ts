import {
  EMPTY_STATEMENT_INPUTS,
  statementInputsNeeded,
  structurePlanDefaults,
  type PayoutRunView,
  type PayStatementStatus,
  type PayStatementSummary,
  type PayStatementPdfView,
  type PayStatementView,
  type StatementAcceptanceView,
  type StatementAdjustmentView,
  type StatementHistoryEntryView,
  type StatementRejectionView,
} from '@sfa/shared';
import type { Types } from 'mongoose';
import type { PayoutRun } from './schemas/payout-run.schema';
import type {
  PayStatement,
  PayStatementAcceptance,
  PayStatementHistoryEntry,
  PayStatementPdf,
  PayStatementRejection,
} from './schemas/pay-statement.schema';

/**
 * Stored runs and statements → the wire shapes in `@sfa/shared`. Reads are
 * `.lean()`, which fills no schema default, so every optional part is
 * null-guarded.
 */

export type LeanRun = PayoutRun & { _id: Types.ObjectId };
export type LeanStatement = PayStatement & { _id: Types.ObjectId };

export interface RunCounts {
  counts: PayoutRunView['counts'];
  totals: PayoutRunView['totals'];
}

export const EMPTY_RUN_COUNTS: RunCounts = {
  counts: { statements: 0, draft: 0, sent: 0, accepted: 0, rejected: 0 },
  totals: { grossPremium: 0, netCommission: 0, netPay: 0 },
};

/** Per-status counts and totals over a set of statements, from an aggregate. */
export function runCountsFrom(
  rows: readonly {
    _id: PayStatementStatus;
    count: number;
    grossPremium: number;
    netCommission: number;
    netPay?: number;
  }[],
): RunCounts {
  const counts = { ...EMPTY_RUN_COUNTS.counts };
  let gross = 0;
  let net = 0;
  let pay = 0;
  for (const row of rows) {
    counts[row._id] = row.count;
    counts.statements += row.count;
    gross += Math.round(row.grossPremium * 100);
    net += Math.round(row.netCommission * 100);
    pay += Math.round((row.netPay ?? row.netCommission) * 100);
  }
  return {
    counts,
    totals: {
      grossPremium: gross / 100,
      netCommission: net / 100,
      netPay: pay / 100,
    },
  };
}

export function runView(run: LeanRun, scoped: RunCounts): PayoutRunView {
  const team = run.teamBonus;
  const som = run.salespersonOfMonth;
  return {
    id: String(run._id),
    month: run.month,
    status: run.status,
    trigger: run.trigger,
    timeZone: run.timeZone,
    window: {
      from: run.window.from.toISOString(),
      to: run.window.to.toISOString(),
    },
    agencyGrossPremium: run.agencyGrossPremium ?? 0,
    teamBonus: {
      enabled: team?.enabled ?? false,
      stackable: team?.stackable ?? false,
      levels: team?.levels ?? [],
      met: team?.met ?? false,
      poolAmount: team?.poolAmount ?? 0,
      csrSharePercent: team?.csrSharePercent ?? 0,
      producerSharePercent: team?.producerSharePercent ?? 0,
      csrPool: team?.csrPool ?? 0,
      producerPool: team?.producerPool ?? 0,
      csrPremium: team?.csrPremium ?? 0,
      producerPremium: team?.producerPremium ?? 0,
    },
    salespersonOfMonth: {
      enabled: som?.enabled ?? false,
      bonusAmount: som?.bonusAmount ?? 0,
      topGrossPremium: som?.topGrossPremium ?? null,
      winners: som?.winners ?? [],
    },
    producerOfYear: run.producerOfYear
      ? {
          enabled: run.producerOfYear.enabled,
          bonusAmount: run.producerOfYear.bonusAmount,
          topGrossPremium: run.producerOfYear.topGrossPremium ?? null,
          winners: run.producerOfYear.winners ?? [],
        }
      : null,
    counts: scoped.counts,
    totals: scoped.totals,
    warnings: run.warnings ?? [],
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
    error: run.error ?? null,
  };
}

export function statementSummary(doc: LeanStatement): PayStatementSummary {
  return {
    id: String(doc._id),
    runId: String(doc.runId),
    month: doc.month,
    userId: String(doc.userId),
    userName: doc.userName,
    roleNames: doc.roleNames ?? [],
    pool: doc.pool,
    branchId: doc.branchId ?? null,
    branchName: doc.branchName ?? null,
    structureId: String(doc.structureId),
    structureName: doc.structureSnapshot?.name ?? '',
    status: doc.status,
    version: doc.version ?? 1,
    totals: doc.totals,
    warningCount: doc.warnings?.length ?? 0,
    computedAt: doc.computedAt.toISOString(),
    sentAt: doc.sentAt ? doc.sentAt.toISOString() : null,
  };
}

/** The issued file's facts — never its key, which only the API may hold. */
function pdfView(
  pdf: PayStatementPdf | null | undefined,
): PayStatementPdfView | null {
  if (!pdf) return null;
  return {
    sha256: pdf.sha256,
    size: pdf.size,
    renderedAt: pdf.renderedAt.toISOString(),
  };
}

function rejectionView(
  rejection: PayStatementRejection | null | undefined,
): StatementRejectionView | null {
  if (!rejection) return null;
  return {
    rejectedAt: rejection.rejectedAt.toISOString(),
    notes: rejection.notes,
  };
}

function acceptanceView(
  acceptance: PayStatementAcceptance | null | undefined,
): StatementAcceptanceView | null {
  if (!acceptance) return null;
  return {
    acceptedAt: acceptance.acceptedAt.toISOString(),
    typedName: acceptance.typedName,
    accountEmail: acceptance.accountEmail,
    userAgent: acceptance.userAgent ?? '',
  };
}

function senderView(
  id: Types.ObjectId | null | undefined,
  name: string | null | undefined,
): { id: string; name: string } | null {
  return id ? { id: String(id), name: name ?? '' } : null;
}

function historyEntryView(
  entry: PayStatementHistoryEntry,
): StatementHistoryEntryView {
  return {
    version: entry.version,
    outcome: entry.outcome,
    pdf: pdfView(entry.pdf),
    sentAt: entry.sentAt ? entry.sentAt.toISOString() : null,
    sentBy: senderView(entry.sentBy, entry.sentByName),
    at: entry.at.toISOString(),
    rejection: rejectionView(entry.rejection),
  };
}

function adjustmentView(
  row: LeanStatement['adjustments'][number],
): StatementAdjustmentView {
  return {
    id: String(row._id),
    kind: row.kind,
    chargebackId: row.chargebackId ? String(row.chargebackId) : null,
    amount: row.amount ?? null,
    note: row.note ?? '',
    createdBy: row.createdBy ? String(row.createdBy) : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function statementView(doc: LeanStatement): PayStatementView {
  const snapshot = doc.structureSnapshot;
  const plan = structurePlanDefaults(snapshot ?? {});
  return {
    ...statementSummary(doc),
    allstateBindId: doc.allstateBindId ?? null,
    timeZone: doc.timeZone,
    structure: doc.structureSnapshot,
    premiumLines: doc.premiumLines ?? [],
    deals: doc.deals ?? [],
    chargebacks: doc.chargebacks ?? [],
    bonuses: doc.bonuses,
    indicators: doc.indicators,
    adjustments: (doc.adjustments ?? []).map(adjustmentView),
    inputs: { ...EMPTY_STATEMENT_INPUTS, ...(doc.inputs ?? {}) },
    // Stored by the calculation; derived from the snapshot for a statement
    // computed before it was.
    inputsNeeded:
      doc.inputsNeeded ??
      statementInputsNeeded({
        rules: snapshot?.rules ?? [],
        individualTiers: snapshot?.individualTiers ?? [],
        complianceFloor: plan.complianceFloor,
        referralRule: plan.referralRule,
        teamRequirements: plan.teamRequirements,
        teamBonusEligible: snapshot?.teamBonusEligible ?? false,
      }),
    warnings: doc.warnings ?? [],
    // Absent on statements written before PAC-181.
    pdf: pdfView(doc.pdf),
    sentBy: senderView(doc.sentBy, doc.sentByName),
    history: (doc.history ?? []).map(historyEntryView),
    // Absent on statements written before PAC-182.
    acceptance: acceptanceView(doc.acceptance),
    rejection: rejectionView(doc.rejection),
    signedPdf: pdfView(doc.signedPdf),
  };
}
