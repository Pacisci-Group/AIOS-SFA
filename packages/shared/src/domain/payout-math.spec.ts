import {
  allocatePool,
  computeStatement,
  computeTeamContext,
  hatTrickDays,
  percentOf,
  roundToCents,
  salesGrossPremium,
  salespersonOfMonthWinners,
  teamBonusFor,
  toDealView,
  type ComputeStatementInput,
  type PayoutChargeback,
  type PayoutSale,
  type StatementRules,
} from './payout-math';
import {
  ANY_CARRIER,
  DEFAULT_TEAM_BONUS,
  DEFAULT_TEAM_REQUIREMENTS,
  EMPTY_STATEMENT_INPUTS,
  PAYOUT_NO_CARRIER,
  payoutPoolFor,
  type TeamBonusSettings,
} from './payouts';

/** The 2026 comp-plan parts, all off: a structure that pays as before. */
const PLAN_OFF = {
  basePay: 0,
  stipendAmounts: [],
  complianceFloor: null,
  overrides: [],
  agencyTiers: [],
  agencyTiersCarrier: ANY_CARRIER,
  teamRequirements: DEFAULT_TEAM_REQUIREMENTS,
  referralRule: null,
  chargebackWindowMonths: null,
} satisfies Partial<StatementRules>;

/** `leadSources` ids, as the API stores them. */
const JYA = '6ab279758bded56c719a429b';
const MAIL_JYA = '6ab279758bded56c719a4285';
const GOOGLE = '6ab279758bded56c719a4211';

const NAMES = new Map([
  [JYA, 'JYA'],
  [MAIL_JYA, 'Mail-JYA'],
  [GOOGLE, 'Google'],
]);

const STRUCTURE: StatementRules = {
  rules: [
    { carrier: 'Allstate', ratePercent: 10, minBundleRatePercent: 80 },
    { carrier: ANY_CARRIER, ratePercent: 5, minBundleRatePercent: null },
  ],
  leadSourceRules: [
    { leadSourceId: JYA, carrier: 'Allstate', ratePercent: 6 },
    { leadSourceId: MAIL_JYA, carrier: ANY_CARRIER, ratePercent: 4 },
  ],
  hatTrick: { enabled: true, dealsPerDay: 3, bonusAmount: 50 },
  individualTiers: [
    { thresholdPremium: 50_000, bonusAmount: 500 },
    { thresholdPremium: 20_000, bonusAmount: 200 },
  ],
  tiersStackable: false,
  teamBonusEligible: true,
  ...PLAN_OFF,
};

let nextId = 0;
function sale(
  day: string,
  leadSourceId: string | null,
  lines: [carrier: string | null, policyType: string, premium: number][],
): PayoutSale {
  nextId += 1;
  return {
    dealId: `deal-${String(nextId).padStart(3, '0')}`,
    soldDate: `${day}T17:00:00.000Z`,
    soldDay: day,
    clientName: `Client ${nextId}`,
    policyTypes: [],
    leadSourceId,
    lines: lines.map(([carrier, policyType, premium]) => ({
      carrier,
      policyType,
      premium,
      typed: true,
    })),
  };
}

function chargeback(
  id: string,
  carrier: string | null,
  leadSourceId: string | null,
  amount: number,
): PayoutChargeback {
  return {
    chargebackId: id,
    policyId: null,
    policyNumber: `P-${id}`,
    policyType: 'Auto',
    carrier,
    leadSourceId,
    customerName: 'Pat Doe',
    amount,
    occurredAt: '2026-10-20T15:00:00.000Z',
    occurredDay: '2026-10-20',
    reason: 'cancellation',
    source: 'app',
  };
}

const NO_TEAM = {
  eligible: false,
  met: false,
  poolAmount: 0,
  pool: 'producer' as const,
  groupPool: 0,
  groupPremium: 0,
  amount: 0,
};

function input(
  overrides: Partial<ComputeStatementInput> = {},
): ComputeStatementInput {
  return {
    month: '2026-10',
    userId: 'user-1',
    inputs: EMPTY_STATEMENT_INPUTS,
    startMonth: null,
    basePayApplies: true,
    agencySales: [],
    producerOfYear: { enabled: false, bonusAmount: 0, winner: false },
    structure: STRUCTURE,
    sales: [],
    chargebacks: [],
    adjustments: [],
    appointedCarriers: [],
    leadSourceNames: NAMES,
    failedAudits: 0,
    team: NO_TEAM,
    salespersonOfMonth: { enabled: false, bonusAmount: 0, winner: false },
    ...overrides,
  };
}

/** The October month the e2e suite also uses: five sales, two days. */
function octoberSales(): PayoutSale[] {
  return [
    sale('2026-10-01', GOOGLE, [
      ['Allstate', 'Auto', 1000],
      ['Allstate', 'Home', 2000],
    ]),
    sale('2026-10-01', JYA, [['Allstate', 'Auto', 1500]]),
    sale('2026-10-01', MAIL_JYA, [['Progressive', 'Auto', 800]]),
    sale('2026-10-02', null, [['B4tEH', 'Auto', 500]]),
    sale('2026-10-02', GOOGLE, [['Travelers', 'Home', 700]]),
  ];
}

