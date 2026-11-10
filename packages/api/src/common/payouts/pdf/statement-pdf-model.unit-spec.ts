import { chargebackRow, storedStatement } from './__fixtures__/statement';
import { winAnsi } from './format';
import {
  buildStatementPdfModel,
  PDF_DRAFT_LABEL,
  PDF_NOT_AVAILABLE,
  type StatementPdfContext,
} from './statement-pdf-model';

const ISSUED: StatementPdfContext = {
  agencyName: 'Smith Family Agency',
  logo: null,
  issue: { kind: 'issued', at: new Date('2026-11-06T15:00:00.000Z') },
};

const labels = (lines: { label: string }[]) => lines.map((l) => l.label);
const field = (fields: { label: string; value: string }[], label: string) =>
  fields.find((f) => f.label === label)?.value;

describe('buildStatementPdfModel', () => {
  it('fills the statement details', () => {
    const model = buildStatementPdfModel(storedStatement(), ISSUED);
    expect(model.details).toEqual([
      { label: 'Producer name', value: 'Pat Producer' },
      { label: 'Commission period', value: 'October 2026' },
      { label: 'Producer ID', value: 'SOKDEMOP' },
      { label: 'Statement ID', value: '13C0BB · v1' },
      { label: 'Generated date', value: 'Nov 6, 2026' },
    ]);
    expect(model.footerLeft).toBe('Smith Family Agency | Commission Statement');
  });

  // The day is the statement's own zone's, not a hard-coded or today's
  // agency zone: 8 pm Chicago on Nov 6 is already Nov 7 in Tokyo.
  it("dates the issue in the statement's own time zone", () => {
    const at = new Date('2026-11-07T02:00:00.000Z');
    const dated = (timeZone: string) =>
      field(
        buildStatementPdfModel(
          { ...storedStatement(), timeZone },
          { ...ISSUED, issue: { kind: 'issued', at } },
        ).details,
        'Generated date',
      );
    expect(dated('America/Chicago')).toBe('Nov 6, 2026');
    expect(dated('Asia/Tokyo')).toBe('Nov 7, 2026');
    // A statement without one (never, since PAC-178) falls back to the default.
    expect(dated('')).toBe('Nov 6, 2026');
  });

  it('marks a draft preview so it cannot pass for an issued statement', () => {
    const model = buildStatementPdfModel(storedStatement(), {
      ...ISSUED,
      issue: { kind: 'draft' },
    });
    expect(field(model.details, 'Generated date')).toBe(PDF_DRAFT_LABEL);
  });

  it('prints the indicators, the entered compliance rate included', () => {
    const model = buildStatementPdfModel(storedStatement(), ISSUED);
    expect(model.indicators.map((f) => f.value)).toEqual([
      'Tier 2 · $50,000.00',
      '72.5%',
      '2',
      'Winner',
      'Compliant · 97%',
    ]);
  });

  it('shows base pay as its own line and totals to net pay (2026)', () => {
    const model = buildStatementPdfModel(storedStatement(), ISSUED);
    expect(labels(model.summaryRight)[0]).toBe('Base pay');
    expect(model.summaryRight[0].amount).toBe('$2,500.00');
    expect(model.netPay).toBe('$8,911.11');
    // The 2026 lines at zero are not printed.
    expect(labels(model.summaryLeft)).toEqual([
      'Carrier commission',
      'Tier bonus',
      'Team bonus',
      'Salesperson of the Month bonus',
      'Hat trick bonus',
    ]);
  });

  it('prints base pay even at $0 once the statement carries it', () => {
    const model = buildStatementPdfModel(
      storedStatement({ totals: { basePay: 0, netPay: 6411.11 } }),
      ISSUED,
    );
    expect(model.summaryRight[0]).toEqual({
      label: 'Base pay',
      amount: '$0.00',
      tone: 'plain',
    });
  });

  it('prints every 2026 line that is present and not zero', () => {
    const model = buildStatementPdfModel(
      storedStatement({
        totals: {
          stipend: 2000,
          rateStepBonus: 500,
          overrideCommission: 120.5,
          agencyBonus: 2500,
          producerOfYearBonus: 2500,
          referralAdjustment: -500,
          complianceReduction: -640.11,
        },
      }),
      ISSUED,
    );
    expect(labels(model.summaryLeft)).toEqual([
      'Carrier commission',
      'Rate step bonus',
      'Override commission',
      'Tier bonus',
      'Agency premium bonus',
      'Team bonus',
      'Salesperson of the Month bonus',
      'Hat trick bonus',
      'Producer of the Year bonus',
    ]);
    expect(labels(model.summaryRight)).toEqual([
      'Base pay',
      'Stipend',
      'Other bonuses / SPIFFs',
      'Referral deduction',
      'Compliance adjustment',
      'Compliance reduction',
      'Other adjustments',
    ]);
    const reduction = model.summaryRight.find(
      (l) => l.label === 'Compliance reduction',
    );
    expect(reduction).toEqual({
      label: 'Compliance reduction',
      amount: '-$640.11',
      tone: 'debit',
    });
  });

  it('prints the original grid for a statement computed before the 2026 fields', () => {
    const model = buildStatementPdfModel(
      storedStatement({ legacy: true }),
      ISSUED,
    );
    // Calculated before commission moved to net premium: it prints the
    // separate chargeback deduction it was calculated with.
    expect(labels(model.summaryLeft)[0]).toBe('Gross carrier commission');
    expect(labels(model.summaryRight)).toEqual([
      'Other bonuses / SPIFFs',
      'Compliance adjustment',
      'Chargeback commission impact',
      'Other adjustments',
    ]);
    expect(model.chargebackAmountHeader).toBe('Commission deduction');
    expect(model.chargebackTotalLabel).toBe('TOTAL CHARGEBACK IMPACT');
    expect(model.chargebackRows[0].deduction).toBe('-$40.00');
    expect(model.chargebackTotal).toBe('-$200.00');
    // Net pay is the net commission when there is no base pay.
    expect(model.netPay).toBe('$6,411.11');
    expect(field(model.indicators, 'Compliance status')).toBe('Compliant');
  });

  it('shows each carrier line with its rate step, and the total', () => {
    const model = buildStatementPdfModel(storedStatement(), ISSUED);
    expect(model.carrierRows).toHaveLength(9);
    expect(model.carrierRows[0]).toEqual({
      carrier: 'Allstate',
      rate: '10% · step 2',
      soldPremium: '$47,000.00',
      chargebacks: '-$2,000.00',
      netCommission: '$4,500.00',
    });
    expect(model.carrierRows[2]).toMatchObject({
      carrier: 'National General',
      rate: '5%',
      soldPremium: '$0.00',
      chargebacks: '$0.00',
    });
    expect(model.carrierTotal).toEqual({
      carrier: 'Total',
      rate: '',
      soldPremium: '$52,000.00',
      chargebacks: '-$2,000.00',
      netCommission: '$4,900.00',
    });
  });

  it('notes a bundle shortfall once per carrier', () => {
    const base = storedStatement();
    const flagged = base.premiumLines.map((line, index) =>
      index === 0
        ? {
            ...line,
            bundleRate: 71,
            minBundleRatePercent: 83,
            bundleShortfall: true,
          }
        : line,
    );
    const model = buildStatementPdfModel(
      storedStatement({
        premiumLines: [
          ...flagged,
          { ...flagged[0], leadSourceId: 'jya', leadSourceName: 'JYA' },
        ],
      }),
      ISSUED,
    );
    expect(model.carrierNotes).toEqual([
      'Allstate bundle rate 71% is below the 83% minimum.',
    ]);
    expect(model.carrierRows.at(-1)?.carrier).toBe('Allstate · JYA leads');
  });

  it('marks an excluded chargeback with the note', () => {
    const model = buildStatementPdfModel(
      storedStatement({
        chargebackRows: [
          chargebackRow(1, { excluded: true, excludedNote: 'Rewritten' }),
          chargebackRow(2, { customerName: null, policyType: null }),
        ],
      }),
      ISSUED,
    );
    // The premium charged back, struck through when left out.
    expect(model.chargebackRows[0]).toMatchObject({
      excluded: true,
      note: 'Left out: Rewritten',
      deduction: '-$400.00',
    });
    expect(model.chargebackRows[1]).toMatchObject({
      customer: PDF_NOT_AVAILABLE,
      policyType: PDF_NOT_AVAILABLE,
      excluded: false,
      note: null,
    });
    // `totals.chargebackTotal`: what was charged back, left-out rows excluded.
    expect(model.chargebackAmountHeader).toBe('Premium charged back');
    expect(model.chargebackTotalLabel).toBe('TOTAL CHARGED BACK');
    expect(model.chargebackTotal).toBe('-$2,000.00');
  });

  // Owner, 10 Nov 2026: the chargeback comes off the premium and the rate
  // applies to the rest — no second deduction for its commission.
  it('prints no separate chargeback deduction on a current statement', () => {
    const model = buildStatementPdfModel(storedStatement(), ISSUED);
    expect(labels(model.summaryRight)).not.toContain(
      'Chargeback commission impact',
    );
    expect(model.summaryLeft[0]).toEqual({
      label: 'Carrier commission',
      amount: '$4,900.00',
      tone: 'plain',
    });
    // The carrier table's total is the same commission.
    expect(model.carrierTotal.netCommission).toBe('$4,900.00');
    expect(model.netPay).toBe('$8,911.11');
  });

  it('prints N/A where there is no Producer ID or Salesperson of the Month', () => {
    const stored = storedStatement();
    stored.allstateBindId = null;
    stored.indicators = { ...stored.indicators, somStatus: 'off' };
    const model = buildStatementPdfModel(stored, ISSUED);
    expect(field(model.details, 'Producer ID')).toBe(PDF_NOT_AVAILABLE);
    expect(field(model.indicators, 'SOM status')).toBe(PDF_NOT_AVAILABLE);
  });
});

describe('winAnsi', () => {
  it('keeps what the standard fonts can print', () => {
    expect(winAnsi('José Núñez · O’Brien — 10%')).toBe(
      'José Núñez · O’Brien — 10%',
    );
  });

  it('drops accents it cannot print and replaces the rest', () => {
    expect(winAnsi('Łukasz Dvořák')).toBe('?ukasz Dvorák');
    expect(winAnsi('王 Smith')).toBe('? Smith');
  });
});
