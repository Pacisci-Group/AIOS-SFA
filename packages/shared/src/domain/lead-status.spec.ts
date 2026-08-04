import {
  LEAD_STATUSES,
  QUOTE_ADVANCEABLE_LEAD_STATUSES,
  QUOTE_ADVANCE_TARGET,
  QUOTE_NON_ADVANCING_LEAD_STATUSES,
  quoteAdvanceableStatusValues,
} from './lead-status';

/**
 * The quote-recap forward-advance rule (PAC-39). Submitting a recap moves the
 * lead to "Quoted", but only from earlier pipeline states — a recap recorded
 * against a Sold or Lost lead must never drag it backwards.
 */
describe('quote-recap lead-status advance', () => {
  it('targets Quoted', () => {
    expect(QUOTE_ADVANCE_TARGET).toBe('Quoted');
  });

  it('partitions the vocabulary exactly once', () => {
    const combined = [
      ...QUOTE_ADVANCEABLE_LEAD_STATUSES,
      ...QUOTE_NON_ADVANCING_LEAD_STATUSES,
    ];
    expect(combined.sort()).toEqual([...LEAD_STATUSES].sort());
  });

  it('never advances a terminal or already-quoted lead', () => {
    expect([...QUOTE_NON_ADVANCING_LEAD_STATUSES].sort()).toEqual(
      [
        'Closed',
        'Converted',
        'Lost',
        'Not Qualified',
        'Quoted',
        'Sold',
      ].sort(),
    );
  });

  it('expands migrated status codes, not just labels', () => {
    const values = quoteAdvanceableStatusValues();
    // Without these two, every migrated Qualified lead (stored as `hfwda`) and
    // every Requote lead (`arW7O`) would silently fail to advance.
    expect(values).toContain('hfwda');
    expect(values).toContain('arW7O');
    expect(values).toContain('Qualified');
    expect(values).toContain('Requote');
  });

  it('advances a lead with no status at all', () => {
    const values = quoteAdvanceableStatusValues();
    // `$in: [null]` also matches a missing field.
    expect(values).toContain(null);
    expect(values).toContain('');
  });

  it('does not include any terminal status or its code', () => {
    const values = quoteAdvanceableStatusValues();
    for (const status of QUOTE_NON_ADVANCING_LEAD_STATUSES) {
      expect(values).not.toContain(status);
    }
    expect(values).not.toContain('jp76g'); // Lost
    expect(values).not.toContain('phjnb'); // Converted
  });
});