describe('money', () => {
  it('applies a rate in whole cents, half away from zero', () => {
    expect(percentOf(1234.56, 10)).toBe(123.46);
    expect(percentOf(0.05, 50)).toBe(0.03);
    expect(percentOf(10.01, 33.33)).toBe(3.34);
    expect(percentOf(-0.05, 50)).toBe(-0.03);
    expect(percentOf(0, 10)).toBe(0);
  });

  it('rounds any amount to the cent', () => {
    expect(roundToCents(1.005)).toBe(1.01);
    expect(roundToCents(-2.345)).toBe(-2.35);
    expect(roundToCents(Number.NaN)).toBe(0);
  });

  it('splits a pool by largest remainder so the shares add up exactly', () => {
    const thirds = allocatePool(100, [
      { id: 'a', weight: 1 },
      { id: 'b', weight: 1 },
      { id: 'c', weight: 1 },
    ]);
    expect([...thirds.values()]).toEqual([33.34, 33.33, 33.33]);

    const odd = allocatePool(1000, [
      { id: 'a', weight: 333.33 },
      { id: 'b', weight: 333.33 },
      { id: 'c', weight: 333.34 },
    ]);
    const total = [...odd.values()].reduce(
      (sum, v) => sum + Math.round(v * 100),
      0,
    );
    expect(total).toBe(100_000);
    expect(odd.get('c')).toBe(333.34);

    expect(
      allocatePool(50, [
        { id: 'a', weight: 0 },
        { id: 'b', weight: 10 },
      ]),
    ).toEqual(
      new Map([
        ['a', 0],
        ['b', 50],
      ]),
    );
    expect(allocatePool(50, [{ id: 'a', weight: 0 }]).get('a')).toBe(0);
    expect(allocatePool(0, [{ id: 'a', weight: 10 }]).get('a')).toBe(0);
  });
});

describe('payoutPoolFor', () => {
  it('puts a CSR in the CSR pool and anyone else with the producers', () => {
    expect(payoutPoolFor(['csr'])).toBe('csr');
    expect(payoutPoolFor(['producer', 'csr'])).toBe('csr');
    expect(payoutPoolFor(['producer'])).toBe('producer');
    expect(payoutPoolFor([])).toBe('producer');
  });
});

describe('toDealView / hatTrickDays', () => {
  it('counts typed policies, carriers and the bundle', () => {
    const view = toDealView(
      sale('2026-10-01', JYA, [
        ['B4tEH', 'PYgez', 1000],
        ['Progressive', 'Home', 250.5],
      ]),
      NAMES,
    );
    expect(view.carriers).toEqual(['Allstate', 'Progressive']);
    expect(view.policyCount).toBe(2);
    expect(view.premium).toBe(1250.5);
    expect(view.isBundle).toBe(true);
    expect(view.leadSourceName).toBe('JYA');
  });

  it('shows a sale with no policies by its own types, never as a bundle', () => {
    const view = toDealView(
      {
        ...sale('2026-10-01', null, []),
        policyTypes: ['Auto', 'Home'],
        lines: [
          { carrier: null, policyType: null, premium: 900, typed: false },
        ],
      },
      NAMES,
    );
    expect(view.policyCount).toBe(0);
    expect(view.policyTypes).toEqual(['Auto', 'Home']);
    expect(view.carriers).toEqual([]);
    expect(view.isBundle).toBe(false);
    expect(view.premium).toBe(900);
  });

  it('pays the hat trick once per agency-local day with enough sales', () => {
    const days = [
      '2026-10-31',
      '2026-10-31',
      '2026-10-31',
      '2026-10-30',
      '2026-10-30',
    ];
    expect(
      hatTrickDays(
        days.map((soldDay) => ({ soldDay })),
        3,
      ),
    ).toEqual(['2026-10-31']);
    expect(
      hatTrickDays(
        days.map((soldDay) => ({ soldDay })),
        2,
      ),
    ).toEqual(['2026-10-30', '2026-10-31']);
  });
});

