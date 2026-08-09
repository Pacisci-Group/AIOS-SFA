import type { SoldPolicyInput } from '@sfa/shared';
import {
  buildSoldSubmissionToken,
  deriveAuditTriggers,
  deriveDealAggregates,
  deriveMortgagee,
  derivePersistedDealAggregates,
  derivePriorCarriers,
  findCrossBranchDiscounts,
  parseFormDate,
  soldDateYmd,
  yesNo,
} from './sold.normalize';

const EMPTY_DISCOUNTS: SoldPolicyInput['discounts'] = {
  escrow: false,
  inspection: { selected: false },
  fireSubscription: { selected: false },
  roofReceipt: { selected: false },
  acvPersonalProperty: false,
  acvDwellingProtection: false,
  drivewise: { selected: false },
  defensiveDriver: { selected: false, drivers: [] },
  studentDiscount: { selected: false },
};

function policy(overrides: Partial<SoldPolicyInput> = {}): SoldPolicyInput {
  return {
    policyType: 'Auto',
    effectiveDate: '2026-01-15',
    carrier: 'Allstate',
    policyNumber: 'ABC123456',
    premium: 100,
    itemCount: 1,
    discounts: structuredClone(EMPTY_DISCOUNTS),
    priorInsurance: { none: true },
    cancellation: { cancelled: false },
    ...overrides,
  };
}

describe('buildSoldSubmissionToken', () => {
  it('namespaces and uppercases, so a token cannot collide with a recap token', () => {
    expect(buildSoldSubmissionToken('abc-123')).toBe('SOLD|ABC-123');
  });

  it('is null for absent or blank input', () => {
    expect(buildSoldSubmissionToken(undefined)).toBeNull();
    expect(buildSoldSubmissionToken('   ')).toBeNull();
  });
});

describe('date handling', () => {
  it('parses a form date as UTC midnight, not local', () => {
    // Local parsing would shift the day either side of midnight depending on
    // the server's timezone, moving a deal between scorecard buckets.
    expect(parseFormDate('2026-01-15').toISOString()).toBe(
      '2026-01-15T00:00:00.000Z',
    );
  });

  it('derives the YYYYMMDD integer the range filters use', () => {
    expect(soldDateYmd('2026-01-15')).toBe(20260115);
    expect(soldDateYmd('2026-12-31')).toBe(20261231);
  });

  it('agrees with the parsed date', () => {
    const iso = '2026-07-04';
    const parsed = parseFormDate(iso);
    const expected =
      parsed.getUTCFullYear() * 10000 +
      (parsed.getUTCMonth() + 1) * 100 +
      parsed.getUTCDate();
    expect(soldDateYmd(iso)).toBe(expected);
  });
});

