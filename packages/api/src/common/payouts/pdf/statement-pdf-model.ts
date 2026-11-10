import {
  complianceLabel,
  DEFAULT_AGENCY_TIME_ZONE,
  premiumLineLabel,
  somStatusLabel,
  statementNetPay,
  statementReference,
} from '@sfa/shared';
import type { Types } from 'mongoose';
import type { PayStatement } from '../../../payouts/schemas/pay-statement.schema';
import { monthLabel } from '../month-window';
import { day, deduction, money, percent, winAnsi } from './format';

/**
 * The Commission Statement as plain, pre-formatted strings (PAC-181).
 *
 * **The only file that knows the stored statement's shape.** The sections
 * under `sections/` draw these strings and nothing else, so a change to the
 * statement document is a change here, and the drawing code can be tested
 * against a model built by hand.
 *
 * Statements computed before the 2026 comp plans have none of the 2026
 * totals and bonuses; every one of them is null-guarded, and such a
 * statement prints the original grid.
 */

/** What is printed where a value does not exist — as the app's `N/A`. */
export const PDF_NOT_AVAILABLE = 'N/A';

/** The Generated Date box of a draft preview: never mistaken for an issue. */
export const PDF_DRAFT_LABEL = 'Draft · not issued';

export type StatementForPdf = PayStatement & { _id: Types.ObjectId };

export interface StatementPdfLogo {
  bytes: Buffer;
  contentType: 'image/png' | 'image/jpeg';
}

/** Issued (sent) on a date, or a draft preview. */
export type StatementPdfIssue =
  { kind: 'issued'; at: Date } | { kind: 'draft' };

/**
 * What the stored statement does not say. The time zone is not here: the
 * Generated Date is a day in the statement's own zone (the run's, stored on
 * it), as the app's "Sent …" line shows it — not the agency's zone of today.
 */
export interface StatementPdfContext {
  agencyName: string;
  logo: StatementPdfLogo | null;
  issue: StatementPdfIssue;
}

export interface PdfField {
  label: string;
  value: string;
}

export interface PdfCarrierRow {
  carrier: string;
  rate: string;
  soldPremium: string;
  chargebacks: string;
  netCommission: string;
}

/** `tone` colours the value box: credits green, deductions red. */
export interface PdfSummaryLine {
  label: string;
  amount: string;
  tone: 'plain' | 'credit' | 'debit';
}

export interface PdfChargebackRow {
  customer: string;
  policyNumber: string;
  carrier: string;
  policyType: string;
  /**
   * The premium charged back — or, on a statement calculated before
   * 10 Nov 2026, the commission it cost (see `chargebackAmountHeader`).
   */
  deduction: string;
  /** Left out by the manager: struck through, with the note. */
  excluded: boolean;
  note: string | null;
}

export interface StatementPdfModel {
  title: string;
  header: {
    agencyName: string;
    logo: StatementPdfLogo | null;
  };
  details: PdfField[];
  indicators: PdfField[];
  carrierRows: PdfCarrierRow[];
  carrierTotal: PdfCarrierRow;
  /** Under the carrier table: each carrier below its minimum bundle rate. */
  carrierNotes: string[];
  summaryLeft: PdfSummaryLine[];
  summaryRight: PdfSummaryLine[];
  netPay: string;
  chargebackRows: PdfChargebackRow[];
  /** The chargeback table's amount column, and its total box's label. */
  chargebackAmountHeader: string;
  chargebackTotalLabel: string;
  chargebackTotal: string;
  /** Printed in place of an empty chargeback table. */
  chargebackEmpty: string;
  /** Empty until the employee signs (PAC-182). */
  acknowledgment: {
    statement: string;
    typedName: string | null;
    dateSigned: string | null;
    comments: string | null;
  };
  footerLeft: string;
}