describe('computeStatement', () => {
  it('buckets premium by carrier, giving lead-source rates their own line', () => {
    const result = computeStatement(
      input({
        sales: octoberSales(),
        appointedCarriers: ['Allstate', 'Safeco'],
      }),
    );
    expect(
      result.premiumLines.map((line) => [
        line.carrier,
        line.leadSourceName,
        line.grossPremium,
        line.ratePercent,
        line.rateSource,
        line.grossCommission,
        line.appointed,
      ]),
    ).toEqual([
      ['Allstate', null, 3500, 10, 'carrier', 350, true],
      ['Allstate', 'JYA', 1500, 6, 'lead_source_carrier', 90, true],
      ['Progressive', 'Mail-JYA', 800, 4, 'lead_source', 32, false],
      ['Safeco', null, 0, 5, 'any', 0, true],
      ['Travelers', null, 700, 5, 'any', 35, false],
    ]);
    expect(result.totals.grossPremium).toBe(6500);
    expect(result.totals.grossCommission).toBe(507);
  });

  it('folds a lead source with no rate of its own into the carrier line', () => {
    const plain: StatementRules = { ...STRUCTURE, leadSourceRules: [] };
    const result = computeStatement(
      input({ structure: plain, sales: octoberSales() }),
    );
    expect(
      result.premiumLines.map((line) => [line.carrier, line.leadSourceId]),
    ).toEqual([
      ['Allstate', null],
      ['Progressive', null],
      ['Travelers', null],
    ]);
    expect(result.premiumLines[0].grossPremium).toBe(5000);
  });

  it('pays 0% where no rule covers a carrier, and says so', () => {
    const allstateOnly: StatementRules = {
      ...STRUCTURE,
      rules: [
        { carrier: 'Allstate', ratePercent: 10, minBundleRatePercent: null },
      ],
      leadSourceRules: [],
    };
    const result = computeStatement(
      input({
        structure: allstateOnly,
        sales: [sale('2026-10-03', null, [['Progressive', 'Auto', 400]])],
      }),
    );
    expect(result.premiumLines[0]).toMatchObject({
      carrier: 'Progressive',
      ratePercent: 0,
      rateSource: 'none',
      grossCommission: 0,
    });
    expect(result.warnings).toContain(
      'No rate on this structure covers Progressive, so its premium is paid at 0%.',
    );
  });

  it('takes each chargeback off the line of the sale it reverses', () => {
    const result = computeStatement(
      input({
        sales: octoberSales(),
        chargebacks: [
          chargeback('cb1', 'Allstate', JYA, 300),
          chargeback('cb2', null, null, 100),
          chargeback('cb3', 'Allstate', null, 1000),
        ],
        adjustments: [
          {
            id: 'a1',
            kind: 'exclude_chargeback',
            chargebackId: 'cb3',
            amount: null,
            note: 'Rewritten same day',
          },
        ],
      }),
    );
    const jya = result.premiumLines.find((line) => line.leadSourceId === JYA);
    expect(jya).toMatchObject({
      chargebacks: 300,
      netPremium: 1200,
      chargebackImpact: 18,
      netCommission: 72,
    });
    const none = result.premiumLines.find(
      (line) => line.carrier === PAYOUT_NO_CARRIER,
    );
    expect(none).toMatchObject({
      grossPremium: 0,
      chargebacks: 100,
      netPremium: -100,
      ratePercent: 5,
      chargebackImpact: 5,
      netCommission: -5,
    });
    expect(result.premiumLines.at(-1)?.carrier).toBe(PAYOUT_NO_CARRIER);
    const allstate = result.premiumLines.find(
      (line) => line.carrier === 'Allstate' && !line.leadSourceId,
    );
    expect(allstate?.chargebacks).toBe(0);
    const excluded = result.chargebacks.find(
      (row) => row.chargebackId === 'cb3',
    );
    expect(excluded).toMatchObject({
      excluded: true,
      excludedNote: 'Rewritten same day',
      commissionDeduction: 100,
    });
    expect(result.totals.chargebackTotal).toBe(400);
    expect(result.totals.chargebackImpact).toBe(23);
    expect(result.totals.netPremium).toBe(6100);
  });

  it('lets a line and the statement go negative', () => {
    const result = computeStatement(
      input({ chargebacks: [chargeback('cb1', 'Allstate', null, 2500)] }),
    );
    expect(result.premiumLines[0]).toMatchObject({
      netPremium: -2500,
      netCommission: -250,
    });
    expect(result.totals.netCommission).toBe(-250);
  });

  it('flags a carrier below its minimum bundle rate, lead-source lines included', () => {
    const result = computeStatement(input({ sales: octoberSales() }));
    const allstate = result.premiumLines.filter(
      (line) => line.carrier === 'Allstate',
    );
    expect(allstate).toHaveLength(2);
    for (const line of allstate) {
      expect(line).toMatchObject({
        bundleRate: 33.33,
        minBundleRatePercent: 80,
        bundleShortfall: true,
      });
    }
    expect(result.warnings).toContain(
      'Allstate bundle rate 33.33% is below the 80% minimum.',
    );
    expect(
      result.warnings.filter((w) => w.includes('bundle rate')),
    ).toHaveLength(1);
    expect(result.indicators.bundleRate).toBe(20);
    // Pay is unchanged by the flag.
    expect(allstate[0].grossCommission).toBe(350);
  });

  it('checks the catch-all minimum per carrier separately', () => {
    const structure: StatementRules = {
      ...STRUCTURE,
      rules: [
        { carrier: ANY_CARRIER, ratePercent: 5, minBundleRatePercent: 50 },
      ],
      leadSourceRules: [],
    };
    const result = computeStatement(
      input({
        structure,
        sales: [
          sale('2026-10-01', null, [
            ['Progressive', 'Auto', 100],
            ['Safeco', 'Home', 100],
          ]),
          sale('2026-10-02', null, [['Progressive', 'Auto', 100]]),
          sale('2026-10-03', null, [['Travelers', 'Auto', 100]]),
        ],
      }),
    );
    const byCarrier = Object.fromEntries(
      result.premiumLines.map((line) => [
        line.carrier,
        [line.bundleRate, line.bundleShortfall],
      ]),
    );
    expect(byCarrier).toEqual({
      Progressive: [50, false],
      Safeco: [100, false],
      Travelers: [0, true],
    });
  });

  it('pays the hat trick, the highest tier, the team share and Salesperson of the Month', () => {
    const big = [
      sale('2026-10-05', null, [['Allstate', 'Auto', 30_000]]),
      sale('2026-10-05', null, [['Allstate', 'Home', 20_000]]),
      sale('2026-10-05', null, [['Allstate', 'Auto', 10_000]]),
    ];
    const result = computeStatement(
      input({
        sales: big,
        team: {
          ...NO_TEAM,
          eligible: true,
          met: true,
          poolAmount: 6000,
          groupPool: 4800,
          groupPremium: 80_000,
          amount: 3600,
        },
        salespersonOfMonth: { enabled: true, bonusAmount: 250, winner: true },
      }),
    );
    expect(result.bonuses.hatTrick).toMatchObject({
      days: ['2026-10-05'],
      amount: 50,
    });
    expect(result.bonuses.individual).toEqual({
      stackable: false,
      reached: [{ thresholdPremium: 50_000, bonusAmount: 500 }],
      amount: 500,
    });
    expect(result.indicators.tier).toEqual({
      level: 2,
      thresholdPremium: 50_000,
    });
    expect(result.indicators.hatTricks).toBe(1);
    expect(result.indicators.somStatus).toBe('winner');
    expect(result.totals).toMatchObject({
      grossCommission: 6000,
      tierBonus: 500,
      teamBonus: 3600,
      somBonus: 250,
      hatTrickBonus: 50,
      netCommission: 10_400,
    });
  });

  it('adds every tier reached when the tiers stack', () => {
    const result = computeStatement(
      input({
        structure: { ...STRUCTURE, tiersStackable: true },
        sales: [sale('2026-10-05', null, [['Allstate', 'Auto', 60_000]])],
      }),
    );
    expect(result.bonuses.individual.amount).toBe(700);
    expect(result.bonuses.individual.reached).toHaveLength(2);
    expect(result.indicators.tier).toEqual({
      level: 2,
      thresholdPremium: 50_000,
    });
  });

  it('pays no tier below the first threshold, and exactly at it', () => {
    const below = computeStatement(
      input({
        sales: [sale('2026-10-05', null, [['Allstate', 'Auto', 19_999.99]])],
      }),
    );
    expect(below.totals.tierBonus).toBe(0);
    expect(below.indicators.tier).toBeNull();
    const exact = computeStatement(
      input({
        sales: [sale('2026-10-05', null, [['Allstate', 'Auto', 20_000]])],
      }),
    );
    expect(exact.totals.tierBonus).toBe(200);
    expect(exact.indicators.tier).toEqual({
      level: 1,
      thresholdPremium: 20_000,
    });
  });

  it('pays no team share on an ineligible structure and no hat trick when off', () => {
    const result = computeStatement(
      input({
        structure: {
          ...STRUCTURE,
          hatTrick: { enabled: false, dealsPerDay: 3, bonusAmount: 50 },
        },
        sales: octoberSales(),
        team: { ...NO_TEAM, eligible: false, amount: 999 },
      }),
    );
    expect(result.totals.teamBonus).toBe(0);
    expect(result.totals.hatTrickBonus).toBe(0);
    expect(result.indicators.hatTricks).toBeNull();
    expect(result.indicators.somStatus).toBe('off');
  });

  it('sums the manager adjustments into their own totals', () => {
    const result = computeStatement(
      input({
        sales: [sale('2026-10-05', null, [['Allstate', 'Auto', 1000]])],
        adjustments: [
          {
            id: 'a1',
            kind: 'spiff',
            chargebackId: null,
            amount: 25,
            note: 'Life app',
          },
          {
            id: 'a2',
            kind: 'spiff',
            chargebackId: null,
            amount: 10.5,
            note: 'Umbrella',
          },
          {
            id: 'a3',
            kind: 'compliance',
            chargebackId: null,
            amount: -10,
            note: 'Missing docs',
          },
          {
            id: 'a4',
            kind: 'manual',
            chargebackId: null,
            amount: -2.5,
            note: 'Correction',
          },
        ],
      }),
    );
    expect(result.totals).toMatchObject({
      grossCommission: 100,
      spiffs: 35.5,
      complianceAdjustment: -10,
      otherAdjustments: -2.5,
      netCommission: 123,
    });
  });

  it('reports compliance from failed deal audits', () => {
    expect(computeStatement(input()).indicators.complianceStatus).toBe(
      'compliant',
    );
    const failed = computeStatement(input({ failedAudits: 2 })).indicators;
    expect(failed).toMatchObject({
      complianceStatus: 'non_compliant',
      failedAudits: 2,
    });
  });

  it('adds up the whole October statement', () => {
    const result = computeStatement(
      input({
        sales: octoberSales(),
        chargebacks: [
          chargeback('cb1', 'Allstate', JYA, 300),
          chargeback('cb2', null, null, 100),
        ],
        team: { ...NO_TEAM, eligible: true, amount: 12.34 },
        salespersonOfMonth: { enabled: true, bonusAmount: 100, winner: true },
        adjustments: [
          { id: 'a1', kind: 'spiff', chargebackId: null, amount: 25, note: '' },
          {
            id: 'a2',
            kind: 'compliance',
            chargebackId: null,
            amount: -10,
            note: '',
          },
          {
            id: 'a3',
            kind: 'manual',
            chargebackId: null,
            amount: -2.5,
            note: '',
          },
        ],
      }),
    );
    // 507 − 23 + 12.34 + 100 + 50 + 25 − 10 − 2.5
    expect(result.totals.netCommission).toBe(658.84);
    expect(salesGrossPremium(octoberSales())).toBe(result.totals.grossPremium);
    const linesNet = result.premiumLines.reduce(
      (sum, line) => sum + Math.round(line.netCommission * 100),
      0,
    );
    expect(linesNet / 100).toBe(
      result.totals.grossCommission - result.totals.chargebackImpact,
    );
  });

  it('warns about premium with no carrier recorded', () => {
    const result = computeStatement(
      input({
        sales: [
          {
            ...sale('2026-10-05', null, []),
            lines: [
              { carrier: null, policyType: null, premium: 900, typed: false },
            ],
          },
        ],
      }),
    );
    expect(result.premiumLines[0]).toMatchObject({
      carrier: PAYOUT_NO_CARRIER,
      grossPremium: 900,
      ratePercent: 5,
    });
    expect(result.warnings).toContain(
      '$900 of sold premium has no carrier recorded.',
    );
  });
});