describe('deriveDealAggregates', () => {
  it('rounds the premium sum to cents', () => {
    // 1200.10 + 899.95 is 2100.0499999999997 in IEEE-754, and that value would
    // land verbatim in the Sold scorecard.
    const result = deriveDealAggregates(
      [policy({ premium: 1200.1 }), policy({ premium: 899.95 })],
      '2026-01-15',
    );
    expect(result.premium).toBe(2100.05);
  });

  it('sums items and counts policies', () => {
    const result = deriveDealAggregates(
      [policy({ itemCount: 2 }), policy({ itemCount: 3 })],
      '2026-01-15',
    );
    expect(result.itemCount).toBe(5);
    expect(result.policyCount).toBe(2);
  });

  it('dedupes and sorts policy types', () => {
    const result = deriveDealAggregates(
      [
        policy({ policyType: 'Home' }),
        policy({ policyType: 'Auto' }),
        policy({ policyType: 'Auto' }),
      ],
      '2026-01-15',
    );
    expect(result.policyTypes).toEqual(['Auto', 'Home']);
  });

  it('normalizes a raw SmartSuite code into the canonical label', () => {
    const result = deriveDealAggregates(
      [policy({ policyType: 'mCt4m' })],
      '2026-01-15',
    );
    expect(result.policyTypes).toEqual(['Landlord']);
  });

  it('flags a bundle when auto and property are both present', () => {
    const bundle = deriveDealAggregates(
      [policy({ policyType: 'Auto' }), policy({ policyType: 'Home' })],
      '2026-01-15',
    );
    expect(bundle.isBundle).toBe(true);
    expect(bundle.dealType).toBe('Bundle');
  });

  it('does not call two property lines a bundle', () => {
    const result = deriveDealAggregates(
      [policy({ policyType: 'Home' }), policy({ policyType: 'Landlord' })],
      '2026-01-15',
    );
    expect(result.isBundle).toBe(false);
    expect(result.dealType).toBe('Home');
  });

  it('derives Auto / Home / Other for single-line deals', () => {
    const cases: Array<[string, string]> = [
      ['Auto', 'Auto'],
      ['Motorcycle', 'Auto'],
      ['Home', 'Home'],
      ['Renters', 'Home'],
      ['Condominium', 'Home'],
      ['Landlord', 'Home'],
      ['Umbrella', 'Other'],
      ['Life', 'Other'],
    ];
    for (const [policyType, expected] of cases) {
      const result = deriveDealAggregates(
        [policy({ policyType })],
        '2026-01-15',
      );
      expect([policyType, result.dealType]).toEqual([policyType, expected]);
    }
  });
});

describe('derivePersistedDealAggregates (PAC-56 #25)', () => {
  it('folds stored rows the same way the DTO version folds a submission', () => {
    const totals = derivePersistedDealAggregates([
      { policyType: 'Auto', premium: 1200.1, items: 2 },
      { policyType: 'Home', premium: 899.95, items: 3 },
    ]);

    // Rounded to cents, not 2100.0499999999997.
    expect(totals.premium).toBe(2100.05);
    expect(totals.itemCount).toBe(5);
    expect(totals.policyCount).toBe(2);
    expect(totals.policyTypes).toEqual(['Auto', 'Home']);
    expect(totals.isBundle).toBe(true);
    expect(totals.dealType).toBe('Bundle');
  });

  it('reads `items`, not `itemCount` — the stored field has the other name', () => {
    // The single easiest way to get this wrong: copy the DTO version and end up
    // silently summing `undefined` into zero on every deal.
    const totals = derivePersistedDealAggregates([
      { policyType: 'Auto', premium: 100, items: 4 },
    ]);
    expect(totals.itemCount).toBe(4);
  });

  it('normalizes a migrated raw SmartSuite policy code', () => {
    // `Zgsh3` is Auto in the Policies code set. Left raw, the deal would report
    // a policy type no reader recognises and `isBundle` would be wrong.
    const totals = derivePersistedDealAggregates([
      { policyType: 'Zgsh3', premium: 100, items: 1 },
      { policyType: 'eCEuV', premium: 100, items: 1 },
    ]);
    expect(totals.policyTypes).toEqual(['Auto', 'Home']);
    expect(totals.isBundle).toBe(true);
  });

  it('tolerates rows missing every optional field', () => {
    const totals = derivePersistedDealAggregates([{}, {}]);
    expect(totals.premium).toBe(0);
    expect(totals.itemCount).toBe(0);
    expect(totals.policyCount).toBe(2);
    expect(totals.policyTypes).toEqual([]);
  });

  it('never returns a sold date — that is the scorecard bucket key', () => {
    // A premium correction must not move the deal between reporting days.
    const totals = derivePersistedDealAggregates([
      { policyType: 'Auto', premium: 100, items: 1 },
    ]);
    expect(totals).not.toHaveProperty('soldDate');
    expect(totals).not.toHaveProperty('soldDateYmd');
  });
});

