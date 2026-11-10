import type {
  PremiumLineView,
  StatementChargebackView,
  StatementTotalsView,
} from '@sfa/shared';
import { Types } from 'mongoose';
import type { StatementForPdf } from '../statement-pdf-model';

/**
 * Statements for the PDF unit specs (PAC-181). Synthetic names only. The
 * carriers are the agency's appointments from the layout screenshots, so a
 * "typical month" lists all nine, most of them at zero.
 */

export const APPOINTED = [
  'Allstate',
  'American Modern',
  'National General',
  'Tapco',
  'US Assure',
  'Hagerty',
  'Next Insurance',
  'Aon Edge Flood',
  'Griffin',
];

function premiumLine(
  carrier: string,
  gross: number,
  overrides: Partial<PremiumLineView> = {},
): PremiumLineView {
  const ratePercent = carrier === 'Allstate' ? 10 : 5;
  const grossCommission = Math.round(gross * ratePercent) / 100;
  return {
    carrier,
    leadSourceId: null,
    leadSourceName: null,
    appointed: true,
    grossPremium: gross,
    chargebacks: 0,
    netPremium: gross,
    ratePercent,
    rateSource: carrier === 'Allstate' ? 'carrier' : 'any',
    grossCommission,
    netCommission: grossCommission,
    bundleRate: gross > 0 ? 75 : null,
    minBundleRatePercent: null,
    bundleShortfall: false,
    rateStep: null,
    ...overrides,
  };
}

export function chargebackRow(
  index: number,
  overrides: Partial<StatementChargebackView> = {},
): StatementChargebackView {
  return {
    chargebackId: new Types.ObjectId().toHexString(),
    policyId: null,
    policyNumber: `9002000${String(index).padStart(2, '0')}`,
    policyType: index % 2 ? 'Auto' : 'Home',
    carrier: 'Allstate',
    customerName: `Customer ${index}`,
    amount: 400,
    occurredAt: '2026-10-12T17:00:00.000Z',
    occurredDay: '2026-10-12',
    reason: 'carrier_statement',
    source: 'carrier_statement',
    leadSourceId: null,
    ratePercent: 10,
    excluded: false,
    excludedNote: null,
    ...overrides,
  };
}

/**
 * Calculated before the 2026 comp plans — and so before commission moved to
 * net premium (10 Nov 2026): commission on sold premium, the chargebacks'
 * commission deducted as `chargebackImpact`.
 */
const LEGACY_TOTALS: StatementTotalsView = {
  grossPremium: 52000,
  chargebackTotal: 2000,
  netPremium: 50000,
  grossCommission: 5100,
  chargebackImpact: 200,
  tierBonus: 500,
  teamBonus: 711.11,
  somBonus: 200,
  hatTrickBonus: 100,
  spiffs: 0,
  complianceAdjustment: 0,
  otherAdjustments: 0,
  netCommission: 6411.11,
};

function withoutImpact(totals: StatementTotalsView): StatementTotalsView {
  const rest = { ...totals };
  delete rest.chargebackImpact;
  return rest;
}

/**
 * A statement as stored; `legacy` = computed before the 2026 comp plans
 * (and before commission moved to net premium). Otherwise it is today's
 * shape: commission on net premium, no `chargebackImpact`.
 */
export function storedStatement(
  options: {
    chargebacks?: number;
    legacy?: boolean;
    totals?: Partial<StatementTotalsView>;
    premiumLines?: PremiumLineView[];
    chargebackRows?: StatementChargebackView[];
  } = {},
): StatementForPdf {
  const count = options.chargebacks ?? 5;
  const totals: StatementTotalsView = options.legacy
    ? { ...LEGACY_TOTALS, ...options.totals }
    : {
        ...withoutImpact(LEGACY_TOTALS),
        // The rate on net premium: 5,100 − 200 (net commission unchanged).
        grossCommission: 4900,
        basePay: 2500,
        stipend: 0,
        rateStepBonus: 0,
        overrideCommission: 0,
        agencyBonus: 0,
        producerOfYearBonus: 0,
        complianceReduction: 0,
        referralAdjustment: 0,
        netPay: 8911.11,
        ...options.totals,
      };
  const lines =
    options.premiumLines ??
    APPOINTED.map((carrier, index) =>
      index === 0
        ? premiumLine(carrier, 47000, {
            chargebacks: 2000,
            netPremium: 45000,
            ...(options.legacy
              ? { grossCommission: 4700, chargebackImpact: 200 }
              : { grossCommission: 4500 }),
            netCommission: 4500,
            rateStep: options.legacy ? undefined : 2,
            ratePercent: 10,
          })
        : index === 1
          ? premiumLine(carrier, 5000)
          : premiumLine(carrier, 0),
    );
  return {
    _id: new Types.ObjectId('6ae1bceaa8d09054f813c0bb'),
    agencyId: '6ae1bceaa8d09054f813c001',
    branchId: '6ae1bceaa8d09054f813c002',
    branchName: 'Main',
    runId: new Types.ObjectId(),
    month: '2026-10',
    userId: new Types.ObjectId(),
    userName: 'Pat Producer',
    allstateBindId: 'SOKDEMOP',
    roleNames: ['Producer'],
    roleSlugs: ['producer'],
    pool: 'producer',
    structureId: new Types.ObjectId(),
    structureSnapshot: {
      id: 'structure',
      name: 'Inside Sales',
      rules: [],
      leadSourceRules: [],
      hatTrick: { enabled: true, dealsPerDay: 3, bonusAmount: 50 },
      individualTiers: [],
      tiersStackable: false,
      teamBonusEligible: true,
    },
    status: 'draft',
    version: 1,
    timeZone: 'America/Chicago',
    premiumLines: lines,
    deals: [],
    chargebacks: (
      options.chargebackRows ??
      Array.from({ length: count }, (_, i) => chargebackRow(i + 1))
    ).map((row) =>
      // A legacy row carried the commission it cost, deducted on its own.
      options.legacy
        ? {
            ...row,
            commissionDeduction:
              row.commissionDeduction ?? (row.amount * row.ratePercent) / 100,
          }
        : row,
    ),
    bonuses: {
      hatTrick: {
        enabled: true,
        dealsPerDay: 3,
        bonusAmount: 50,
        days: ['2026-10-03', '2026-10-17'],
        amount: 100,
      },
      individual: { stackable: false, reached: [], amount: 500 },
      team: {
        eligible: true,
        met: true,
        poolAmount: 3000,
        pool: 'producer',
        groupPool: 2400,
        groupPremium: 175000,
        amount: 711.11,
      },
      salespersonOfMonth: { enabled: true, winner: true, amount: 200 },
    },
    indicators: {
      tier: { level: 2, thresholdPremium: 50000 },
      bundleRate: 72.5,
      hatTricks: 2,
      somStatus: 'winner',
      complianceStatus: 'compliant',
      failedAudits: 0,
      compliancePercent: options.legacy ? undefined : 97,
    },
    adjustments: [],
    inputs: null,
    inputsNeeded: null,
    totals,
    warnings: [],
    computedAt: new Date('2026-11-01T06:00:00.000Z'),
    pdf: null,
    sentAt: null,
    sentBy: null,
    sentByName: null,
    history: [],
    createdBy: null,
    updatedBy: null,
  };
}