describe('computeTeamContext', () => {
  const stacked: TeamBonusSettings = {
    enabled: true,
    stackable: true,
    levels: [
      { thresholdPremium: 350_000, poolAmount: 3000 },
      { thresholdPremium: 300_000, poolAmount: 3000 },
    ],
    csrSharePercent: 20,
    producerSharePercent: 80,
  };
  const members = [
    {
      userId: 'p1',
      pool: 'producer' as const,
      grossPremium: 30_000,
      eligible: true,
    },
    {
      userId: 'p2',
      pool: 'producer' as const,
      grossPremium: 10_000,
      eligible: true,
    },
    { userId: 'c1', pool: 'csr' as const, grossPremium: 5_000, eligible: true },
    {
      userId: 'p3',
      pool: 'producer' as const,
      grossPremium: 50_000,
      eligible: false,
    },
  ];

  it('splits 20/80 and shares each half by premium', () => {
    const team = computeTeamContext(stacked, 360_000, members);
    expect(team).toMatchObject({
      met: true,
      poolAmount: 6000,
      csrPool: 1200,
      producerPool: 4800,
      csrPremium: 5000,
      producerPremium: 40_000,
    });
    expect(team.shares).toEqual({ p1: 3600, p2: 1200, c1: 1200 });
    expect(
      teamBonusFor(team, { userId: 'p3', pool: 'producer', eligible: false })
        .amount,
    ).toBe(0);
    expect(
      teamBonusFor(team, { userId: 'p1', pool: 'producer', eligible: true }),
    ).toEqual({
      eligible: true,
      met: true,
      poolAmount: 6000,
      pool: 'producer',
      groupPool: 4800,
      groupPremium: 40_000,
      amount: 3600,
    });
    expect(team.levels.map((level) => level.thresholdPremium)).toEqual([
      300_000, 350_000,
    ]);
  });

  it('pays only the highest level when not stacking', () => {
    const team = computeTeamContext(
      { ...stacked, stackable: false },
      360_000,
      members,
    );
    expect(team.poolAmount).toBe(3000);
    expect(team.csrPool + team.producerPool).toBe(3000);
  });

  it('pays nothing below the first level, or while off', () => {
    const below = computeTeamContext(stacked, 299_999.99, members);
    expect(below).toMatchObject({ met: false, poolAmount: 0 });
    expect(below.shares).toEqual({ p1: 0, p2: 0, c1: 0 });
    const off = computeTeamContext(
      { ...stacked, enabled: false },
      400_000,
      members,
    );
    expect(off).toMatchObject({ met: false, poolAmount: 0 });
    expect(
      computeTeamContext(DEFAULT_TEAM_BONUS, 400_000, members).poolAmount,
    ).toBe(0);
  });

  it('splits an odd pool to the exact cent', () => {
    const team = computeTeamContext(
      {
        ...stacked,
        stackable: false,
        levels: [{ thresholdPremium: 1, poolAmount: 1000.01 }],
        csrSharePercent: 33.33,
        producerSharePercent: 66.67,
      },
      10,
      [
        { userId: 'p1', pool: 'producer', grossPremium: 1, eligible: true },
        { userId: 'p2', pool: 'producer', grossPremium: 1, eligible: true },
        { userId: 'p3', pool: 'producer', grossPremium: 1, eligible: true },
        { userId: 'c1', pool: 'csr', grossPremium: 7, eligible: true },
      ],
    );
    expect(
      Math.round(team.csrPool * 100) + Math.round(team.producerPool * 100),
    ).toBe(100_001);
    const paid = Object.values(team.shares).reduce(
      (sum, v) => sum + Math.round(v * 100),
      0,
    );
    expect(paid).toBe(100_001);
  });

  it('says when a half of the pool has no one to go to', () => {
    const team = computeTeamContext(
      stacked,
      360_000,
      members.filter((m) => m.pool !== 'csr'),
    );
    expect(team.warnings).toEqual([
      'No team-eligible CSR sold this month, so the CSR share of the team pool ($1,200) is not paid out.',
    ]);
  });
});

