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
  { userId: 'u-pat', name: 'Pat', bindId: 'SOKAAAA1', subProducerCode: '034' },
  { userId: 'u-sam', name: 'Sam', bindId: 'SOKSAM02', subProducerCode: '025' },
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
        code: null,
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

  it('flags a producer-credit mismatch', () => {
    const [row] = run([dashRow({ subProducerCode: '025' })], [appPolicy()]);
    expect(row.tabs.sort()).toEqual(['matched', 'producer_mismatch']);
    expect(row.issues).toContain('producer_mismatch');
    expect(row.producerKey).toBe('user:u-sam');
  });

  it('notes a matched policy whose deal has no producer', () => {
    const [row] = run([dashRow()], [appPolicy({ producerId: null })]);
    expect(row.issues).toContain('no_app_producer');
    expect(row.tabs).toEqual(['matched']);
  });

  it('notes a sub-producer code on no user without reviewing the row', () => {
    const [row] = run([dashRow({ subProducerCode: '002' })], [appPolicy()]);
    expect(row.issues).toContain('unmapped_producer');
    expect(row.producerKey).toBe('code:002');
    expect(row.needsReview).toBe(false);
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
          subProducerCode: '025',
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
      producerMismatch: 0,
      dashPremium: 2443.58,
      matchedPremium: 1400,
      missingPremium: 250.5,
      appOnlyPremium: 600,
      review1800Premium: 793.08,
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
