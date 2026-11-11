import {
  ANY_CARRIER,
  amountError,
  bonusTiersError,
  bundleMinimumFor,
  chargebackWindowError,
  EMPTY_STATEMENT_ENTERED_ADJUSTMENTS,
  enteredAdjustmentNotesOf,
  enteredAdjustmentsOf,
  MAX_STATEMENT_ADJUSTMENT_NOTE_LENGTH,
  memberStartsError,
  normalizeStatementText,
  statementEnteredAdjustmentsError,
  statementSignedPdfFilename,
  overridesError,
  referralRuleError,
  statementInputsError,
  statementInputsNeeded,
  stipendError,
  structurePlanDefaults,
  compareRuleCarriers,
  hatTrickError,
  importRowCounts,
  IMPORT_ROW_NOTE_LABELS,
  IMPORT_ROW_NOTES,
  isChargedResolution,
  levelsReached,
  leadSourceRuleCarrierLabel,
  leadSourceRulesError,
  MAX_RATE_RULES,
  normalizeLeadSourceRules,
  normalizeRateRules,
  percentError,
  rateFor,
  rateForCarrier,
  rateRulesError,
  sortBonusTiers,
  teamBonusError,
  teamLevelsError,
  teamPoolFor,
  teamSplitError,
  tierBonusFor,
  DEFAULT_TEAM_BONUS,
  type LeadSourceRateRule,
  type TeamBonusSettings,
} from './payouts';

/** Two `leadSources` ids, as the API stores them. */
const JYA = '6ab279758bded56c719a429b';
const MAIL_JYA = '6ab279758bded56c719a4285';

describe('the entered adjustments (10 Nov 2026)', () => {
  it('takes positive amounts, or none', () => {
    expect(
      statementEnteredAdjustmentsError({
        spiffs: 150,
        complianceAdjustment: 25.5,
        otherAdjustments: null,
      }),
    ).toBeNull();
    expect(
      statementEnteredAdjustmentsError({
        ...EMPTY_STATEMENT_ENTERED_ADJUSTMENTS,
        complianceAdjustment: -25,
      }),
    ).toBe('The compliance adjustment cannot be negative.');
    expect(
      statementEnteredAdjustmentsError({
        ...EMPTY_STATEMENT_ENTERED_ADJUSTMENTS,
        spiffs: 1.005,
      }),
    ).toBe('Other bonuses / SPIFFs has more than two decimals.');
  });

  it('reads the stored rows back as typed: deductions positive again', () => {
    expect(
      enteredAdjustmentsOf([
        { kind: 'spiff', amount: 100 },
        { kind: 'spiff', amount: 50.25 },
        { kind: 'compliance', amount: -40 },
        { kind: 'exclude_chargeback', amount: null },
      ]),
    ).toEqual({
      spiffs: 150.25,
      complianceAdjustment: 40,
      otherAdjustments: null,
    });
  });

  // PAC-182: a note on each amount.
  it('takes a note on an amount, and refuses one with no amount to explain', () => {
    expect(
      statementEnteredAdjustmentsError({
        ...EMPTY_STATEMENT_ENTERED_ADJUSTMENTS,
        spiffs: 150,
        notes: { spiffs: '  Q4 contest  ' },
      }),
    ).toBeNull();
    expect(
      statementEnteredAdjustmentsError({
        ...EMPTY_STATEMENT_ENTERED_ADJUSTMENTS,
        notes: { otherAdjustments: 'Parking' },
      }),
    ).toBe('Other adjustments: enter an amount for the note to explain.');
    expect(
      statementEnteredAdjustmentsError({
        ...EMPTY_STATEMENT_ENTERED_ADJUSTMENTS,
        complianceAdjustment: 0,
        notes: { complianceAdjustment: 'Nothing' },
      }),
    ).toBe(
      'The compliance adjustment: enter an amount for the note to explain.',
    );
    expect(
      statementEnteredAdjustmentsError({
        ...EMPTY_STATEMENT_ENTERED_ADJUSTMENTS,
        spiffs: 10,
        notes: { spiffs: 'x'.repeat(MAX_STATEMENT_ADJUSTMENT_NOTE_LENGTH + 1) },
      }),
    ).toBe(
      `The note on other bonuses / SPIFFs is longer than ${MAX_STATEMENT_ADJUSTMENT_NOTE_LENGTH} characters.`,
    );
    // Blank is no note.
    expect(
      statementEnteredAdjustmentsError({
        ...EMPTY_STATEMENT_ENTERED_ADJUSTMENTS,
        notes: { spiffs: '   ' },
      }),
    ).toBeNull();
  });

  it('reads the notes back from the rows that carry an amount', () => {
    expect(
      enteredAdjustmentNotesOf([
        { kind: 'spiff', amount: 100, note: 'Q4 contest' },
        { kind: 'compliance', amount: -40, note: '' },
        { kind: 'exclude_chargeback', amount: null, note: 'Rewritten' },
      ]),
    ).toEqual({
      spiffs: 'Q4 contest',
      complianceAdjustment: '',
      otherAdjustments: '',
    });
  });
});