describe('salespersonOfMonthWinners', () => {
  const settings = { enabled: true, bonusAmount: 250 };

  it('names everyone tied on the highest gross premium', () => {
    expect(
      salespersonOfMonthWinners(settings, [
        { userId: 'b', grossPremium: 900 },
        { userId: 'a', grossPremium: 900 },
        { userId: 'c', grossPremium: 100 },
      ]),
    ).toEqual({ topGrossPremium: 900, winnerIds: ['a', 'b'] });
  });

  it('has no winner while off or when nobody sold', () => {
    expect(
      salespersonOfMonthWinners({ ...settings, enabled: false }, [
        { userId: 'a', grossPremium: 900 },
      ]),
    ).toEqual({ topGrossPremium: null, winnerIds: [] });
    expect(
      salespersonOfMonthWinners(settings, [{ userId: 'a', grossPremium: 0 }]),
    ).toEqual({
      topGrossPremium: null,
      winnerIds: [],
    });
  });
});

// ── The 2026 comp plans (6 Nov 2026) ────────────────────────────────────

/** One sale of `premium` on `carrier`, with `policies` policies. */
function bigSale(
  day: string,
  premium: number,
  options: {
    carrier?: string;
    policies?: number;
    enteredDay?: string;
    leadSourceId?: string | null;
  } = {},
): PayoutSale {
  const policies = options.policies ?? 1;
  const each = premium / policies;
  return {
    ...sale(
      day,
      options.leadSourceId ?? null,
      Array.from({ length: policies }, () => [
        options.carrier ?? 'Allstate',
        'Auto',
        each,
      ]),
    ),
    enteredDay: options.enteredDay ?? day,
  };
}

