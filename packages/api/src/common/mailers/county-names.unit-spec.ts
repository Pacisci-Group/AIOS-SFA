import { COUNTY_NAMES_BY_STATE, resolveCountyName } from './county-names';

/**
 * The 17 distinct county codes that actually appear in the committed RTP
 * fixture (`test/fixtures/mailers/rtp-sample.csv`), with the names they must
 * resolve to.
 *
 * Pinned rather than spot-checked because a hand-typed FIPS table's failure
 * mode is a transposition — `101`/`107` are Muskogee and Okfuskee, and nothing
 * about "Okfuskee County" on screen looks wrong unless you know the address.
 * These are the codes a real import will hit.
 */
const FIXTURE_CODES: Record<string, string> = {
  '001': 'Adair County',
  '005': 'Atoka County',
  '017': 'Canadian County',
  '027': 'Cleveland County',
  '037': 'Creek County',
  '083': 'Logan County',
  '091': 'McIntosh County',
  '097': 'Mayes County',
  '099': 'Murray County',
  '101': 'Muskogee County',
  '109': 'Oklahoma County',
  '113': 'Osage County',
  '119': 'Payne County',
  '123': 'Pontotoc County',
  '131': 'Rogers County',
  '143': 'Tulsa County',
  '147': 'Washington County',
};

describe('COUNTY_NAMES_BY_STATE', () => {
  it('carries all 77 Oklahoma counties', () => {
    expect(Object.keys(COUNTY_NAMES_BY_STATE.OK)).toHaveLength(77);
  });

  it('keys every county on a zero-padded odd 3-digit code', () => {
    // Census county FIPS are assigned in steps of two, so an even code here
    // means a digit was dropped or duplicated while typing the table.
    for (const code of Object.keys(COUNTY_NAMES_BY_STATE.OK)) {
      expect(code).toMatch(/^\d{3}$/);
      expect(Number(code) % 2).toBe(1);
    }
  });

  it('stores bare names — the "County" suffix is the resolver\'s job', () => {
    for (const name of Object.values(COUNTY_NAMES_BY_STATE.OK)) {
      expect(name).not.toMatch(/County$/);
    }
  });
});

describe('resolveCountyName', () => {
  it.each(Object.entries(FIXTURE_CODES))(
    'resolves OK %s to %s',
    (code, expected) => {
      expect(resolveCountyName('OK', code)).toBe(expected);
    },
  );

  it('tolerates how the code arrives', () => {
    // Zero-padded (what the RTP importer stores), unpadded, and the full
    // 5-digit state+county form some feeds carry.
    expect(resolveCountyName('OK', '017')).toBe('Canadian County');
    expect(resolveCountyName('OK', '17')).toBe('Canadian County');
    expect(resolveCountyName('OK', '40017')).toBe('Canadian County');
    expect(resolveCountyName('ok', ' 017 ')).toBe('Canadian County');
  });

  it('returns undefined rather than a stand-in for anything unmapped', () => {
    // A state we have no table for. The drawer omits the row; it must never
    // fall back to the raw code, which is what legacy showed producers.
    expect(resolveCountyName('IL', '143')).toBeUndefined();
    expect(resolveCountyName('OK', '999')).toBeUndefined();
    // Even codes do not exist in Oklahoma.
    expect(resolveCountyName('OK', '002')).toBeUndefined();
    expect(resolveCountyName(undefined, '143')).toBeUndefined();
    expect(resolveCountyName('OK', undefined)).toBeUndefined();
    expect(resolveCountyName('OK', '')).toBeUndefined();
    expect(resolveCountyName('OK', 'abc')).toBeUndefined();
  });
});
