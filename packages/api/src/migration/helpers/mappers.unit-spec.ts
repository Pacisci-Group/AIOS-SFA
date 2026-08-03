import {
  CANONICAL_LEAD_SOURCES,
  isTestRecord,
  normalizeLeadSource,
} from '@sfa/shared';
import {
  daysSince,
  deriveDealType,
  normalizeTemperature,
  policyTypeLabels,
  resolvePremium,
} from './derive';
import {
  firstLinkedId,
  selectCode,
  toDate,
  toNumber,
  toPhoneArray,
  toStringArray,
  toYmd,
} from './value-utils';

describe('lead source normalization', () => {
  it('maps canonical select codes to labels', () => {
    expect(normalizeLeadSource('WCO7l')).toMatchObject({
      code: 'WCO7l',
      label: 'Mailer',
      isCanonical: true,
    });
    expect(normalizeLeadSource('gjJUG').label).toBe('Soleo');
  });

  it('covers all 14 canonical sources', () => {
    expect(Object.keys(CANONICAL_LEAD_SOURCES)).toHaveLength(14);
  });

  it('folds non-canonical deal codes into a canonical bucket', () => {
    expect(normalizeLeadSource('65o7M')).toMatchObject({
      label: 'Book of Business',
      isCanonical: true,
    });
  });

  it('maps legacy Leads-table labels via alias', () => {
    expect(normalizeLeadSource('Mail').label).toBe('Mailer');
    expect(normalizeLeadSource('Referral Partner').label).toBe(
      'Customer Referral',
    );
  });

  it('keeps unknown sources non-canonical', () => {
    expect(normalizeLeadSource(undefined, 'Carrier Pigeon')).toMatchObject({
      label: 'Carrier Pigeon',
      isCanonical: false,
    });
  });
});

describe('test/sample/demo flagging', () => {
  it('flags the Test lead-source code', () => {
    expect(isTestRecord({ code: 'ENEJP', label: 'Test' })).toBe(true);
  });
  it('flags names containing test/sample/demo', () => {
    expect(isTestRecord(null, 'Sample Producer')).toBe(true);
    expect(isTestRecord(null, 'John Demo')).toBe(true);
    expect(isTestRecord(null, 'Jane Real')).toBe(false);
  });
});

describe('premium rollup + snapshot fallback', () => {
  it('prefers the rollup when > 0', () => {
    expect(resolvePremium('3042.78', '100')).toEqual({
      premium: 3042.78,
      source: 'rollup',
    });
  });
  it('falls back to snapshot when rollup is empty', () => {
    expect(resolvePremium(0, '250.50')).toEqual({
      premium: 250.5,
      source: 'snapshot',
    });
  });
  it('reports none when both empty', () => {
    expect(resolvePremium(undefined, null)).toEqual({
      premium: 0,
      source: 'none',
    });
  });
});

describe('deal type derivation', () => {
  it('bundle flag wins', () => {
    expect(deriveDealType(true, ['Auto'])).toBe('Bundle');
  });
  it('auto + home lines => Bundle', () => {
    expect(deriveDealType(false, ['Auto', 'Home'])).toBe('Bundle');
  });
  it('auto only => Auto', () => {
    expect(deriveDealType(false, ['Auto'])).toBe('Auto');
  });
  it('home-like only => Home', () => {
    expect(deriveDealType(false, ['Renters'])).toBe('Home');
  });
  it('unknown => Other', () => {
    expect(deriveDealType(false, ['Umbrella'])).toBe('Other');
  });

  it('translates policy type lookup codes to labels', () => {
    expect(policyTypeLabels([['PYgez'], ['sNMRK']])).toEqual(
      expect.arrayContaining(['Auto', 'Home']),
    );
  });
});

describe('temperature + aging', () => {
  it('normalizes hydrated select temperature', () => {
    expect(normalizeTemperature({ value: 'Hot', label: 'Hot' })).toBe('Hot');
    expect(normalizeTemperature('Cold')).toBe('Cold');
    expect(normalizeTemperature(undefined)).toBe('Unknown');
  });
  it('computes non-negative aging days', () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 86400000);
    expect(daysSince(tenDaysAgo)).toBe(10);
    expect(daysSince(new Date(Date.now() + 86400000))).toBe(0);
  });
});

describe('SmartSuite value extraction', () => {
  it('parses currency strings', () => {
    expect(toNumber('232.00$')).toBe(232);
    expect(toNumber('3042.78')).toBeCloseTo(3042.78);
  });
  it('reads dates from { date } and { on: { date } }', () => {
    expect(toDate({ date: '2025-08-12T00:00:00Z' })?.getUTCFullYear()).toBe(
      2025,
    );
    expect(
      toDate({ on: { date: '2026-01-15T05:18:12Z' } })?.getUTCMonth(),
    ).toBe(0);
  });
  it('derives YYYYMMDD from a date', () => {
    expect(toYmd(new Date('2025-08-12T00:00:00Z'))).toBe(20250812);
  });
  it('extracts first linked record id', () => {
    expect(firstLinkedId(['69613aed0ff4e450871ce2d9'])).toBe(
      '69613aed0ff4e450871ce2d9',
    );
    expect(firstLinkedId([])).toBeUndefined();
  });
  it('extracts select code from hydrated object', () => {
    expect(selectCode({ value: 'WCO7l', label: 'Mailer' })).toBe('WCO7l');
  });
  it('extracts emails and phones', () => {
    expect(toStringArray(['a@b.com'])).toEqual(['a@b.com']);
    expect(
      toPhoneArray([{ phone_country: 'US', phone_number: '555 437 6488' }]),
    ).toEqual(['555 437 6488']);
  });
});
