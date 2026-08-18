import { emptyAuditTriggers } from '../deals/schemas/deal.schema';
import type { DealAuditTriggers } from '../deals/schemas/deal.schema';
import {
  buildDedupeKey,
  buildItemName,
  computeRequiredTitles,
  isBaselineTemplate,
  type AuditTemplateLike,
} from './audit-titles';

/**
 * The generation rules, pinned.
 *
 * This is the highest-value spec in PAC-40: generation is best-effort and runs
 * post-commit, so a wrong rule here produces a sale that books cleanly and
 * silently hands the service team the wrong checklist — or none at all.
 */

const BASELINE: AuditTemplateLike[] = [
  { name: 'Correct Sold Date', category: 'Common', alwaysInclude: true },
  { name: 'Prior Insurance', category: 'Common', alwaysInclude: true },
];

function triggers(overrides: Partial<DealAuditTriggers> = {}) {
  return { ...emptyAuditTriggers(), ...overrides };
}

function titlesFor(
  policyTypes: string[],
  overrides: Partial<DealAuditTriggers> = {},
  mortgagee = false,
  templates: AuditTemplateLike[] = BASELINE,
) {
  return computeRequiredTitles({
    policyTypes,
    mortgagee,
    triggers: triggers(overrides),
    templates,
  }).map((item) => buildItemName(item));
}

describe('isBaselineTemplate', () => {
  it('includes anything flagged alwaysInclude', () => {
    expect(isBaselineTemplate({ name: 'X', alwaysInclude: true })).toBe(true);
  });

  it('includes the Common category, case-insensitively', () => {
    expect(isBaselineTemplate({ name: 'X', category: 'Common' })).toBe(true);
    expect(isBaselineTemplate({ name: 'X', category: ' common ' })).toBe(true);
  });

  it('does NOT treat a category merely containing "common" as baseline', () => {
    // Bug-compatible with legacy on purpose: widening this to a substring
    // match would add items to every historical deal's expected set.
    expect(isBaselineTemplate({ name: 'X', category: 'Common Docs' })).toBe(
      false,
    );
    expect(isBaselineTemplate({ name: 'X', category: 'Uncommon' })).toBe(false);
  });

  it('excludes a line-of-business category', () => {
    expect(isBaselineTemplate({ name: 'X', category: 'Auto' })).toBe(false);
    expect(isBaselineTemplate({ name: 'X' })).toBe(false);
  });
});

describe('computeRequiredTitles — baseline', () => {
  it('includes every baseline template on any deal', () => {
    expect(titlesFor(['Auto'])).toEqual(
      expect.arrayContaining(['Correct Sold Date', 'Prior Insurance']),
    );
  });

  it('ignores non-baseline templates unless something triggers them', () => {
    const templates = [
      ...BASELINE,
      { name: 'Drivewise', category: 'Auto' },
      { name: 'Home Inspection', category: 'Home' },
    ];
    // Auto-only, no discounts: Home Inspection must not appear.
    expect(titlesFor(['Auto'], {}, false, templates)).not.toContain(
      'Home Inspection',
    );
  });
});

describe('computeRequiredTitles — policy-type deterministic', () => {
  it.each([
    ['Auto', 'Drivers Verified'],
    ['Motorcycle', 'Drivers Verified'],
    ['Auto - Special', 'Drivers Verified'],
    ['Home', 'Home Inspection'],
    ['Renters', 'Home Inspection'],
    ['Condominium', 'Home Inspection'],
    ['Landlord', 'Landlord Inspection'],
  ])('%s ⇒ %s', (policyType, expected) => {
    expect(titlesFor([policyType])).toContain(expected);
  });

  it('gives a bundle both the auto and the home item', () => {
    const titles = titlesFor(['Auto', 'Home']);
    expect(titles).toContain('Drivers Verified');
    expect(titles).toContain('Home Inspection');
  });

  it('adds no inspection for a line that is neither auto nor property', () => {
    const titles = titlesFor(['Umbrella']);
    expect(titles).not.toContain('Drivers Verified');
    expect(titles).not.toContain('Home Inspection');
    expect(titles).not.toContain('Landlord Inspection');
  });

  it('classifies a raw SmartSuite code the same as its label', () => {
    // `mCt4m` is "Landlords" in SmartSuite.
    expect(titlesFor(['mCt4m'])).toContain('Landlord Inspection');
  });
});

describe('computeRequiredTitles — mortgagee', () => {
  it('adds the mortgagee item only when escrow was taken', () => {
    expect(titlesFor(['Home'], {}, false)).not.toContain('Home Mortgagee');
    expect(titlesFor(['Home'], {}, true)).toContain('Home Mortgagee');
  });

  it('adds it per property line', () => {
    const titles = titlesFor(['Home', 'Landlord'], {}, true);
    expect(titles).toContain('Home Mortgagee');
    expect(titles).toContain('Landlord Mortgagee');
  });

  it('never adds a mortgagee item to an auto-only deal', () => {
    const titles = titlesFor(['Auto'], {}, true);
    expect(titles).not.toContain('Home Mortgagee');
    expect(titles).not.toContain('Landlord Mortgagee');
  });
});

describe('computeRequiredTitles — flat discount triggers', () => {
  it('maps the form wording onto the checklist vocabulary', () => {
    // The form says "Student Discount"; the checklist says "Good Student".
    expect(titlesFor(['Auto'], { goodStudent: true })).toContain(
      'Good Student',
    );
  });

  it('generates no item for Drivewise, trigger or not (PAC-65)', () => {
    // The one Card 5 option that produces nothing. `triggers.drivewise` is
    // still written to the deal as provenance, which is exactly why this is
    // asserted: the field's existence invites the generator line back.
    expect(titlesFor(['Auto'], { drivewise: true })).not.toContain('Drivewise');
  });

  it('adds nothing when no discount was taken', () => {
    const titles = titlesFor(['Auto']);
    expect(titles).not.toContain('Good Student');
    expect(titles).not.toContain('Drivewise');
  });
});

