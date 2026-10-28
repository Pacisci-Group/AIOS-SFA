import { appPolicy, dashRow } from './__fixtures__/dash-workbook';
import type { DashRow } from './dash-file-reader';
import { ProducerCodeIndex } from './producer-code-index';
import {
  deriveRow,
  editDistance,
  looksLikeCarrierNumber,
  matchRows,
  scorePair,
  summarize,
  surname,
  type AppPolicyLite,
  type ReconciledRow,
} from './reconcile';

const WINDOW = { from: '2026-09-01', to: '2026-09-30' };

const codes = new ProducerCodeIndex([
  { userId: 'u-pat', name: 'Pat', bindId: 'SOKAAAA1' },
  { userId: 'u-sam', name: 'Sam', bindId: 'SOKSAM02' },
]);

function run(
  dashRows: DashRow[],
  appPolicies: AppPolicyLite[] = [],
): ReconciledRow[] {
  return matchRows({ dashRows, appPolicies, window: WINDOW }).map((base) => ({
    ...base,
    ...deriveRow(base, codes),
  }));
}

describe('matchRows + deriveRow', () => {
  it('matches a Dash sale to the app policy with the same number', () => {
    const [row] = run([dashRow()], [appPolicy()]);
    expect(row).toMatchObject({
      side: 'both',
      match: 'matched',
      tabs: ['matched'],
      issues: [],
      needsReview: false,
      producerKey: 'user:u-pat',
    });
    expect(row.app?.policyId).toBe('p1');
  });

  it('lists an unmatched sale bound by staff as missing from the app', () => {
    const [row] = run([dashRow()]);
    expect(row).toMatchObject({
      match: 'dash_only',
      tabs: ['missing_from_app'],
      needsReview: true,
    });
  });

  it.each(['SJM-RCM', 'OSCVANJ'])(
    'sends a sale bound by %s — on no user, unnamed — to 1-800 review, not "missing"',
    (bindId) => {
      const [row] = run([
        dashRow({ bindId, bindIdKey: bindId, bindIdName: null }),
      ]);
      expect(row.tabs).toEqual(['review_1800']);
      expect(row.bindIdStatus).toBe('not_staff');
      expect(row.issues).toContain('not_staff_bind_id');
      expect(row.needsReview).toBe(true);
    },
  );

  it('treats a login Dash names but no user holds as a former employee, never 1-800', () => {
    const former = {
      bindId: 'SOK35W06',
      bindIdKey: 'SOK35W06',
      bindIdName: 'BRIAN CARTER',
      subProducerCode: null,
      subProducerName: null,
    };
    const [missing, matched, endorsement] = run(
      [
        dashRow(former),
        dashRow({
          ...former,
          policyNumber: '900000002',
          policyKey: '900000002',
        }),
        dashRow({
          ...former,
          policyNumber: '900000003',
          policyKey: '900000003',
          channel: '1-800',
          transactionType: 'Endorsement - Add Item/Premium - First Term',
          dispositionCode: 'Add Item',
        }),
      ],
      [
        appPolicy({
          policyId: 'p2',
          policyNumber: '900000002',
          policyKey: '900000002',
        }),
      ],
    );
    expect(missing).toMatchObject({
      bindIdStatus: 'former_staff',
      tabs: ['missing_from_app'],
      needsReview: true,
      producerKey: 'bind:SOK35W06',
      credit: {
        name: 'BRIAN CARTER',
        userId: null,
        via: 'bind_id',
      },
    });
    expect(missing.issues).toContain('former_staff_bind_id');
    expect(missing.issues).not.toContain('not_staff_bind_id');
    // Credit names nobody in the app, so it cannot contradict the deal.
    expect(matched.tabs).toEqual(['matched']);
    expect(matched.needsReview).toBe(false);
    // Not even through the 1-800 channel.
    expect(endorsement.tabs).toEqual(['ignored']);
  });

  it('keeps a line with no Bind ID out of 1-800 review', () => {
    const [row] = run([
      dashRow({ bindId: null, bindIdKey: null, bindIdName: null }),
    ]);
    expect(row.bindIdStatus).toBe('blank');
    expect(row.tabs).toEqual(['missing_from_app']);
  });

  it('never treats a producer’s own login as 1-800, whatever the channel', () => {
    const [sale, endorsement] = run([
      dashRow({ channel: 'Allstate.com' }),
      dashRow({
        policyNumber: '900000002',
        policyKey: '900000002',
        channel: '1-800',
        transactionType: 'Endorsement - Add Item/Premium - First Term',
        dispositionCode: 'Add Item',
      }),
    ]);
    expect(sale.tabs).toEqual(['missing_from_app']);
    expect(sale.issues).toContain('direct_channel');
    expect(endorsement.tabs).toEqual(['ignored']);
  });

  it('flags an endorsement by an unknown login only when it came through 1-800 or the web', () => {
    const endorsement = {
      transactionType: 'Endorsement - Add Item/Premium - First Term',
      dispositionCode: 'Add Item',
    };
    const [direct, quiet] = run([
      dashRow({
        ...endorsement,
        channel: '1-800',
        bindIdKey: 'SOKX1',
        bindIdName: null,
        policyNumber: '900000002',
      }),
      dashRow({
        ...endorsement,
        bindIdKey: '173220361446287760',
        bindIdName: null,
        policyNumber: '900000003',
      }),
    ]);
    expect(direct.tabs.sort()).toEqual(['ignored', 'review_1800']);
    expect(direct.issues).toEqual(
      expect.arrayContaining(['direct_channel', 'not_staff_bind_id']),
    );
    expect(quiet.tabs).toEqual(['ignored']);
    expect(quiet.needsReview).toBe(false);
  });

  it('lists an app policy sold in the period that Dash does not show', () => {
    const rows = run([], [appPolicy()]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      side: 'app',
      match: 'app_only',
      tabs: ['not_in_dash'],
      producerKey: 'user:u-pat',
      needsReview: true,
    });
  });

  it('does not expect a policy sold outside the period', () => {
    expect(run([], [appPolicy({ expectedInDash: false })])).toEqual([]);
  });

  it('treats any Dash line, even an endorsement, as proof the policy is there', () => {
    const rows = run(
      [
        dashRow({
          transactionType: 'Endorsement - Add Item/Premium - First Term',
          dispositionCode: 'Add Item',
        }),
      ],
      [appPolicy()],
    );
    expect(rows.map((row) => row.match)).toEqual([null]);
  });

  it('matches a National General number typed with its term suffix', () => {
    const [row] = run(
      [dashRow({ policyNumber: '2037692470', policyKey: '2037692470' })],
      [
        appPolicy({
          policyNumber: '2037692470-00',
          policyKey: '2037692470',
          carrier: 'National General',
        }),
      ],
    );
    expect(row.match).toBe('matched');
  });

  it('notes a match the app dated outside the report period', () => {
    const [row] = run(
      [dashRow()],
      [appPolicy({ soldDay: '2026-08-31', expectedInDash: false })],
    );
    expect(row.match).toBe('matched');
    expect(row.issues).toContain('outside_window');
  });

  it('picks the app policy sold closest to the Dash date when a number repeats', () => {
    const [row] = run(
      [dashRow({ dateWritten: '2026-09-20' })],
      [
        appPolicy({
          policyId: 'old',
          soldDay: '2024-03-01',
          expectedInDash: false,
        }),
        appPolicy({ policyId: 'new', soldDay: '2026-09-19' }),
      ],
    );
    expect(row.app?.policyId).toBe('new');
    expect(row.issues).toContain('duplicate_in_app');
  });

  it('keeps one sale line per policy number', () => {
    const rows = run([
      dashRow({ rowNumber: 11, issuedDate: '2026-09-05' }),
      dashRow({
        rowNumber: 12,
        issuedDate: '2026-09-02',
        transactionType: 'Sales Issued',
      }),
    ]);
    const kept = rows.find((row) => row.dash?.rowNumber === 12)!;
    const repeat = rows.find((row) => row.dash?.rowNumber === 11)!;
    expect(kept.isSale).toBe(true);
    expect(repeat).toMatchObject({
      isSale: false,
      ignoredReason: 'duplicate_line',
    });
    expect(kept.issues).toContain('duplicate_in_dash');
    expect(new Set(rows.map((row) => row.rowKey)).size).toBe(2);
  });

  it('flags a policy bound by someone other than the app’s producer', () => {
    const [row] = run(
      [
        dashRow({
          bindId: 'SOKSAM02',
          bindIdKey: 'SOKSAM02',
          bindIdName: 'SAM',
        }),
      ],
      [appPolicy()],
    );
    expect(row.tabs.sort()).toEqual(['matched', 'producer_mismatch']);
    expect(row.issues).toContain('producer_mismatch');
    expect(row.producerKey).toBe('user:u-sam');
  });

  it('notes a matched policy whose deal has no producer', () => {
    const [row] = run([dashRow()], [appPolicy({ producerId: null })]);
    expect(row.issues).toContain('no_app_producer');
    expect(row.tabs).toEqual(['matched']);
  });

  it('checks the premium and the producer independently', () => {
    const [row] = run(
      [
        dashRow({
          bindId: 'SOKSAM02',
          bindIdKey: 'SOKSAM02',
          bindIdName: 'SAM',
          writtenPremium: 990,
        }),
      ],
      [appPolicy()],
    );
    expect(row.tabs.sort()).toEqual([
      'matched',
      'premium_mismatch',
      'producer_mismatch',
    ]);
  });

  // Dash's sub-producer column is not read (owner, 28 Oct 2026): whoever
  // bound the policy is who it belongs to, under their name in the app.
  it('ignores the sub-producer column: the binder is who the line belongs to', () => {
    const [onNobody, onSam] = run(
      [
        dashRow({ subProducerCode: '002', subProducerName: 'BRIAN CARTER' }),
        dashRow({
          policyNumber: '900000002',
          policyKey: '900000002',
          subProducerCode: '025',
          subProducerName: 'SAM',
        }),
      ],
      [
        appPolicy(),
        appPolicy({
          policyId: 'p2',
          policyNumber: '900000002',
          policyKey: '900000002',
        }),
      ],
    );
    for (const row of [onNobody, onSam]) {
      expect(row).toMatchObject({
        tabs: ['matched'],
        issues: [],
        needsReview: false,
        producerKey: 'user:u-pat',
        credit: { name: 'Pat', userId: 'u-pat', via: 'bind_id' },
      });
    }
  });

  it('notes a mistyped or missing number on an app-only policy', () => {
    const rows = run(
      [],
      [
        appPolicy({
          policyId: 'short',
          policyNumber: '87588763',
          policyKey: '87588763',
        }),
        appPolicy({ policyId: 'blank', policyNumber: null, policyKey: '' }),
      ],
    );
    expect(rows.find((r) => r.app?.policyId === 'short')?.issues).toContain(
      'number_format',
    );
    expect(rows.find((r) => r.app?.policyId === 'blank')?.issues).toContain(
      'missing_policy_number',
    );
  });

  it('suggests the app policy a mistyped number probably meant', () => {
    const rows = run(
      [dashRow({ policyNumber: '875887631', policyKey: '875887631' })],
      [
        appPolicy({
          policyNumber: '87588763',
          policyKey: '87588763',
          clientName: 'Someone Else',
        }),
      ],
    );
    const missing = rows.find((row) => row.match === 'dash_only')!;
    const appOnly = rows.find((row) => row.match === 'app_only')!;
    expect(missing.suggestions).toHaveLength(1);
    expect(missing.suggestions[0]).toMatchObject({
      kind: 'app_policy',
      policyId: 'p1',
    });
    expect(missing.suggestions[0].reasons).toContain('number_close');
    expect(appOnly.suggestions).toEqual([
      expect.objectContaining({ kind: 'dash_row', rowKey: missing.rowKey }),
    ]);
  });
});