/** Inside Sales 2026: $2,500 base, 8% / 10% past $50,000, $1,500 at $100,000. */
const INSIDE: StatementRules = {
  ...STRUCTURE,
  rules: [
    {
      carrier: ANY_CARRIER,
      ratePercent: 8,
      minBundleRatePercent: null,
      stepBasis: 'premium',
      steps: [
        {
          threshold: 50_001,
          ratePercent: 10,
          bonusAmount: 0,
          minCompliancePercent: null,
          minBundleRatePercent: null,
        },
      ],
    },
  ],
  leadSourceRules: [],
  hatTrick: { enabled: false, dealsPerDay: 3, bonusAmount: 0 },
  individualTiers: [
    { thresholdPremium: 100_000, bonusAmount: 1500, minCompliancePercent: 95 },
  ],
  basePay: 2500,
};

/** Outside Sales 2026: 10% / 12% / 15%, the 15% gated on compliance and bundles. */
const OUTSIDE: StatementRules = {
  ...STRUCTURE,
  rules: [
    {
      carrier: ANY_CARRIER,
      ratePercent: 10,
      minBundleRatePercent: null,
      stepBasis: 'premium',
      steps: [
        {
          threshold: 50_000,
          ratePercent: 12,
          bonusAmount: 0,
          minCompliancePercent: null,
          minBundleRatePercent: null,
        },
        {
          threshold: 80_000,
          ratePercent: 15,
          bonusAmount: 0,
          minCompliancePercent: 95,
          minBundleRatePercent: 83,
        },
      ],
    },
  ],
  leadSourceRules: [],
  individualTiers: [],
  stipendAmounts: [2500, 2000, 1500],
};