describe('statement text (PAC-182)', () => {
  it('stores line breaks as \\n and trims the ends', () => {
    expect(normalizeStatementText('  one\r\ntwo\rthree\n ')).toBe(
      'one\ntwo\nthree',
    );
  });

  it('names a signed copy after its version', () => {
    expect(statementSignedPdfFilename('2026-10', 3)).toBe(
      'commission-statement-2026-10-v3-signed.pdf',
    );
  });
});

describe('amountError / percentError', () => {
  it('accepts cents and refuses a third decimal', () => {
    expect(amountError(50, 'Bonus')).toBeNull();
    expect(amountError(49.99, 'Bonus')).toBeNull();
    expect(amountError(10.005, 'Bonus')).toBe(
      'Bonus has more than two decimals.',
    );
  });

  it('refuses negatives, NaN and absurd amounts', () => {
    expect(amountError(-1, 'Bonus')).toBe('Bonus cannot be negative.');
    expect(amountError(Number.NaN, 'Bonus')).toBe('Bonus must be a number.');
    expect(amountError(20_000_000, 'Bonus')).toMatch(/cannot be more than/);
  });

  it('bounds a percentage to 0–100', () => {
    expect(percentError(0, 'Rate')).toBeNull();
    expect(percentError(12.5, 'Rate')).toBeNull();
    expect(percentError(100, 'Rate')).toBeNull();
    expect(percentError(100.01, 'Rate')).toBe(
      'Rate must be between 0 and 100.',
    );
    expect(percentError(-0.5, 'Rate')).toBe('Rate must be between 0 and 100.');
  });
});

describe('rateRulesError', () => {
  it('accepts per-carrier rates plus one catch-all', () => {
    expect(
      rateRulesError([
        { carrier: 'Allstate', ratePercent: 10 },
        { carrier: 'Progressive', ratePercent: 7.5 },
        { carrier: ANY_CARRIER, ratePercent: 5 },
      ]),
    ).toBeNull();
  });

  it('needs at least one rate', () => {
    expect(rateRulesError([])).toBe('Add at least one commission rate.');
  });

  it('treats a migrated carrier code as the carrier it names', () => {
    // `B4tEH` is how 1,700 migrated policies spell Allstate.
    expect(
      rateRulesError([
        { carrier: 'Allstate', ratePercent: 10 },
        { carrier: 'B4tEH', ratePercent: 12 },
      ]),
    ).toBe('Allstate has more than one rate.');
  });

  it('treats spacing and case as the same carrier', () => {
    expect(
      rateRulesError([
        { carrier: 'State Farm', ratePercent: 10 },
        { carrier: '  state farm ', ratePercent: 12 },
      ]),
    ).toBe('State Farm has more than one rate.');
  });

  it('allows one catch-all only', () => {
    expect(
      rateRulesError([
        { carrier: ANY_CARRIER, ratePercent: 5 },
        { carrier: ` ${ANY_CARRIER} `, ratePercent: 6 },
      ]),
    ).toBe('Only one "any other carrier" rate is allowed.');
  });

  it('refuses a blank carrier and an out-of-range rate', () => {
    expect(rateRulesError([{ carrier: '  ', ratePercent: 5 }])).toBe(
      'Every rate needs a carrier.',
    );
    expect(rateRulesError([{ carrier: 'Allstate', ratePercent: 101 }])).toBe(
      'The Allstate rate must be between 0 and 100.',
    );
  });

  it('accepts a minimum bundle rate on any rule, and none', () => {
    expect(
      rateRulesError([
        { carrier: 'Allstate', ratePercent: 10, minBundleRatePercent: 83 },
        { carrier: 'Progressive', ratePercent: 7, minBundleRatePercent: null },
        { carrier: ANY_CARRIER, ratePercent: 5, minBundleRatePercent: 50.5 },
      ]),
    ).toBeNull();
  });

  it('needs a minimum bundle rate above 0% and at most 100%', () => {
    expect(
      rateRulesError([
        { carrier: 'Allstate', ratePercent: 10, minBundleRatePercent: 0 },
      ]),
    ).toBe('The Allstate minimum bundle rate must be more than 0%.');
    expect(
      rateRulesError([
        { carrier: ANY_CARRIER, ratePercent: 5, minBundleRatePercent: 101 },
      ]),
    ).toBe(
      'The "any other carrier" minimum bundle rate must be between 0 and 100.',
    );
    expect(
      rateRulesError([
        { carrier: 'Allstate', ratePercent: 10, minBundleRatePercent: 83.333 },
      ]),
    ).toBe('The Allstate minimum bundle rate has more than two decimals.');
  });
});

