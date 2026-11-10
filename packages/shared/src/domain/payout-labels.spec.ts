import {
  complianceLabel,
  premiumLineLabel,
  somStatusLabel,
  statementReference,
} from './payout-labels';
import { statementPdfFilename } from './payouts';

describe('statementReference', () => {
  it('is the last six characters of the id, upper-cased, and the version', () => {
    expect(statementReference('6ae1bceaa8d09054f813c0bb', 1)).toBe(
      '13C0BB · v1',
    );
    expect(statementReference('6ae1bceaa8d09054f813c0bb', 3)).toBe(
      '13C0BB · v3',
    );
  });
});

describe('statementPdfFilename', () => {
  it('names the month and the version', () => {
    expect(statementPdfFilename('2026-10', 2)).toBe(
      'commission-statement-2026-10-v2.pdf',
    );
  });
});

describe('premiumLineLabel', () => {
  it('names a lead-source line after its carrier and source', () => {
    expect(
      premiumLineLabel({ carrier: 'Allstate', leadSourceName: 'JYA' }),
    ).toBe('Allstate · JYA leads');
    expect(
      premiumLineLabel({ carrier: 'Allstate', leadSourceName: null }),
    ).toBe('Allstate');
  });
});

describe('complianceLabel', () => {
  it('reads compliant, failed audits, and below the floor', () => {
    expect(complianceLabel('compliant', 0)).toBe('Compliant');
    expect(complianceLabel('non_compliant', 1)).toBe('1 failed audit');
    expect(complianceLabel('non_compliant', 2, true)).toBe(
      'Below the floor · 2 failed audits',
    );
    expect(complianceLabel('non_compliant', 0)).toBe('Not compliant');
  });
});

describe('somStatusLabel', () => {
  it('is null when Salesperson of the Month is off', () => {
    expect(somStatusLabel('winner')).toBe('Winner');
    expect(somStatusLabel('none')).toBe('Not this month');
    expect(somStatusLabel('off')).toBeNull();
  });
});
