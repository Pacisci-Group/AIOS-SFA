import {
  RECONCILIATION_OUTCOME_KIND_LABELS,
  RECONCILIATION_OUTCOME_KINDS,
  RECONCILIATION_OUTCOME_RESOLUTION,
  RECONCILIATION_OUTCOME_RESOLUTIONS,
  RECONCILIATION_OUTCOME_STEP_LABELS,
  RECONCILIATION_OUTCOME_STEPS,
  RECONCILIATION_PRODUCER_KEY_PATTERN,
  RECONCILIATION_RESOLUTION_LABELS,
  RECONCILIATION_RESOLUTIONS,
  RECONCILIATION_RESOLUTIONS_BY_TAB,
  RECONCILIATION_TABS,
  RECONCILIATION_SALE_OUTCOME_KINDS,
  RETIRED_RECONCILIATION_RESOLUTIONS,
  canRecordReconciliationSale,
  canSetUpReconciliationService,
  primaryReconciliationTab,
  reconciliationOutcomeKinds,
  reconciliationPremiumDelta,
} from './carrier-reconciliation';

describe('RECONCILIATION_PRODUCER_KEY_PATTERN', () => {
  it.each([
    'user:6a95f0c1d2e3f4a5b6c7d8e9',
    'code:034',
    'bind:SOK35W06',
    'bind:SJM-RCM',
    'none',
  ])('accepts %s', (key) => {
    expect(RECONCILIATION_PRODUCER_KEY_PATTERN.test(key)).toBe(true);
  });

  it.each(['user:pat', 'bind:', 'bind:SOK 35W06', 'everyone'])(
    'refuses %s',
    (key) => {
      expect(RECONCILIATION_PRODUCER_KEY_PATTERN.test(key)).toBe(false);
    },
  );
});

describe('reconciliationPremiumDelta', () => {
  it('compares to the cent: 1234.5 and 1234.50 agree', () => {
    expect(reconciliationPremiumDelta(1234.5, 1234.5)).toBe(0);
    expect(reconciliationPremiumDelta(1234.5, 1234.501)).toBe(0);
  });

  it('reads one cent apart as a difference, app minus Dash', () => {
    expect(reconciliationPremiumDelta(1234.5, 1234.51)).toBe(0.01);
    expect(reconciliationPremiumDelta(1234.51, 1234.5)).toBe(-0.01);
  });

  it('never lets float noise through', () => {
    // 0.1 + 0.2 is 0.30000000000000004.
    expect(reconciliationPremiumDelta(0.1 + 0.2, 0.3)).toBe(0);
    expect(reconciliationPremiumDelta(1928, 1928.01)).toBe(0.01);
  });

  it('is null unless both sides have a premium', () => {
    expect(reconciliationPremiumDelta(null, 100)).toBeNull();
    expect(reconciliationPremiumDelta(100, undefined)).toBeNull();
  });
});

describe('tabs', () => {
  it('are listed in the order the page shows them', () => {
    expect(RECONCILIATION_TABS).toEqual([
      'missing_from_app',
      'not_in_dash',
      'review_1800',
      'premium_mismatch',
      'producer_mismatch',
      'matched',
      'ignored',
    ]);
  });
});

describe('resolutions', () => {
  it('offers each tab its own decisions', () => {
    expect(RECONCILIATION_RESOLUTIONS_BY_TAB.premium_mismatch).toEqual([
      'premium_corrected',
      'carrier_figure_wrong',
      'other',
    ]);
    expect(RECONCILIATION_RESOLUTIONS_BY_TAB.review_1800).toEqual([
      'service_set_up',
      'not_ours',
      'other',
    ]);
  });

  it('offers on every tab only resolutions a review may set', () => {
    for (const tab of RECONCILIATION_TABS) {
      for (const resolution of RECONCILIATION_RESOLUTIONS_BY_TAB[tab]) {
        expect(RECONCILIATION_RESOLUTIONS).toContain(resolution);
      }
    }
  });

  it('no longer offers confirmed_1800, but still labels it', () => {
    expect(RECONCILIATION_RESOLUTIONS).not.toContain('confirmed_1800');
    expect(RETIRED_RECONCILIATION_RESOLUTIONS).toContain('confirmed_1800');
    expect(RECONCILIATION_RESOLUTION_LABELS.confirmed_1800).toBe(
      'Confirmed 1-800 policy',
    );
  });
});