describe('bonusTiersError', () => {
  const flat = { stackable: false };
  const stacked = { stackable: true };

  it('accepts no tiers, and ascending tiers given in any order', () => {
    expect(bonusTiersError([], flat)).toBeNull();
    expect(
      bonusTiersError(
        [
          { thresholdPremium: 50_000, bonusAmount: 500 },
          { thresholdPremium: 25_000, bonusAmount: 250 },
        ],
        flat,
      ),
    ).toBeNull();
  });

  it('refuses two tiers on one threshold, stacking or not', () => {
    for (const options of [flat, stacked]) {
      expect(
        bonusTiersError(
          [
            { thresholdPremium: 25_000, bonusAmount: 250 },
            { thresholdPremium: 25_000, bonusAmount: 300 },
          ],
          options,
        ),
      ).toBe('Two tiers have the same threshold.');
    }
  });

  it('refuses a higher tier that pays less only when tiers do not stack', () => {
    const tiers = [
      { thresholdPremium: 25_000, bonusAmount: 250 },
      { thresholdPremium: 50_000, bonusAmount: 100 },
    ];
    expect(bonusTiersError(tiers, flat)).toBe(
      'A higher tier cannot pay less than the tier below it, unless the tiers stack.',
    );
    // Stacked, the $100 is extra on top of the $250.
    expect(bonusTiersError(tiers, stacked)).toBeNull();
  });

  it('refuses a zero threshold', () => {
    expect(
      bonusTiersError([{ thresholdPremium: 0, bonusAmount: 10 }], flat),
    ).toBe('A tier threshold must be more than $0.');
  });
});

describe('tierBonusFor / levelsReached', () => {
  const tiers = [
    { thresholdPremium: 50_000, bonusAmount: 500 },
    { thresholdPremium: 25_000, bonusAmount: 250.5 },
  ];

  it('pays only the highest tier reached when tiers do not stack', () => {
    expect(tierBonusFor(tiers, false, 24_999.99)).toBe(0);
    expect(tierBonusFor(tiers, false, 25_000)).toBe(250.5);
    expect(tierBonusFor(tiers, false, 60_000)).toBe(500);
  });

  it('adds up every tier reached when they stack', () => {
    expect(tierBonusFor(tiers, true, 24_999.99)).toBe(0);
    expect(tierBonusFor(tiers, true, 25_000)).toBe(250.5);
    expect(tierBonusFor(tiers, true, 60_000)).toBe(750.5);
  });

  it('lists the levels that count, lowest first', () => {
    const amount = (t: { bonusAmount: number }) => t.bonusAmount;
    expect(
      levelsReached(tiers, 60_000, true, amount).levels.map(
        (t) => t.thresholdPremium,
      ),
    ).toEqual([25_000, 50_000]);
    expect(
      levelsReached(tiers, 60_000, false, amount).levels.map(
        (t) => t.thresholdPremium,
      ),
    ).toEqual([50_000]);
    expect(levelsReached(tiers, 10, true, amount).levels).toEqual([]);
  });
});