describe('matched-row checks', () => {
  // `1234.5` and `1234.50` are one number in JS; these differ as floats but
  // agree in whole cents, so only a cents comparison leaves them clean.
  it.each([
    [1234.5, 1234.501],
    [0.1 + 0.2, 0.3],
    [1928.0000000000002, 1928],
  ])('compares in whole cents: Dash %p and the app %p agree', (dash, app) => {
    const [row] = run(
      [dashRow({ writtenPremium: dash })],
      [appPolicy({ premium: app })],
    );
    expect(row).toMatchObject({
      tabs: ['matched'],
      issues: [],
      needsReview: false,
    });
  });

  it('flags a premium a single cent apart', () => {
    const [row] = run(
      [dashRow({ writtenPremium: 1234.5 })],
      [appPolicy({ premium: 1234.51 })],
    );
    expect(row.tabs.sort()).toEqual(['matched', 'premium_mismatch']);
    expect(row.issues).toEqual(['premium_mismatch']);
    expect(row.needsReview).toBe(true);
  });

  it('flags a difference either way', () => {
    const [row] = run(
      [dashRow({ writtenPremium: 1200 })],
      [appPolicy({ premium: 1000 })],
    );
    expect(row.tabs).toContain('premium_mismatch');
  });

  it('does not flag a premium Dash left blank', () => {
    const [row] = run([dashRow({ writtenPremium: null })], [appPolicy()]);
    expect(row.tabs).toEqual(['matched']);
    expect(row.issues).not.toContain('premium_mismatch');
  });

  it('flags an app policy with no premium entered', () => {
    const [row] = run([dashRow()], [appPolicy({ premium: 0 })]);
    expect(row.tabs).toContain('premium_mismatch');
  });

  it('never checks the premium of a row that did not match', () => {
    const [missing] = run([dashRow({ writtenPremium: 1 })]);
    expect(missing.issues).not.toContain('premium_mismatch');
    const [appOnly] = run([], [appPolicy({ premium: 1 })]);
    expect(appOnly.issues).not.toContain('premium_mismatch');
  });

  it('notes a different item count without asking for a decision', () => {
    const [row] = run([dashRow({ itemCount: 2 })], [appPolicy({ items: 1 })]);
    expect(row).toMatchObject({
      tabs: ['matched'],
      issues: ['item_count_mismatch'],
      needsReview: false,
    });
  });

  it('ignores an item count Dash left blank', () => {
    const [row] = run([dashRow({ itemCount: null })], [appPolicy()]);
    expect(row.issues).toEqual([]);
  });

  describe('a 1-800 policy recorded as a sale', () => {
    const direct = {
      bindId: 'OSCVANJ',
      bindIdKey: 'OSCVANJ',
      bindIdName: null,
    };

    it('flags a matched policy on a deal whose Bind ID is unnamed and on no user', () => {
      const [row] = run([dashRow(direct)], [appPolicy()]);
      expect(row.tabs.sort()).toEqual(['matched', 'review_1800']);
      expect(row.issues).toEqual(
        expect.arrayContaining([
          'direct_recorded_as_sale',
          'not_staff_bind_id',
        ]),
      );
      expect(row.needsReview).toBe(true);
    });

    it('never flags a Bind ID Dash names: that is a former employee’s sale', () => {
      const [row] = run(
        [dashRow({ ...direct, bindIdName: 'BRIAN CARTER' })],
        [appPolicy()],
      );
      expect(row.bindIdStatus).toBe('former_staff');
      expect(row.tabs).toEqual(['matched']);
      expect(row.issues).not.toContain('direct_recorded_as_sale');
    });

    it('never flags a staff Bind ID', () => {
      const [row] = run([dashRow()], [appPolicy()]);
      expect(row.issues).not.toContain('direct_recorded_as_sale');
    });

    it('does not call a policy on no deal a sale, though it is still 1-800', () => {
      const [row] = run([dashRow(direct)], [appPolicy({ dealId: null })]);
      expect(row.tabs.sort()).toEqual(['matched', 'review_1800']);
      expect(row.issues).not.toContain('direct_recorded_as_sale');
    });

    it('is never raised on a 1-800 line the app does not have', () => {
      const [row] = run([dashRow(direct)]);
      expect(row.tabs).toEqual(['review_1800']);
      expect(row.issues).not.toContain('direct_recorded_as_sale');
    });
  });
});

