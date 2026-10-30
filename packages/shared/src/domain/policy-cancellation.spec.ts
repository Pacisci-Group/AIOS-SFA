import { CHARGEBACK_REASONS, CHARGEBACK_REASON_LABELS } from './chargeback';
import {
  POLICY_CANCELLATION_REASONS,
  POLICY_CANCELLATION_REASON_LABELS,
  policyCancellationSummary,
} from './policy-cancellation';

describe('policyCancellationSummary', () => {
  it('names a listed reason by its label', () => {
    expect(policyCancellationSummary({ reason: 'sold', note: null })).toBe(
      'Sold',
    );
    expect(
      policyCancellationSummary({ reason: 'changed_carrier', note: null }),
    ).toBe('Changed carrier');
  });

  it('reads the free text for Other', () => {
    expect(
      policyCancellationSummary({ reason: 'other', note: '  Moved abroad ' }),
    ).toBe('Moved abroad');
  });

  it('falls back to the label for an Other with no note', () => {
    expect(policyCancellationSummary({ reason: 'other', note: '   ' })).toBe(
      'Other',
    );
  });

  it('labels every reason', () => {
    for (const reason of POLICY_CANCELLATION_REASONS) {
      expect(POLICY_CANCELLATION_REASON_LABELS[reason]).toBeTruthy();
    }
  });
});

describe('chargeback reasons', () => {
  it('records a cancellation with a chargeback beside a rewrite, and labels both', () => {
    expect([...CHARGEBACK_REASONS]).toEqual(['cancel_rewrite', 'cancellation']);
    for (const reason of CHARGEBACK_REASONS) {
      expect(CHARGEBACK_REASON_LABELS[reason]).toBeTruthy();
    }
    expect(CHARGEBACK_REASON_LABELS.cancellation).toBe('Cancelled policy');
  });
});