describe('hatTrickError', () => {
  it('needs a whole number of sales from 2 to 20', () => {
    expect(
      hatTrickError({ enabled: true, dealsPerDay: 3, bonusAmount: 50 }),
    ).toBeNull();
    expect(
      hatTrickError({ enabled: true, dealsPerDay: 1, bonusAmount: 50 }),
    ).toMatch(/whole number from 2 to 20/);
    expect(
      hatTrickError({ enabled: true, dealsPerDay: 2.5, bonusAmount: 50 }),
    ).toMatch(/whole number/);
  });
});

describe('teamSplitError / teamBonusError', () => {
  it('needs the shares to add up to 100', () => {
    expect(teamSplitError(20, 80)).toBeNull();
    expect(teamSplitError(12.5, 87.5)).toBeNull();
    expect(teamSplitError(20, 70)).toBe(
      'The CSR and producer shares must add up to 100%.',
    );
  });

  it('accepts the defaults', () => {
    expect(teamBonusError(DEFAULT_TEAM_BONUS)).toBeNull();
  });

  it('checks the levels too', () => {
    expect(
      teamBonusError({
        ...DEFAULT_TEAM_BONUS,
        levels: [{ thresholdPremium: 300_000, poolAmount: -5 }],
      }),
    ).toBe('A level pool cannot be negative.');
    expect(
      teamBonusError({
        ...DEFAULT_TEAM_BONUS,
        levels: [
          { thresholdPremium: 300_000, poolAmount: 3_000 },
          { thresholdPremium: 300_000, poolAmount: 3_000 },
        ],
      }),
    ).toBe('Two levels have the same threshold.');
  });

  it('needs a level while the bonus is on, and none while it is off', () => {
    expect(teamLevelsError([], { enabled: true, stackable: false })).toBe(
      'Add at least one team bonus level.',
    );
    expect(
      teamLevelsError([], { enabled: false, stackable: false }),
    ).toBeNull();
  });

  it('lets a higher level add a smaller pool only when levels stack', () => {
    const levels = [
      { thresholdPremium: 300_000, poolAmount: 3_000 },
      { thresholdPremium: 350_000, poolAmount: 1_000 },
    ];
    expect(teamLevelsError(levels, { enabled: true, stackable: false })).toBe(
      'A higher level cannot pay less than the level below it, unless the levels stack.',
    );
    expect(
      teamLevelsError(levels, { enabled: true, stackable: true }),
    ).toBeNull();
  });
});

describe('teamPoolFor', () => {
  // The owner's example: $300,000 → $3,000, and another $3,000 at $350,000.
  const team: TeamBonusSettings = {
    ...DEFAULT_TEAM_BONUS,
    enabled: true,
    stackable: true,
    levels: [
      { thresholdPremium: 350_000, poolAmount: 3_000 },
      { thresholdPremium: 300_000, poolAmount: 3_000 },
    ],
  };

  it('adds up the pools of every level reached when levels stack', () => {
    expect(teamPoolFor(team, 299_999)).toBe(0);
    expect(teamPoolFor(team, 300_000)).toBe(3_000);
    expect(teamPoolFor(team, 360_000)).toBe(6_000);
  });

  it('pays the highest level reached when they do not', () => {
    expect(teamPoolFor({ ...team, stackable: false }, 360_000)).toBe(3_000);
  });

  it('pays nothing while the bonus is off', () => {
    expect(teamPoolFor({ ...team, enabled: false }, 1_000_000)).toBe(0);
  });
});

describe('bundleMinimumFor', () => {
  const rules = [
    { carrier: 'Allstate', ratePercent: 10, minBundleRatePercent: 83 },
    { carrier: 'Progressive', ratePercent: 7, minBundleRatePercent: null },
    { carrier: ANY_CARRIER, ratePercent: 5, minBundleRatePercent: 50 },
  ];

  it('uses the carrier’s own rule, whatever the spelling', () => {
    expect(bundleMinimumFor(rules, 'Allstate')).toBe(83);
    expect(bundleMinimumFor(rules, 'B4tEH')).toBe(83);
  });

  it('does not check a carrier whose own rule has no minimum', () => {
    expect(bundleMinimumFor(rules, 'Progressive')).toBeNull();
  });

  it('falls back to the catch-all for other carriers and none', () => {
    expect(bundleMinimumFor(rules, 'Travelers')).toBe(50);
    expect(bundleMinimumFor(rules, null)).toBe(50);
    expect(
      bundleMinimumFor([{ carrier: 'Allstate', ratePercent: 10 }], 'Travelers'),
    ).toBeNull();
  });
});