describe('computeStatement — 2026 comp plans', () => {
  it('pays Inside Sales 8% on all of a $45,000 month, plus base pay', () => {
    const result = computeStatement(
      input({ structure: INSIDE, sales: [bigSale('2026-10-02', 45_000)] }),
    );
    expect(result.totals.grossCommission).toBe(3600);
    expect(result.totals.basePay).toBe(2500);
    expect(result.totals.netCommission).toBe(3600);
    expect(result.totals.netPay).toBe(6100);
    expect(result.premiumLines[0].rateStep).toBeNull();
  });

  it('pays 10% on all of a $76,000 month — not split-rate', () => {
    const result = computeStatement(
      input({ structure: INSIDE, sales: [bigSale('2026-10-02', 76_000)] }),
    );
    expect(result.premiumLines[0]).toMatchObject({
      ratePercent: 10,
      rateStep: 1,
      grossCommission: 7600,
    });
  });

  it('holds a compliance-gated tier back until the rate is entered', () => {
    const sales = [bigSale('2026-10-02', 100_000)];
    const pending = computeStatement(input({ structure: INSIDE, sales }));
    expect(pending.totals.tierBonus).toBe(0);
    expect(pending.warnings.join(' ')).toContain('$100,000 tier');
    expect(pending.warnings.join(' ')).toContain('not entered');

    const met = computeStatement(
      input({
        structure: INSIDE,
        sales,
        inputs: { ...EMPTY_STATEMENT_INPUTS, compliancePercent: 100 },
      }),
    );
    expect(met.totals.tierBonus).toBe(1500);
    expect(met.totals.netPay).toBe(2500 + 10_000 + 1500);
  });

  it("skips Outside's gated 15% step and pays the 12% step below it", () => {
    const sales = [
      bigSale('2026-10-02', 60_000),
      bigSale('2026-10-03', 30_000, { policies: 2 }),
    ];
    const result = computeStatement(
      input({
        structure: OUTSIDE,
        sales,
        inputs: { ...EMPTY_STATEMENT_INPUTS, compliancePercent: 98 },
      }),
    );
    expect(result.premiumLines[0]).toMatchObject({
      ratePercent: 12,
      rateStep: 1,
    });
    expect(result.warnings.join(' ')).toContain(
      'the 15% step at $80,000 is not paid — it needs a 83% bundle rate (this month: 50%)',
    );
  });

  it('pays the 15% step when compliance and bundles are both met', () => {
    const result = computeStatement(
      input({
        structure: OUTSIDE,
        sales: [
          bigSale('2026-10-02', 50_000, { policies: 2 }),
          bigSale('2026-10-03', 40_000, { policies: 3 }),
        ],
        inputs: { ...EMPTY_STATEMENT_INPUTS, compliancePercent: 95 },
      }),
    );
    expect(result.premiumLines[0]).toMatchObject({
      ratePercent: 15,
      rateStep: 2,
    });
    expect(result.totals.grossCommission).toBe(13_500);
  });

  it('pays the Launch Pad stipend by month since the start, then none', () => {
    const at = (month: string, startMonth: string | null) =>
      computeStatement(input({ structure: OUTSIDE, month, startMonth })).totals
        .stipend;
    expect(at('2026-09', '2026-09')).toBe(2500);
    expect(at('2026-10', '2026-09')).toBe(2000);
    expect(at('2026-11', '2026-09')).toBe(1500);
    expect(at('2026-12', '2026-09')).toBe(0);
    expect(at('2026-08', '2026-09')).toBe(0);
    const none = computeStatement(
      input({ structure: OUTSIDE, startMonth: null }),
    );
    expect(none.totals.stipend).toBe(0);
    expect(none.warnings).toContain(
      'No start month is set, so no stipend is paid.',
    );
  });

  it('below the compliance floor: base rates, no bonuses, 10% off variable pay', () => {
    const structure: StatementRules = {
      ...OUTSIDE,
      hatTrick: { enabled: true, dealsPerDay: 2, bonusAmount: 50 },
      individualTiers: [{ thresholdPremium: 10_000, bonusAmount: 300 }],
      basePay: 1000,
      complianceFloor: { minimumPercent: 85, reductionPercent: 10 },
    };
    const result = computeStatement(
      input({
        structure,
        startMonth: '2026-10',
        sales: [bigSale('2026-10-02', 30_000), bigSale('2026-10-02', 30_000)],
        inputs: { ...EMPTY_STATEMENT_INPUTS, compliancePercent: 80 },
        team: { ...NO_TEAM, eligible: true, met: true, amount: 400 },
        salespersonOfMonth: { enabled: true, bonusAmount: 200, winner: true },
      }),
    );
    // $60,000 at the 10% base, not the 12% step.
    expect(result.premiumLines[0].ratePercent).toBe(10);
    expect(result.totals).toMatchObject({
      grossCommission: 6000,
      hatTrickBonus: 0,
      tierBonus: 0,
      teamBonus: 0,
      somBonus: 0,
      complianceReduction: -600,
      netCommission: 5400,
      basePay: 1000,
      stipend: 2500,
      netPay: 8900,
    });
    expect(result.bonuses.teamBlocked?.[0]).toContain('below the 85% floor');
    expect(result.indicators.complianceStatus).toBe('non_compliant');
  });

  it('applies no floor penalty while the compliance rate is not entered', () => {
    const structure: StatementRules = {
      ...OUTSIDE,
      complianceFloor: { minimumPercent: 85, reductionPercent: 10 },
    };
    const result = computeStatement(
      input({ structure, sales: [bigSale('2026-10-02', 60_000)] }),
    );
    expect(result.totals.complianceReduction).toBe(0);
    expect(result.premiumLines[0].ratePercent).toBe(12);
  });

  describe('Client Relations Manager', () => {
    const CRM: StatementRules = {
      ...STRUCTURE,
      rules: [
        {
          carrier: 'Allstate',
          ratePercent: 0,
          minBundleRatePercent: null,
          stepBasis: 'retention',
          steps: [83, 86, 90].map((threshold, index) => ({
            threshold,
            ratePercent: [5, 6, 7.5][index],
            bonusAmount: threshold === 90 ? 500 : 0,
            minCompliancePercent: null,
            minBundleRatePercent: null,
          })),
        },
      ],
      leadSourceRules: [],
      individualTiers: [],
      basePay: 4000,
      referralRule: {
        minimum: 15,
        shortfallDeduction: 500,
        bonusThreshold: 40,
        bonusAmount: 500,
      },
      teamRequirements: { soldLogWithinDays: 1, meetingAttendance: true },
    };
    const sales = [bigSale('2026-10-02', 10_000)];

    it('pays the retention step reached, and its bonus at 90%', () => {
      const result = computeStatement(
        input({
          structure: CRM,
          sales,
          inputs: {
            ...EMPTY_STATEMENT_INPUTS,
            retentionPercent: 91,
            lifeReferrals: 20,
          },
        }),
      );
      expect(result.premiumLines[0]).toMatchObject({
        ratePercent: 7.5,
        rateStep: 3,
      });
      expect(result.totals.rateStepBonus).toBe(500);
      expect(result.totals.netPay).toBe(4000 + 750 + 500);
    });

    it('pays the base rate while retention is not entered', () => {
      const result = computeStatement(input({ structure: CRM, sales }));
      expect(result.premiumLines[0].ratePercent).toBe(0);
      expect(result.warnings.join(' ')).toContain('retention is not entered');
    });

    it('deducts $500 under 15 referrals and pays $500 at 40', () => {
      const at = (lifeReferrals: number | null) =>
        computeStatement(
          input({
            structure: CRM,
            inputs: { ...EMPTY_STATEMENT_INPUTS, lifeReferrals },
          }),
        ).totals.referralAdjustment;
      expect(at(14)).toBe(-500);
      expect(at(15)).toBe(0);
      expect(at(39)).toBe(0);
      expect(at(40)).toBe(500);
      expect(at(null)).toBe(0);
    });

    it('blocks the team share for a late Sold Log entry or no attendance', () => {
      const team = { ...NO_TEAM, eligible: true, met: true, amount: 300 };
      const late = computeStatement(
        input({
          structure: CRM,
          team,
          sales: [bigSale('2026-10-02', 5000, { enteredDay: '2026-10-05' })],
          inputs: { ...EMPTY_STATEMENT_INPUTS, meetingAttendance: true },
        }),
      );
      expect(late.totals.teamBonus).toBe(0);
      expect(late.bonuses.teamBlocked).toEqual([
        '1 sale was entered more than 1 day after the sold date.',
      ]);
      const onTime = computeStatement(
        input({
          structure: CRM,
          team,
          sales: [bigSale('2026-10-02', 5000, { enteredDay: '2026-10-03' })],
          inputs: { ...EMPTY_STATEMENT_INPUTS, meetingAttendance: true },
        }),
      );
      expect(onTime.totals.teamBonus).toBe(300);
      const unticked = computeStatement(input({ structure: CRM, team, sales }));
      expect(unticked.bonuses.teamBlocked).toEqual([
        'Sales meeting attendance is not entered.',
      ]);
    });
  });

  it("pays the Office Manager 1% of the office's premium and a bonus on Allstate's", () => {
    const structure: StatementRules = {
      ...STRUCTURE,
      rules: [
        { carrier: ANY_CARRIER, ratePercent: 0, minBundleRatePercent: null },
      ],
      leadSourceRules: [],
      individualTiers: [],
      basePay: 4000,
      overrides: [
        {
          basis: 'agency',
          leadSourceId: null,
          carrier: ANY_CARRIER,
          ratePercent: 1,
        },
      ],
      agencyTiers: [
        { thresholdPremium: 200_000, bonusAmount: 2000 },
        { thresholdPremium: 250_000, bonusAmount: 2500 },
        { thresholdPremium: 300_000, bonusAmount: 3000 },
      ],
      agencyTiersCarrier: 'Allstate',
    };
    const result = computeStatement(
      input({
        structure,
        agencySales: [
          {
            producerId: 'a',
            leadSourceId: null,
            carrier: 'Allstate',
            premium: 180_000,
          },
          {
            producerId: 'b',
            leadSourceId: GOOGLE,
            carrier: 'B4tEH',
            premium: 80_000,
          },
          {
            producerId: 'b',
            leadSourceId: null,
            carrier: 'Progressive',
            premium: 40_000,
          },
        ],
      }),
    );
    expect(result.totals.overrideCommission).toBe(3000);
    expect(result.bonuses.agency).toMatchObject({
      carrier: 'Allstate',
      premium: 260_000,
      reached: { thresholdPremium: 250_000, bonusAmount: 2500 },
      amount: 2500,
    });
    expect(result.totals.netPay).toBe(4000 + 3000 + 2500);
  });

  it('pays Outside Sales 1% of overflow other people sold from their lead source', () => {
    const structure: StatementRules = {
      ...OUTSIDE,
      overrides: [
        {
          basis: 'lead_source',
          leadSourceId: JYA,
          carrier: ANY_CARRIER,
          ratePercent: 1,
        },
      ],
    };
    const result = computeStatement(
      input({
        structure,
        userId: 'outside',
        agencySales: [
          {
            producerId: 'inside',
            leadSourceId: JYA,
            carrier: 'Allstate',
            premium: 20_000,
          },
          {
            producerId: 'outside',
            leadSourceId: JYA,
            carrier: 'Allstate',
            premium: 5000,
          },
          {
            producerId: 'inside',
            leadSourceId: GOOGLE,
            carrier: 'Allstate',
            premium: 9000,
          },
        ],
      }),
    );
    expect(result.bonuses.overrides?.[0]).toMatchObject({
      basis: 'lead_source',
      leadSourceName: 'JYA',
      premium: 20_000,
      amount: 200,
    });
  });

  it('leaves out a chargeback older than the structure window', () => {
    const structure: StatementRules = {
      ...STRUCTURE,
      chargebackWindowMonths: 6,
    };
    const old = {
      ...chargeback('cb-old', 'Allstate', null, 1000),
      occurredDay: '2026-03-20',
    };
    const recent = {
      ...chargeback('cb-new', 'Allstate', null, 500),
      occurredDay: '2026-04-02',
    };
    const result = computeStatement(
      input({ structure, chargebacks: [old, recent] }),
    );
    const byId = new Map(
      result.chargebacks.map((row) => [row.chargebackId, row]),
    );
    expect(byId.get('cb-old')).toMatchObject({
      excluded: true,
      excludedNote:
        'More than 6 months after the cancellation, so it is not charged.',
    });
    expect(byId.get('cb-new')?.excluded).toBe(false);
    expect(result.totals.chargebackTotal).toBe(500);
  });

  it('leaves base pay off for someone no longer active, and says so', () => {
    const result = computeStatement(
      input({ structure: INSIDE, basePayApplies: false }),
    );
    expect(result.totals.basePay).toBe(0);
    expect(result.warnings.join(' ')).toContain('Base pay is left off');
  });

  it('pays Producer of the Year to the winner', () => {
    const result = computeStatement(
      input({
        producerOfYear: { enabled: true, bonusAmount: 2500, winner: true },
      }),
    );
    expect(result.totals.producerOfYearBonus).toBe(2500);
    expect(result.totals.netPay).toBe(2500);
  });
});