describe('summarize', () => {
  it('reproduces the scrubber summary: capture rate, missing premium, per producer', () => {
    const rows = run(
      [
        dashRow({
          policyNumber: '900000001',
          policyKey: '900000001',
          writtenPremium: 1000,
        }),
        dashRow({
          policyNumber: '900000002',
          policyKey: '900000002',
          writtenPremium: 250.5,
        }),
        dashRow({
          policyNumber: '900000003',
          policyKey: '900000003',
          bindId: 'SOKSAM02',
          bindIdKey: 'SOKSAM02',
          bindIdName: 'SAM',
          writtenPremium: 400,
        }),
        dashRow({
          policyNumber: '900000004',
          policyKey: '900000004',
          bindIdKey: 'SJM-RCM',
          bindIdName: null,
          subProducerCode: null,
          writtenPremium: 793.08,
        }),
        dashRow({
          policyNumber: '900000005',
          policyKey: '900000005',
          transactionType: 'Endorsement - Add Item/Premium - First Term',
          dispositionCode: 'Add Item',
        }),
      ],
      [
        appPolicy({
          policyId: 'p1',
          policyNumber: '900000001',
          policyKey: '900000001',
        }),
        appPolicy({
          policyId: 'p3',
          policyNumber: '900000003',
          policyKey: '900000003',
          producerId: 'u-sam',
          premium: 400,
        }),
        appPolicy({
          policyId: 'p9',
          policyNumber: '900000009',
          policyKey: '900000009',
          premium: 600,
        }),
      ],
    );
    const { totals, byProducer } = summarize(rows);
    expect(totals).toEqual({
      dashRows: 5,
      dashSales: 4,
      ignored: 1,
      matched: 2,
      missing: 1,
      appOnly: 1,
      review1800: 1,
      premiumMismatch: 0,
      producerMismatch: 0,
      dashPremium: 2443.58,
      matchedPremium: 1400,
      missingPremium: 250.5,
      appOnlyPremium: 600,
      review1800Premium: 793.08,
      premiumMismatchDelta: 0,
      captureRate: 2 / 3,
    });
    expect(
      byProducer.map((p) => [
        p.producerKey,
        p.dashSales,
        p.matched,
        p.missing,
        p.appOnly,
      ]),
    ).toEqual([
      ['user:u-pat', 2, 1, 1, 1],
      ['user:u-sam', 1, 1, 0, 0],
    ]);
    expect(byProducer[0].captureRate).toBe(0.5);
  });

  it('counts premium differences and sums them as absolute amounts', () => {
    const rows = run(
      [
        dashRow({ writtenPremium: 1000 }),
        dashRow({
          policyNumber: '900000002',
          policyKey: '900000002',
          writtenPremium: 500,
        }),
        dashRow({
          policyNumber: '900000003',
          policyKey: '900000003',
          writtenPremium: 300,
        }),
        // Not matched: its premium is nobody's to compare.
        dashRow({
          policyNumber: '900000004',
          policyKey: '900000004',
          writtenPremium: 50,
        }),
      ],
      [
        appPolicy({ premium: 1012.5 }),
        appPolicy({
          policyId: 'p2',
          policyNumber: '900000002',
          policyKey: '900000002',
          premium: 499.99,
        }),
        appPolicy({
          policyId: 'p3',
          policyNumber: '900000003',
          policyKey: '900000003',
          premium: 300,
        }),
      ],
    );
    const { totals } = summarize(rows);
    expect(totals.matched).toBe(3);
    expect(totals.premiumMismatch).toBe(2);
    // 12.50 over and 0.01 under: 12.51 apart, not 12.49.
    expect(totals.premiumMismatchDelta).toBe(12.51);
    expect(totals.producerMismatch).toBe(0);
  });

  // Grouped by sub-producer code, this was two lines — "PAT PRODUCER (099)"
  // for the Dash line and "Pat" for the app's own policy — whenever the code
  // was not on Pat's user.
  it('lists one line per person, whatever sub-producer code Dash prints', () => {
    const rows = run(
      [dashRow({ subProducerCode: '099', subProducerName: 'PAT PRODUCER' })],
      [
        appPolicy({
          policyId: 'p9',
          policyNumber: '900000009',
          policyKey: '900000009',
        }),
      ],
    );
    const { byProducer } = summarize(rows);
    expect(
      byProducer.map((p) => [p.producerKey, p.dashSales, p.missing, p.appOnly]),
    ).toEqual([['user:u-pat', 1, 1, 1]]);
  });

  it('gives a former employee a line of their own, apart from lines that name nobody', () => {
    const former = {
      bindIdKey: 'SOK35W06',
      bindIdName: 'BRIAN CARTER',
      subProducerCode: null,
      subProducerName: null,
    };
    const rows = run([
      dashRow({ ...former, writtenPremium: 300 }),
      dashRow({
        ...former,
        policyNumber: '900000002',
        policyKey: '900000002',
        writtenPremium: 200,
      }),
      dashRow({
        policyNumber: '900000003',
        policyKey: '900000003',
        bindId: null,
        bindIdKey: null,
        bindIdName: null,
        subProducerCode: null,
        subProducerName: null,
      }),
    ]);
    const { totals, byProducer } = summarize(rows);
    expect(totals.review1800).toBe(0);
    expect(
      byProducer.map((p) => [p.producerKey, p.dashName, p.missing]),
    ).toEqual([
      ['bind:SOK35W06', 'BRIAN CARTER', 2],
      ['none', null, 1],
    ]);
  });

  it('never names the "none" line after a stray Bind ID Name on a blank Bind ID', () => {
    const rows = run([
      dashRow({
        bindId: null,
        bindIdKey: null,
        bindIdName: 'BRIAN CARTER',
        subProducerCode: null,
        subProducerName: null,
      }),
    ]);
    expect(rows[0].producerKey).toBe('none');
    expect(summarize(rows).byProducer[0].dashName).toBeNull();
  });
});