describe('normalizeRateRules / sortBonusTiers', () => {
  it('canonicalises carriers, puts the catch-all last and always sends the minimum', () => {
    expect(
      normalizeRateRules([
        { carrier: ANY_CARRIER, ratePercent: 5 },
        {
          carrier: ' Progressive ',
          ratePercent: 7,
          minBundleRatePercent: null,
        },
        { carrier: 'B4tEH', ratePercent: 10, minBundleRatePercent: 83 },
      ]),
    ).toEqual(
      [
        { carrier: 'Allstate', ratePercent: 10, minBundleRatePercent: 83 },
        { carrier: 'Progressive', ratePercent: 7, minBundleRatePercent: null },
        { carrier: ANY_CARRIER, ratePercent: 5, minBundleRatePercent: null },
      ].map((rule) => ({ ...rule, stepBasis: 'premium', steps: [] })),
    );
  });

  it('sorts tiers by threshold', () => {
    expect(
      sortBonusTiers([
        { thresholdPremium: 50_000, bonusAmount: 500 },
        { thresholdPremium: 25_000, bonusAmount: 250 },
      ]).map((tier) => tier.thresholdPremium),
    ).toEqual([25_000, 50_000]);
  });
});

describe('rateForCarrier', () => {
  const rules = [
    { carrier: 'Allstate', ratePercent: 10 },
    { carrier: ANY_CARRIER, ratePercent: 5 },
  ];

  it('uses the carrier’s own rule first, whatever the spelling', () => {
    expect(rateForCarrier(rules, 'Allstate')).toEqual({
      ratePercent: 10,
      source: 'carrier',
    });
    expect(rateForCarrier(rules, 'B4tEH')).toEqual({
      ratePercent: 10,
      source: 'carrier',
    });
  });

  it('falls back to the catch-all, including for a policy with no carrier', () => {
    expect(rateForCarrier(rules, 'Progressive')).toEqual({
      ratePercent: 5,
      source: 'any',
    });
    expect(rateForCarrier(rules, null)).toEqual({
      ratePercent: 5,
      source: 'any',
    });
  });

  it('returns null when nothing covers the carrier', () => {
    expect(
      rateForCarrier([{ carrier: 'Allstate', ratePercent: 10 }], 'Progressive'),
    ).toBeNull();
  });
});

describe('leadSourceRulesError', () => {
  it('accepts none', () => {
    expect(leadSourceRulesError([])).toBeNull();
  });

  it('accepts one source by carrier plus any carrier, and two sources on one carrier', () => {
    expect(
      leadSourceRulesError([
        { leadSourceId: JYA, carrier: 'Allstate', ratePercent: 6 },
        { leadSourceId: JYA, carrier: ANY_CARRIER, ratePercent: 5 },
        { leadSourceId: MAIL_JYA, carrier: ANY_CARRIER, ratePercent: 5 },
        { leadSourceId: MAIL_JYA, carrier: 'Allstate', ratePercent: 4.25 },
      ]),
    ).toBeNull();
  });

  it('refuses two rates for one source and carrier, whatever the carrier spelling', () => {
    expect(
      leadSourceRulesError([
        { leadSourceId: JYA, carrier: 'Allstate', ratePercent: 6 },
        { leadSourceId: MAIL_JYA, carrier: 'Allstate', ratePercent: 6 },
        { leadSourceId: JYA, carrier: 'B4tEH', ratePercent: 7 },
      ]),
    ).toBe(
      'Lead-source rates 1 and 3 both set a rate for Allstate from the same lead source.',
    );
    expect(
      leadSourceRulesError([
        { leadSourceId: JYA, carrier: 'State Farm', ratePercent: 6 },
        { leadSourceId: JYA, carrier: '  state farm ', ratePercent: 7 },
      ]),
    ).toBe(
      'Lead-source rates 1 and 2 both set a rate for State Farm from the same lead source.',
    );
  });

  it('refuses two "any carrier" rates for one source, matching ids case-insensitively', () => {
    expect(
      leadSourceRulesError([
        { leadSourceId: JYA, carrier: ANY_CARRIER, ratePercent: 5 },
        {
          leadSourceId: JYA.toUpperCase(),
          carrier: ` ${ANY_CARRIER} `,
          ratePercent: 6,
        },
      ]),
    ).toBe(
      'Lead-source rates 1 and 2 both set a rate for any carrier from the same lead source.',
    );
  });

  it('needs a source, a carrier and a rate in range', () => {
    expect(
      leadSourceRulesError([
        { leadSourceId: JYA, carrier: ANY_CARRIER, ratePercent: 5 },
        { leadSourceId: '  ', carrier: ANY_CARRIER, ratePercent: 5 },
      ]),
    ).toBe('Lead-source rate 2 needs a lead source.');
    expect(
      leadSourceRulesError([
        { leadSourceId: JYA, carrier: ' ', ratePercent: 5 },
      ]),
    ).toBe('Lead-source rate 1 needs a carrier.');
    expect(
      leadSourceRulesError([
        { leadSourceId: JYA, carrier: ANY_CARRIER, ratePercent: 100.5 },
      ]),
    ).toBe('Lead-source rate 1 must be between 0 and 100.');
    expect(
      leadSourceRulesError([
        { leadSourceId: JYA, carrier: ANY_CARRIER, ratePercent: 5.125 },
      ]),
    ).toBe('Lead-source rate 1 has more than two decimals.');
  });

  it(`allows at most ${MAX_RATE_RULES}`, () => {
    const rules: LeadSourceRateRule[] = Array.from(
      { length: MAX_RATE_RULES + 1 },
      (_, index) => ({
        leadSourceId: index.toString(16).padStart(24, '0'),
        carrier: ANY_CARRIER,
        ratePercent: 5,
      }),
    );
    expect(leadSourceRulesError(rules.slice(0, MAX_RATE_RULES))).toBeNull();
    expect(leadSourceRulesError(rules)).toBe(
      `A structure has at most ${MAX_RATE_RULES} lead-source rates.`,
    );
  });
});