describe('deriveAuditTriggers', () => {
  it('is all-false for a deal with no discounts', () => {
    const triggers = deriveAuditTriggers([policy()]);
    expect(triggers).toEqual({
      defensiveDriver: false,
      goodStudent: false,
      drivewise: false,
      fireSubscription: false,
      actualCashValue: false,
      hailResistantRoof: false,
      defensiveDriverNames: [],
    });
  });

  it('ORs a selection across policies', () => {
    const withDrivewise = policy({
      discounts: {
        ...structuredClone(EMPTY_DISCOUNTS),
        drivewise: { selected: true },
      },
    });
    expect(deriveAuditTriggers([policy(), withDrivewise]).drivewise).toBe(true);
  });

  it('treats either ACV option as the one Actual Cash Value trigger', () => {
    const personal = policy({
      policyType: 'Home',
      discounts: {
        ...structuredClone(EMPTY_DISCOUNTS),
        acvPersonalProperty: true,
      },
    });
    const dwelling = policy({
      policyType: 'Home',
      discounts: {
        ...structuredClone(EMPTY_DISCOUNTS),
        acvDwellingProtection: true,
      },
    });
    expect(deriveAuditTriggers([personal]).actualCashValue).toBe(true);
    expect(deriveAuditTriggers([dwelling]).actualCashValue).toBe(true);
  });

  it('maps form wording onto the audit-template vocabulary', () => {
    const p = policy({
      policyType: 'Home',
      discounts: {
        ...structuredClone(EMPTY_DISCOUNTS),
        roofReceipt: { selected: true, hasProof: false },
      },
    });
    // The form says "Roof Receipt"; the checklist says "Hail Resistant Roof".
    expect(deriveAuditTriggers([p]).hailResistantRoof).toBe(true);

    const student = policy({
      discounts: {
        ...structuredClone(EMPTY_DISCOUNTS),
        studentDiscount: { selected: true, hasProof: false },
      },
    });
    // The form says "Student Discount"; the checklist says "Good Student".
    expect(deriveAuditTriggers([student]).goodStudent).toBe(true);
  });

  it('collects every named driver, deduped and trimmed', () => {
    const auto = policy({
      discounts: {
        ...structuredClone(EMPTY_DISCOUNTS),
        defensiveDriver: {
          selected: true,
          drivers: [{ name: 'Dana Driver' }, { name: '  Sam Second  ' }],
        },
      },
    });
    const moto = policy({
      policyType: 'Motorcycle',
      discounts: {
        ...structuredClone(EMPTY_DISCOUNTS),
        defensiveDriver: {
          // The same person on a second policy needs one certificate, not two.
          selected: true,
          drivers: [{ name: 'Dana Driver' }],
        },
      },
    });

    const triggers = deriveAuditTriggers([auto, moto]);
    expect(triggers.defensiveDriver).toBe(true);
    expect(triggers.defensiveDriverNames.sort()).toEqual([
      'Dana Driver',
      'Sam Second',
    ]);
  });

  it('ignores blank driver names rather than generating a nameless item', () => {
    const p = policy({
      discounts: {
        ...structuredClone(EMPTY_DISCOUNTS),
        defensiveDriver: { selected: true, drivers: [{ name: '   ' }] },
      },
    });
    expect(deriveAuditTriggers([p]).defensiveDriverNames).toEqual([]);
  });
});

describe('deriveMortgagee', () => {
  it('is true when any policy claimed escrow', () => {
    const escrow = policy({
      policyType: 'Home',
      discounts: { ...structuredClone(EMPTY_DISCOUNTS), escrow: true },
    });
    expect(deriveMortgagee([policy(), escrow])).toBe(true);
    expect(deriveMortgagee([policy()])).toBe(false);
  });
});