export function buildStatementPdfModel(
  statement: StatementForPdf,
  ctx: StatementPdfContext,
): StatementPdfModel {
  const s = statement;
  const t = s.totals;
  const b = s.bonuses;
  const period = monthLabel(s.month);
  const agencyName = winAnsi(ctx.agencyName);
  const belowFloor = b?.compliance?.belowFloor ?? false;

  const details: PdfField[] = [
    { label: 'Producer name', value: winAnsi(s.userName) },
    { label: 'Commission period', value: period },
    {
      label: 'Producer ID',
      value: s.allstateBindId ? winAnsi(s.allstateBindId) : PDF_NOT_AVAILABLE,
    },
    {
      label: 'Statement ID',
      value: statementReference(String(s._id), s.version ?? 1),
    },
    {
      label: 'Generated date',
      value:
        ctx.issue.kind === 'issued'
          ? day(ctx.issue.at, s.timeZone || DEFAULT_AGENCY_TIME_ZONE)
          : PDF_DRAFT_LABEL,
    },
  ];

  const i = s.indicators;
  const compliance = complianceLabel(
    i.complianceStatus,
    i.failedAudits ?? 0,
    belowFloor,
  );
  const entered =
    i.compliancePercent === null || i.compliancePercent === undefined
      ? null
      : percent(i.compliancePercent);
  const indicators: PdfField[] = [
    {
      label: 'Allstate tier',
      value: i.tier
        ? `Tier ${i.tier.level} · ${money(i.tier.thresholdPremium)}`
        : 'None reached',
    },
    {
      label: 'Bundle rate',
      value: i.bundleRate === null ? PDF_NOT_AVAILABLE : percent(i.bundleRate),
    },
    {
      label: 'Hat tricks',
      value: i.hatTricks === null ? PDF_NOT_AVAILABLE : String(i.hatTricks),
    },
    {
      label: 'SOM status',
      value: somStatusLabel(i.somStatus) ?? PDF_NOT_AVAILABLE,
    },
    {
      label: 'Compliance status',
      value: entered ? `${compliance} · ${entered}` : compliance,
    },
  ];

  // Commission is the rate on net premium (10 Nov 2026). A statement
  // calculated before carries `chargebackImpact`: its commission was on
  // sold premium with the chargebacks' commission deducted separately, and
  // it prints that way, so its stored figures still add up.
  const legacyImpact = t.chargebackImpact;
  const lines = s.premiumLines ?? [];
  const carrierRows: PdfCarrierRow[] = lines.map((line) => ({
    carrier: winAnsi(premiumLineLabel(line)),
    rate:
      line.rateSource === 'none'
        ? 'No rate'
        : line.rateStep === null || line.rateStep === undefined
          ? percent(line.ratePercent)
          : `${percent(line.ratePercent)} · step ${line.rateStep}`,
    soldPremium: money(line.grossPremium),
    chargebacks: deduction(line.chargebacks),
    netCommission: money(line.netCommission),
  }));
  const carrierTotal: PdfCarrierRow = {
    carrier: 'Total',
    rate: '',
    soldPremium: money(t.grossPremium),
    chargebacks: deduction(t.chargebackTotal),
    netCommission: money(t.grossCommission - (legacyImpact ?? 0)),
  };
  // One note per carrier: every line of a carrier carries the same flag.
  const carrierNotes: string[] = [];
  const flagged = new Set<string>();
  for (const line of lines) {
    if (!line.bundleShortfall || flagged.has(line.carrier)) continue;
    flagged.add(line.carrier);
    carrierNotes.push(
      winAnsi(
        `${line.carrier} bundle rate ${
          line.bundleRate === null
            ? PDF_NOT_AVAILABLE
            : percent(line.bundleRate)
        } is below the ${percent(line.minBundleRatePercent ?? 0)} minimum.`,
      ),
    );
  }

  const floorPercent = b?.compliance?.floor?.minimumPercent;
  const referral = t.referralAdjustment ?? 0;
  const summaryLeft: PdfSummaryLine[] = compact([
    line(
      legacyImpact === undefined
        ? 'Carrier commission'
        : 'Gross carrier commission',
      t.grossCommission,
      'plain',
    ),
    optional('Rate step bonus', t.rateStepBonus),
    optional('Override commission', t.overrideCommission),
    line('Tier bonus', t.tierBonus),
    optional('Agency premium bonus', t.agencyBonus),
    line('Team bonus', t.teamBonus),
    line('Salesperson of the Month bonus', t.somBonus),
    line('Hat trick bonus', t.hatTrickBonus),
    optional('Producer of the Year bonus', t.producerOfYearBonus),
  ]);
  const summaryRight: PdfSummaryLine[] = compact([
    // Base pay is its own line whenever the statement carries it (6 Nov):
    // even at $0, the reader sees there is none.
    t.basePay === undefined ? null : line('Base pay', t.basePay, 'plain'),
    optional('Stipend', t.stipend),
    line('Other bonuses / SPIFFs', t.spiffs),
    optional(referral < 0 ? 'Referral deduction' : 'Referral bonus', referral),
    // A deduction by nature (≤ 0), tinted as one even at $0, as in the layout.
    line('Compliance adjustment', t.complianceAdjustment, 'debit'),
    optional(
      floorPercent === undefined
        ? 'Compliance reduction'
        : `Compliance reduction (below ${percent(floorPercent)})`,
      t.complianceReduction,
    ),
    // Only a statement calculated before 10 Nov 2026 has this line.
    legacyImpact === undefined
      ? null
      : {
          label: 'Chargeback commission impact',
          amount: deduction(legacyImpact),
          tone: 'debit',
        },
    line(
      'Other adjustments',
      t.otherAdjustments,
      t.otherAdjustments > 0 ? 'credit' : 'debit',
    ),
  ]);

  const chargebackRows: PdfChargebackRow[] = (s.chargebacks ?? []).map(
    (row) => ({
      customer: winAnsi(row.customerName ?? PDF_NOT_AVAILABLE),
      policyNumber: winAnsi(row.policyNumber ?? PDF_NOT_AVAILABLE),
      carrier: winAnsi(row.carrier),
      policyType: winAnsi(row.policyType ?? PDF_NOT_AVAILABLE),
      deduction: deduction(
        legacyImpact === undefined
          ? row.amount
          : (row.commissionDeduction ?? 0),
      ),
      excluded: row.excluded,
      note: row.excluded
        ? winAnsi(`Left out: ${row.excludedNote || 'no note'}`)
        : null,
    }),
  );

  return {
    title: winAnsi(`Commission statement · ${s.userName} · ${period}`),
    header: { agencyName, logo: ctx.logo },
    details,
    indicators,
    carrierRows,
    carrierTotal,
    carrierNotes,
    summaryLeft,
    summaryRight,
    netPay: money(statementNetPay(t)),
    chargebackRows,
    ...(legacyImpact === undefined
      ? {
          chargebackAmountHeader: 'Premium charged back',
          chargebackTotalLabel: 'TOTAL CHARGED BACK',
          chargebackTotal: deduction(t.chargebackTotal),
        }
      : {
          chargebackAmountHeader: 'Commission deduction',
          chargebackTotalLabel: 'TOTAL CHARGEBACK IMPACT',
          chargebackTotal: deduction(legacyImpact),
        }),
    chargebackEmpty: `Nothing was charged back in ${period}.`,
    acknowledgment: {
      statement:
        'I acknowledge receipt and review of this commission statement.',
      typedName: null,
      dateSigned: null,
      comments: null,
    },
    footerLeft: `${agencyName} | Commission Statement`,
  };
}

/** A line of the grid, toned by its sign unless told otherwise. */
function line(
  label: string,
  amount: number,
  tone?: PdfSummaryLine['tone'],
): PdfSummaryLine {
  return {
    label,
    amount: money(amount),
    tone: tone ?? (amount < 0 ? 'debit' : 'credit'),
  };
}

/** A 2026 comp-plan line: printed only when the statement has it and it is not zero. */
function optional(
  label: string,
  amount: number | undefined,
): PdfSummaryLine | null {
  return amount ? line(label, amount) : null;
}

function compact<T>(items: (T | null)[]): T[] {
  return items.filter((item): item is T => item !== null);
}