describe('normalizeLeadSourceRules', () => {
  it('canonicalises carriers and ids, grouped by source with "any carrier" last', () => {
    expect(
      normalizeLeadSourceRules([
        {
          leadSourceId: ` ${JYA.toUpperCase()} `,
          carrier: ANY_CARRIER,
          ratePercent: 5,
        },
        { leadSourceId: MAIL_JYA, carrier: ANY_CARRIER, ratePercent: 4 },
        { leadSourceId: JYA, carrier: 'B4tEH', ratePercent: 6 },
        { leadSourceId: JYA, carrier: ' Progressive ', ratePercent: 3 },
      ]),
    ).toEqual([
      { leadSourceId: MAIL_JYA, carrier: ANY_CARRIER, ratePercent: 4 },
      { leadSourceId: JYA, carrier: 'Allstate', ratePercent: 6 },
      { leadSourceId: JYA, carrier: 'Progressive', ratePercent: 3 },
      { leadSourceId: JYA, carrier: ANY_CARRIER, ratePercent: 5 },
    ]);
  });

  it('orders carriers by name with the catch-all last', () => {
    expect(
      [ANY_CARRIER, 'Progressive', 'Allstate'].sort(compareRuleCarriers),
    ).toEqual(['Allstate', 'Progressive', ANY_CARRIER]);
  });
});

