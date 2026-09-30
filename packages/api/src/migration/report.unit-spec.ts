import { emptyStat, recordUnmappedChoice } from './report';

describe('recordUnmappedChoice', () => {
  it('is absent until something is unmapped — the expected reading', () => {
    expect(emptyStat().unmappedChoices).toBeUndefined();
  });

  it('counts every row carrying a code, per field', () => {
    // PAC-135: seven Policy Type codes passed through raw onto 92 policies and
    // nothing said so. The count per code is what tells an operator whether
    // they are looking at one stray row or a missing line of business.
    const stat = emptyStat();
    recordUnmappedChoice(stat, 'policyType', 'Zz9Qx');
    recordUnmappedChoice(stat, 'policyType', 'Zz9Qx');
    recordUnmappedChoice(stat, 'policyType', 'zzzzz');

    expect(stat.unmappedChoices).toEqual({
      'policyType:Zz9Qx': 2,
      'policyType:zzzzz': 1,
    });
  });

  it('does not count as a rejection — the value is kept, not replaced', () => {
    const stat = emptyStat();
    recordUnmappedChoice(stat, 'policyType', 'Zz9Qx');

    expect(stat.rejectedValues).toBe(0);
  });
});