describe('computeRequiredTitles — Home/Landlord variant fan-out', () => {
  it.each([
    ['fireSubscription', 'Fire Subscription'],
    ['actualCashValue', 'Actual Cash Value'],
    ['hailResistantRoof', 'Hail Resistant Roof'],
  ])('%s adds BOTH variants when both lines are present', (key, suffix) => {
    // The load-bearing case: each property needs its own proof, so a deal with
    // a home and a landlord line gets two items, not one.
    const titles = titlesFor(['Home', 'Landlord'], { [key]: true });
    expect(titles).toContain(`Home ${suffix}`);
    expect(titles).toContain(`Landlord ${suffix}`);
  });

  it.each([
    ['fireSubscription', 'Fire Subscription'],
    ['actualCashValue', 'Actual Cash Value'],
    ['hailResistantRoof', 'Hail Resistant Roof'],
  ])('%s adds only the Home variant for a home-only deal', (key, suffix) => {
    const titles = titlesFor(['Home'], { [key]: true });
    expect(titles).toContain(`Home ${suffix}`);
    expect(titles).not.toContain(`Landlord ${suffix}`);
  });

  it('routes Renters and Condominium to the Home variant', () => {
    expect(titlesFor(['Renters'], { fireSubscription: true })).toContain(
      'Home Fire Subscription',
    );
    expect(titlesFor(['Condominium'], { hailResistantRoof: true })).toContain(
      'Home Hail Resistant Roof',
    );
  });

  it('adds no variant when the deal has no property line at all', () => {
    // A trigger with nowhere to attach must not invent an item.
    const titles = titlesFor(['Auto'], { fireSubscription: true });
    expect(titles).not.toContain('Home Fire Subscription');
    expect(titles).not.toContain('Landlord Fire Subscription');
  });
});

describe('computeRequiredTitles — defensive driver per-driver expansion', () => {
  it('creates one item per named driver', () => {
    const titles = titlesFor(['Auto'], {
      defensiveDriver: true,
      defensiveDriverNames: ['Dana Driver', 'Sam Second', 'Alex Third'],
    });
    expect(titles).toContain('Defensive Driver — Dana Driver');
    expect(titles).toContain('Defensive Driver — Sam Second');
    expect(titles).toContain('Defensive Driver — Alex Third');
  });

  it('still creates one unnamed item when nobody was named', () => {
    // Ticked but unnamed is a data-entry gap, not a reason to drop the chase.
    const titles = titlesFor(['Auto'], {
      defensiveDriver: true,
      defensiveDriverNames: [],
    });
    expect(titles).toContain('Defensive Driver');
  });

  it('creates none when the discount was not taken', () => {
    const titles = titlesFor(['Auto'], {
      defensiveDriverNames: ['Ignored Person'],
    });
    expect(titles.some((t) => t.startsWith('Defensive Driver'))).toBe(false);
  });

  it('keeps two drivers distinct on the board', () => {
    const items = computeRequiredTitles({
      policyTypes: ['Auto'],
      mortgagee: false,
      triggers: triggers({
        defensiveDriver: true,
        defensiveDriverNames: ['Dana Driver', 'Sam Second'],
      }),
      templates: BASELINE,
    }).filter((i) => i.title === 'Defensive Driver');

    expect(items).toHaveLength(2);
    expect(new Set(items.map(buildItemName)).size).toBe(2);
  });
});

describe('computeRequiredTitles — deduplication', () => {
  it('lists a title that is both baseline and triggered only once', () => {
    const templates: AuditTemplateLike[] = [
      ...BASELINE,
      // An agency that decided Drivewise applies to every deal.
      { name: 'Drivewise', category: 'Auto', alwaysInclude: true },
    ];
    const titles = titlesFor(['Auto'], { drivewise: true }, false, templates);
    expect(titles.filter((t) => t === 'Drivewise')).toHaveLength(1);
  });

  it('collapses a driver named twice into one certificate', () => {
    const titles = titlesFor(['Auto'], {
      defensiveDriver: true,
      defensiveDriverNames: ['Dana Driver', 'Dana Driver'],
    });
    expect(
      titles.filter((t) => t === 'Defensive Driver — Dana Driver'),
    ).toHaveLength(1);
  });

  it('produces no duplicate entries for a fully-loaded bundle', () => {
    const titles = titlesFor(
      ['Auto', 'Home', 'Landlord'],
      {
        drivewise: true,
        goodStudent: true,
        fireSubscription: true,
        actualCashValue: true,
        hailResistantRoof: true,
        defensiveDriver: true,
        defensiveDriverNames: ['Dana Driver'],
      },
      true,
    );
    expect(new Set(titles).size).toBe(titles.length);
  });
});

describe('buildDedupeKey', () => {
  it('is stable across casing and spacing', () => {
    const a = buildDedupeKey('deal1', { title: 'Home Inspection' });
    const b = buildDedupeKey('deal1', { title: '  home inspection ' });
    expect(a).toBe(b);
  });

  it('separates two drivers under one title', () => {
    const a = buildDedupeKey('deal1', {
      title: 'Defensive Driver',
      subjectName: 'Dana',
    });
    const b = buildDedupeKey('deal1', {
      title: 'Defensive Driver',
      subjectName: 'Sam',
    });
    expect(a).not.toBe(b);
  });

  it('separates the same item on two different deals', () => {
    expect(buildDedupeKey('deal1', { title: 'X' })).not.toBe(
      buildDedupeKey('deal2', { title: 'X' }),
    );
  });
});