describe('rateFor', () => {
  const rules = [
    { carrier: 'Allstate', ratePercent: 10 },
    { carrier: ANY_CARRIER, ratePercent: 5 },
  ];
  const leadSourceRules: LeadSourceRateRule[] = [
    { leadSourceId: JYA, carrier: 'Allstate', ratePercent: 3 },
    { leadSourceId: JYA, carrier: ANY_CARRIER, ratePercent: 2 },
    // Mail-JYA pays differently on Allstate only.
    { leadSourceId: MAIL_JYA, carrier: 'Allstate', ratePercent: 4 },
  ];
  const sale = (carrier: string | null, leadSourceId: string | null) =>
    rateFor(rules, leadSourceRules, { carrier, leadSourceId });

  it('1. lead source + carrier beats every other rule', () => {
    expect(sale('Allstate', JYA)).toEqual({
      ratePercent: 3,
      source: 'lead_source_carrier',
    });
    // Whatever the spelling of the carrier or the case of the id.
    expect(sale('B4tEH', JYA.toUpperCase())).toEqual({
      ratePercent: 3,
      source: 'lead_source_carrier',
    });
  });

  it('2. lead source + any carrier beats the carrier rates', () => {
    expect(sale('Progressive', JYA)).toEqual({
      ratePercent: 2,
      source: 'lead_source',
    });
    // A sale with no carrier from the source still takes the source's rate.
    expect(sale(null, JYA)).toEqual({ ratePercent: 2, source: 'lead_source' });
  });

  it('3. the carrier rate, for a source whose rules name other carriers only', () => {
    expect(sale('Allstate', MAIL_JYA)).toEqual({
      ratePercent: 4,
      source: 'lead_source_carrier',
    });
    expect(
      rateFor(
        [{ carrier: 'Progressive', ratePercent: 8 }, ...rules],
        leadSourceRules,
        { carrier: 'Progressive', leadSourceId: MAIL_JYA },
      ),
    ).toEqual({ ratePercent: 8, source: 'carrier' });
  });

  it('3. the carrier rate, for a sale with no source or a source with no rule', () => {
    expect(sale('Allstate', null)).toEqual({
      ratePercent: 10,
      source: 'carrier',
    });
    expect(sale('Allstate', '6ab279758bded56c719a4271')).toEqual({
      ratePercent: 10,
      source: 'carrier',
    });
  });

  it('4. the "any other carrier" rate last', () => {
    expect(sale('Progressive', MAIL_JYA)).toEqual({
      ratePercent: 5,
      source: 'any',
    });
    expect(sale('Progressive', null)).toEqual({
      ratePercent: 5,
      source: 'any',
    });
    expect(sale(null, MAIL_JYA)).toEqual({ ratePercent: 5, source: 'any' });
  });

  it('is null only when no rule covers the sale', () => {
    const allstateOnly = [{ carrier: 'Allstate', ratePercent: 10 }];
    expect(
      rateFor(allstateOnly, leadSourceRules, {
        carrier: 'Progressive',
        leadSourceId: MAIL_JYA,
      }),
    ).toBeNull();
    // A source's "any carrier" rule covers what the carrier rules do not.
    expect(
      rateFor(allstateOnly, leadSourceRules, {
        carrier: 'Progressive',
        leadSourceId: JYA,
      }),
    ).toEqual({ ratePercent: 2, source: 'lead_source' });
  });

  it('is rateForCarrier when the structure has no lead-source rules', () => {
    for (const carrier of ['Allstate', 'B4tEH', 'Progressive', null]) {
      expect(rateFor(rules, [], { carrier, leadSourceId: JYA })).toEqual(
        rateForCarrier(rules, carrier),
      );
    }
  });

  it('reads "any carrier" for a lead-source rule, not "any other carrier"', () => {
    expect(leadSourceRuleCarrierLabel(ANY_CARRIER)).toBe('Any carrier');
    expect(leadSourceRuleCarrierLabel('B4tEH')).toBe('Allstate');
  });
});

describe('importRowCounts', () => {
  it('tallies each resolution and totals only the lines a commit writes, in cents', () => {
    const counts = importRowCounts([
      { resolution: 'matched', amount: 0.1 },
      { resolution: 'matched', amount: 0.2 },
      { resolution: 'assigned', amount: 1829.93 },
      { resolution: 'unmatched', amount: 500 },
      { resolution: 'skipped', amount: 40 },
      { resolution: 'duplicate', amount: 303.85 },
    ]);
    expect(counts).toEqual({
      rows: 6,
      matched: 2,
      assigned: 1,
      unmatched: 1,
      skipped: 1,
      duplicate: 1,
      toCharge: 3,
      amountToCharge: 1830.23,
    });
  });

  it('is all zeros for an empty report', () => {
    expect(importRowCounts([])).toMatchObject({
      rows: 0,
      toCharge: 0,
      amountToCharge: 0,
    });
  });

  it('charges matched and assigned lines only', () => {
    expect(isChargedResolution('matched')).toBe(true);
    expect(isChargedResolution('assigned')).toBe(true);
    expect(isChargedResolution('duplicate')).toBe(false);
    expect(isChargedResolution('skipped')).toBe(false);
    expect(isChargedResolution('unmatched')).toBe(false);
  });

  it('labels every note', () => {
    for (const note of IMPORT_ROW_NOTES) {
      expect(IMPORT_ROW_NOTE_LABELS[note]).toBeTruthy();
    }
  });
});

