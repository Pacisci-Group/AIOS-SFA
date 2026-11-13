import type { RowOutcome } from '../common/carrier-reconciliation/carry-forward';
import { dashRow } from '../common/carrier-reconciliation/__fixtures__/dash-workbook';
import {
  outcomeLabel,
  outcomeView,
  reconciliationPrefill,
} from './reconciliation-views';

const PAT = 'a'.repeat(24);
const GONE = 'b'.repeat(24);

const outcome = (overrides: Partial<RowOutcome> = {}): RowOutcome => ({
  kind: 'cancel_rewrite',
  status: 'in_progress',
  step: 'write_replacement',
  note: 'Rewritten as Non Standard',
  leadId: 'l1',
  dealId: 'd1',
  policyId: 'p1',
  householdId: 'h1',
  replacementPolicyId: null,
  chargebackId: null,
  startedById: PAT,
  startedAt: new Date('2026-10-04T09:00:00Z'),
  completedById: null,
  completedAt: null,
  ...overrides,
});

describe('outcomeView', () => {
  it('names who started it and keeps every link', () => {
    expect(outcomeView(outcome(), new Map([[PAT, 'Pat Producer']]))).toEqual({
      kind: 'cancel_rewrite',
      status: 'in_progress',
      step: 'write_replacement',
      note: 'Rewritten as Non Standard',
      leadId: 'l1',
      dealId: 'd1',
      policyId: 'p1',
      householdId: 'h1',
      replacementPolicyId: null,
      chargebackId: null,
      startedBy: { id: PAT, name: 'Pat Producer' },
      startedAt: '2026-10-04T09:00:00.000Z',
      completedBy: null,
      completedAt: null,
    });
  });

  it('reads a finisher no longer on file as a former user', () => {
    const view = outcomeView(
      outcome({
        status: 'done',
        step: null,
        completedById: GONE,
        completedAt: new Date('2026-10-05T10:00:00Z'),
      }),
      new Map([[PAT, 'Pat Producer']]),
    );
    expect(view.completedBy).toEqual({ id: GONE, name: 'Former user' });
    expect(view.completedAt).toBe('2026-10-05T10:00:00.000Z');
  });
});

describe('outcomeLabel', () => {
  it.each([
    [{ kind: 'sold', status: 'done', step: null }, 'Sold — done'],
    [
      { kind: 'sold', status: 'in_progress', step: 'record_sale' },
      'Sold — recording the sale',
    ],
    [
      {
        kind: 'cancel_rewrite',
        status: 'in_progress',
        step: 'write_replacement',
      },
      'Cancel rewrite — writing the replacement',
    ],
    [{ kind: 'other', status: 'done', step: null }, 'Other — done'],
  ] as const)('%p → %p', (value, expected) => {
    expect(outcomeLabel(value)).toBe(expected);
  });

  it('is blank for a row with no outcome', () => {
    expect(outcomeLabel(null)).toBeNull();
  });
});

describe('reconciliationPrefill', () => {
  it('reads the Dash line as the New Lead and Sold forms want it', () => {
    expect(
      reconciliationPrefill(
        dashRow({
          customerName: 'JACQUELINE BANUELOS MURILLO',
          policyNumber: '900000123',
          product: 'Homeowners',
          productDescription: 'Homeowners',
          writtenPremium: 1834.5,
          itemCount: 1,
          issuedDate: '2026-09-15',
          dateWritten: '2026-09-02',
        }),
        'Allstate',
      ),
    ).toEqual({
      lead: {
        firstName: 'Jacqueline',
        lastName: 'Banuelos Murillo',
        // The lead may not postdate the sale it carries.
        createdDate: '2026-09-02',
      },
      policy: {
        policyNumber: '900000123',
        policyType: 'Home',
        carrier: 'Allstate',
        premium: 1834.5,
        itemCount: 1,
        effectiveDate: '2026-09-15',
        soldDate: '2026-09-02',
      },
    });
  });

  it('falls back across the two dates, and floors the item count at one', () => {
    const prefill = reconciliationPrefill(
      dashRow({ dateWritten: null, issuedDate: '2026-09-20', itemCount: 0 }),
      null,
    );
    expect(prefill?.policy).toMatchObject({
      soldDate: '2026-09-20',
      effectiveDate: '2026-09-20',
      itemCount: 1,
      carrier: null,
    });
    expect(prefill?.lead?.createdDate).toBe('2026-09-20');
  });

  it('leaves out what Dash does not say', () => {
    expect(
      reconciliationPrefill(
        { policyNumber: 'DASH-0001', writtenPremium: 1200 },
        'Allstate',
      ),
    ).toEqual({
      lead: null,
      policy: {
        policyNumber: 'DASH-0001',
        policyType: null,
        carrier: 'Allstate',
        premium: 1200,
        itemCount: 1,
        effectiveDate: null,
        soldDate: null,
      },
    });
  });

  it('is null without a Dash line', () => {
    expect(reconciliationPrefill(null, 'Allstate')).toBeNull();
  });
});
