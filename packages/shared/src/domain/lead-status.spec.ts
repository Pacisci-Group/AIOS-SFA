import {
  LEAD_STATUSES,
  LOST_LEAD_STATUSES,
  QUOTE_ADVANCEABLE_LEAD_STATUSES,
  QUOTE_ADVANCE_TARGET,
  QUOTE_NON_ADVANCING_LEAD_STATUSES,
  SOLD_ADVANCEABLE_LEAD_STATUSES,
  SOLD_ADVANCE_TARGET,
  SOLD_NON_ADVANCING_LEAD_STATUSES,
  TERMINAL_LEAD_STATUSES,
  isLostLeadStatus,
  quoteAdvanceableStatusValues,
  soldAdvanceableStatusValues,
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

/**
 * The sold forward-advance rule (PAC-40). Broader than the quote rule by
 * design: everything that is not already terminal advances, because a producer
 * who closed a sale must always be able to book it.
 */
describe('sold-deal lead-status advance', () => {
  it('targets Sold', () => {
    expect(SOLD_ADVANCE_TARGET).toBe('Sold');
  });

  it('partitions the vocabulary exactly once', () => {
    const combined = [
      ...SOLD_ADVANCEABLE_LEAD_STATUSES,
      ...SOLD_NON_ADVANCING_LEAD_STATUSES,
    ];
    expect(combined.sort()).toEqual([...LEAD_STATUSES].sort());
  });

  it('advances every non-terminal status, including Quoted', () => {
    expect([...SOLD_ADVANCEABLE_LEAD_STATUSES].sort()).toEqual(
      ['Contacted', 'New', 'Qualified', 'Quoted', 'Requote'].sort(),
    );
    // The quote rule stops at Quoted; the sold rule must not — a quoted lead
    // is precisely the one most likely to be sold next.
    expect(QUOTE_NON_ADVANCING_LEAD_STATUSES).toContain('Quoted');
  });

  it('expands migrated status codes, not just labels', () => {
    const values = soldAdvanceableStatusValues();
    expect(values).toContain('hfwda'); // Qualified
    expect(values).toContain('arW7O'); // Requote
    expect(values).toContain('Quoted');
  });

  it('advances a lead with no status at all', () => {
    const values = soldAdvanceableStatusValues();
    expect(values).toContain(null);
    expect(values).toContain('');
  });

  it('never drags a terminal lead backwards', () => {
    const values = soldAdvanceableStatusValues();
    for (const status of SOLD_NON_ADVANCING_LEAD_STATUSES) {
      expect(values).not.toContain(status);
    }
    expect(values).not.toContain('jp76g'); // Lost
    expect(values).not.toContain('phjnb'); // Converted
  });

  it('is a strict superset of the quote-advanceable set', () => {
    // Anything a quote can advance, a sale can advance too. If this ever fails,
    // a lead could be quotable but not sellable — nonsense in the pipeline.
    for (const status of QUOTE_ADVANCEABLE_LEAD_STATUSES) {
      expect(SOLD_ADVANCEABLE_LEAD_STATUSES).toContain(status);
    }
  });
});

describe('lost lead statuses (Owner dashboard open quotes)', () => {
  it('are the terminal statuses that are not a sale', () => {
    expect([...LOST_LEAD_STATUSES].sort()).toEqual(
      TERMINAL_LEAD_STATUSES.filter(
        (status) => status !== 'Sold' && status !== 'Converted',
      ).sort(),
    );
  });

  it('normalizes a raw SmartSuite code before judging', () => {
    expect(isLostLeadStatus('jp76g')).toBe(true);
    expect(isLostLeadStatus('not qualified')).toBe(true);
  });

  it('leaves a Sold lead, an open lead and a missing status open', () => {
    expect(isLostLeadStatus('Sold')).toBe(false);
    expect(isLostLeadStatus('Quoted')).toBe(false);
    expect(isLostLeadStatus(null)).toBe(false);
  });

  it('only names real statuses', () => {
    for (const status of LOST_LEAD_STATUSES) {
      expect(LEAD_STATUSES).toContain(status);
    }
  });
});