describe('primaryReconciliationTab', () => {
  it('names the tab that asks for the work, not "Matched"', () => {
    expect(primaryReconciliationTab(['matched', 'premium_mismatch'])).toBe(
      'premium_mismatch',
    );
    expect(primaryReconciliationTab(['ignored', 'review_1800'])).toBe(
      'review_1800',
    );
    expect(primaryReconciliationTab([])).toBeNull();
  });
});

describe('outcomes', () => {
  it('lets a missing Dash sale be Sold, a Cancel rewrite, a Chargeback or Other', () => {
    expect(
      reconciliationOutcomeKinds({
        tabs: ['missing_from_app'],
        match: 'dash_only',
      }),
    ).toEqual(['sold', 'cancel_rewrite', 'chargeback', 'other']);
  });

  it('books a sale first for Sold, a Cancel rewrite and a Chargeback — never for the rest', () => {
    expect([...RECONCILIATION_SALE_OUTCOME_KINDS]).toEqual([
      'sold',
      'cancel_rewrite',
      'chargeback',
    ]);
  });

  it('labels every kind, step and outcome resolution', () => {
    for (const kind of RECONCILIATION_OUTCOME_KINDS) {
      expect(RECONCILIATION_OUTCOME_KIND_LABELS[kind]).toBeTruthy();
    }
    for (const step of RECONCILIATION_OUTCOME_STEPS) {
      expect(RECONCILIATION_OUTCOME_STEP_LABELS[step]).toBeTruthy();
    }
    expect(RECONCILIATION_OUTCOME_RESOLUTION.chargeback).toBe(
      'chargeback_recorded',
    );
    expect(RECONCILIATION_RESOLUTION_LABELS.chargeback_recorded).toBe(
      'Chargeback recorded',
    );
  });

  it('lets a 1-800 policy the app does not have be set up for service, or Other', () => {
    expect(
      reconciliationOutcomeKinds({ tabs: ['review_1800'], match: 'dash_only' }),
    ).toEqual(['service_intake', 'other']);
  });

  it('gives a 1-800 policy the app already has Other only, on a deal or not', () => {
    expect(
      reconciliationOutcomeKinds({
        tabs: ['matched', 'review_1800'],
        match: 'matched',
      }),
    ).toEqual(['other']);
  });

  it('gives every other tab Other only', () => {
    for (const tab of RECONCILIATION_TABS.filter(
      (t) => t !== 'missing_from_app' && t !== 'review_1800',
    )) {
      for (const match of ['matched', 'dash_only', 'app_only', null] as const) {
        expect(reconciliationOutcomeKinds({ tabs: [tab], match })).toEqual([
          'other',
        ]);
      }
    }
    expect(reconciliationOutcomeKinds({ tabs: [], match: null })).toEqual([
      'other',
    ]);
  });

  it('resolves each kind with its own resolution, which a review cannot set', () => {
    for (const kind of RECONCILIATION_OUTCOME_KINDS) {
      const resolution = RECONCILIATION_OUTCOME_RESOLUTION[kind];
      expect(RECONCILIATION_OUTCOME_RESOLUTIONS).toContain(resolution);
      expect(RECONCILIATION_RESOLUTIONS).not.toContain(resolution);
      expect(RECONCILIATION_RESOLUTION_LABELS[resolution]).toBeTruthy();
    }
  });

  it('books a sale only with both leads and deal audits write', () => {
    expect(
      canRecordReconciliationSale(['leads:write', 'deal_audits:write']),
    ).toBe(true);
    expect(canRecordReconciliationSale(['leads:write'])).toBe(false);
    expect(canRecordReconciliationSale(['deal_audits:write'])).toBe(false);
    expect(
      canRecordReconciliationSale(['leads:read', 'deal_audits:read']),
    ).toBe(false);
  });

  it('sets up service with leads write, which Producers and CSRs both hold', () => {
    expect(canSetUpReconciliationService(['leads:write'])).toBe(true);
    expect(canSetUpReconciliationService(['leads:read'])).toBe(false);
    expect(
      canSetUpReconciliationService(['crm_service:write', 'clients:write']),
    ).toBe(false);
  });
});