// ── The 2026 comp plans (6 Nov 2026) ────────────────────────────────────

describe('2026 comp-plan validators', () => {
  const step = (threshold: number, ratePercent: number) => ({
    threshold,
    ratePercent,
    bonusAmount: 0,
    minCompliancePercent: null,
    minBundleRatePercent: null,
  });

  it('accepts a stepped rate and refuses one that steps down', () => {
    expect(
      rateRulesError([
        {
          carrier: ANY_CARRIER,
          ratePercent: 10,
          steps: [step(50_000, 12), step(80_000, 15)],
        },
      ]),
    ).toBeNull();
    expect(
      rateRulesError([
        {
          carrier: ANY_CARRIER,
          ratePercent: 10,
          steps: [step(50_000, 15), step(80_000, 12)],
        },
      ]),
    ).toBe(
      'The "any other carrier" rate: a higher step cannot pay a lower rate than the step below it.',
    );
    expect(
      rateRulesError([
        { carrier: 'Allstate', ratePercent: 10, steps: [step(50_000, 8)] },
      ]),
    ).toBe(
      'The Allstate rate, step 1 cannot pay less than the base rate of 10%.',
    );
    expect(
      rateRulesError([
        {
          carrier: 'Allstate',
          ratePercent: 0,
          stepBasis: 'retention',
          steps: [step(120, 5)],
        },
      ]),
    ).toBe(
      'The Allstate rate, step 1: the retention must be between 0 and 100.',
    );
  });

  it('checks gates, overrides, referrals and windows', () => {
    expect(
      bonusTiersError(
        [{ thresholdPremium: 1, bonusAmount: 1, minCompliancePercent: 0 }],
        {
          stackable: false,
        },
      ),
    ).toBe('A tier minimum compliance rate must be more than 0%.');
    expect(
      overridesError([
        {
          basis: 'lead_source',
          leadSourceId: null,
          carrier: ANY_CARRIER,
          ratePercent: 1,
        },
      ]),
    ).toBe('Override 1 needs a lead source.');
    expect(
      overridesError([
        {
          basis: 'agency',
          leadSourceId: null,
          carrier: ANY_CARRIER,
          ratePercent: 1,
        },
        { basis: 'agency', leadSourceId: null, carrier: '*', ratePercent: 2 },
      ]),
    ).toBe('Override 2 repeats an earlier override.');
    expect(
      referralRuleError({
        minimum: 15,
        shortfallDeduction: 500,
        bonusThreshold: 10,
        bonusAmount: 500,
      }),
    ).toBe('The referral bonus threshold must be above the minimum.');
    expect(chargebackWindowError(6)).toBeNull();
    expect(chargebackWindowError(0)).toContain('from 1 to 36');
    expect(stipendError([2500, 2000, 1500])).toBeNull();
    expect(memberStartsError([{ userId: 'a', startMonth: '2026-13' }])).toBe(
      'A start month must be in YYYY-MM form.',
    );
    expect(
      statementInputsError({
        compliancePercent: 96,
        retentionPercent: null,
        lifeReferrals: 2.5,
        meetingAttendance: null,
      }),
    ).toContain('Life referrals must be a whole number');
  });

  it('asks only for the figures a structure reads', () => {
    expect(
      statementInputsNeeded({
        rules: [
          {
            carrier: 'Allstate',
            ratePercent: 0,
            stepBasis: 'retention',
            steps: [{ ...step(83, 5) }],
          },
        ],
        individualTiers: [],
        complianceFloor: null,
        referralRule: null,
        teamRequirements: { soldLogWithinDays: 1, meetingAttendance: true },
        teamBonusEligible: true,
      }),
    ).toEqual({
      compliance: false,
      retention: true,
      referrals: false,
      attendance: true,
    });
  });

  it('fills defaults for a structure saved before the plan parts', () => {
    expect(structurePlanDefaults({})).toEqual({
      basePay: 0,
      stipendAmounts: [],
      memberStarts: [],
      complianceFloor: null,
      overrides: [],
      agencyTiers: [],
      agencyTiersCarrier: ANY_CARRIER,
      teamRequirements: { soldLogWithinDays: null, meetingAttendance: false },
      referralRule: null,
      chargebackWindowMonths: null,
    });
  });
});