describe('findCrossBranchDiscounts', () => {
  it('accepts discounts that match their policy type', () => {
    const auto = policy({
      discounts: {
        ...structuredClone(EMPTY_DISCOUNTS),
        drivewise: { selected: true },
      },
    });
    const home = policy({
      policyType: 'Home',
      discounts: { ...structuredClone(EMPTY_DISCOUNTS), escrow: true },
    });
    expect(findCrossBranchDiscounts([auto, home])).toEqual([]);
  });

  it('rejects auto discounts on a property policy', () => {
    const bogus = policy({
      policyType: 'Home',
      discounts: {
        ...structuredClone(EMPTY_DISCOUNTS),
        drivewise: { selected: true },
      },
    });
    // Stripping silently would generate a Drivewise audit item for a deal with
    // no auto line, and nothing downstream could tell it was bogus.
    expect(findCrossBranchDiscounts([bogus])).toHaveLength(1);
    expect(findCrossBranchDiscounts([bogus])[0]).toContain('policies.0');
  });

  it('rejects property discounts on an auto policy', () => {
    const bogus = policy({
      policyType: 'Auto',
      discounts: { ...structuredClone(EMPTY_DISCOUNTS), escrow: true },
    });
    expect(findCrossBranchDiscounts([bogus])).toHaveLength(1);
  });

  it('rejects both branches on a policy that is neither', () => {
    const umbrella = policy({
      policyType: 'Umbrella',
      discounts: {
        ...structuredClone(EMPTY_DISCOUNTS),
        drivewise: { selected: true },
        escrow: true,
      },
    });
    expect(findCrossBranchDiscounts([umbrella])).toHaveLength(2);
  });

  it('reports the index of every offending policy', () => {
    const ok = policy();
    const bad = policy({
      policyType: 'Home',
      discounts: {
        ...structuredClone(EMPTY_DISCOUNTS),
        drivewise: { selected: true },
      },
    });
    const problems = findCrossBranchDiscounts([ok, bad, bad]);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain('policies.1');
    expect(problems[1]).toContain('policies.2');
  });
});

describe('yesNo', () => {
  it('renders booleans the way legacy stores them', () => {
    // `priorInsurance`/`priorPolicies` hold these as strings, not booleans.
    expect(yesNo(true)).toBe('Yes');
    expect(yesNo(false)).toBe('No');
  });
});

describe('derivePriorCarriers', () => {
  const prior = (
    policyType: string,
    carrier?: string,
    none = false,
  ): Parameters<typeof derivePriorCarriers>[0][number] => ({
    policyType,
    priorInsurance: { none, carrier },
  });

  it('splits carriers into the auto and home columns', () => {
    const result = derivePriorCarriers([
      prior('Auto', 'Geico'),
      prior('Home', 'State Farm'),
    ]);
    expect(result).toEqual({
      auto: 'Geico',
      home: 'State Farm',
      sameCarrier: false,
    });
  });

  it('flags one carrier covering both sides', () => {
    const result = derivePriorCarriers([
      prior('Auto', 'Progressive'),
      prior('Home', 'progressive'),
    ]);
    expect(result.sameCarrier).toBe(true);
  });

  it('ignores lines that declared no prior insurance', () => {
    const result = derivePriorCarriers([
      prior('Auto', undefined, true),
      prior('Home', 'State Farm'),
    ]);
    expect(result.auto).toBeUndefined();
    expect(result.home).toBe('State Farm');
  });

  it('is not "same carrier" when only one side was declared', () => {
    // Two undefined carriers must not read as a match.
    expect(derivePriorCarriers([prior('Auto', 'Geico')]).sameCarrier).toBe(
      false,
    );
    expect(derivePriorCarriers([]).sameCarrier).toBe(false);
  });

  it('takes the first declared carrier of each kind', () => {
    const result = derivePriorCarriers([
      prior('Auto', 'First Auto'),
      prior('Motorcycle', 'Second Auto'),
      prior('Home', 'First Home'),
      prior('Landlord', 'Second Home'),
    ]);
    expect(result.auto).toBe('First Auto');
    expect(result.home).toBe('First Home');
  });

  it('trims stored carrier names', () => {
    const result = derivePriorCarriers([prior('Auto', '  Geico  ')]);
    expect(result.auto).toBe('Geico');
  });
});