describe('helpers', () => {
  it('reads a surname past middle initials and suffixes', () => {
    expect(surname('ROBERT GERALD LOFTIN III')).toBe('LOFTIN');
    expect(surname('Jonathan G G Reimbold')).toBe('REIMBOLD');
    expect(surname('Cher')).toBeNull();
    expect(surname(null)).toBeNull();
  });

  it('measures edit distance', () => {
    expect(editDistance('875887631', '87588763')).toBe(1);
    expect(editDistance('879100129', '879100192')).toBe(2);
    expect(editDistance('abc', 'abc')).toBe(0);
  });

  it('needs more than a shared surname to suggest a pair', () => {
    const side = {
      key: '111111111',
      name: 'Ann Smith',
      premium: 100,
      day: '2026-09-01',
    };
    expect(
      scorePair(side, {
        ...side,
        key: '999999999',
        premium: 900,
        day: '2026-07-01',
      }),
    ).toBeNull();
    expect(
      scorePair(side, { ...side, key: '999999999', premium: 105 })?.reasons,
    ).toEqual(['same_surname', 'premium_close', 'date_close']);
  });

  it('knows the carriers’ number lengths', () => {
    expect(looksLikeCarrierNumber('879100129', 'Allstate')).toBe(true);
    expect(looksLikeCarrierNumber('87910012', 'Allstate')).toBe(false);
    expect(looksLikeCarrierNumber('2037692470', 'National General')).toBe(true);
    expect(looksLikeCarrierNumber('ABC123', 'Progressive')).toBe(true);
  });
});
