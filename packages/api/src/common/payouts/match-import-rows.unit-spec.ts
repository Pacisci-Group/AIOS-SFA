import {
  personNameKey,
  resolvePerson,
  type PersonSignals,
} from './match-import-rows';

const NONE: PersonSignals = {
  sokGiven: false,
  nameGiven: false,
  sokUser: null,
  nameUser: null,
  nameAmbiguous: false,
  policyFound: false,
  seller: null,
};

describe('resolvePerson', () => {
  it('charges the SOK number’s user, whatever else the line says', () => {
    expect(
      resolvePerson({
        ...NONE,
        sokGiven: true,
        sokUser: 'sok',
        nameGiven: true,
        nameUser: 'name',
        policyFound: true,
        seller: 'seller',
      }),
    ).toEqual({
      userId: 'sok',
      resolution: 'matched',
      notes: ['sok_seller_differ'],
      candidates: [
        { userId: 'sok', via: 'sok' },
        { userId: 'name', via: 'name' },
        { userId: 'seller', via: 'policy' },
      ],
    });
  });

  it('matches when the name and the policy’s seller agree', () => {
    expect(
      resolvePerson({
        ...NONE,
        nameGiven: true,
        nameUser: 'jess',
        policyFound: true,
        seller: 'jess',
      }),
    ).toEqual({
      userId: 'jess',
      resolution: 'matched',
      notes: [],
      candidates: [{ userId: 'jess', via: 'name' }],
    });
  });

  it('matches on the name alone when the policy is not in the app', () => {
    expect(
      resolvePerson({ ...NONE, nameGiven: true, nameUser: 'jess' }),
    ).toMatchObject({
      userId: 'jess',
      resolution: 'matched',
      notes: ['policy_not_found'],
    });
  });

  it('matches on the name alone when the policy has no sale', () => {
    expect(
      resolvePerson({
        ...NONE,
        nameGiven: true,
        nameUser: 'jess',
        policyFound: true,
      }),
    ).toMatchObject({ userId: 'jess', notes: ['policy_no_sale'] });
  });

  it('charges the policy’s seller when the name is no user, and says so', () => {
    expect(
      resolvePerson({
        ...NONE,
        sokGiven: true,
        nameGiven: true,
        policyFound: true,
        seller: 'seller',
      }),
    ).toEqual({
      userId: 'seller',
      resolution: 'matched',
      notes: ['sok_unknown', 'name_unknown', 'seller_used'],
      candidates: [{ userId: 'seller', via: 'policy' }],
    });
  });

  it('treats a name two users share as no match', () => {
    expect(
      resolvePerson({
        ...NONE,
        nameGiven: true,
        nameAmbiguous: true,
        policyFound: true,
        seller: 'seller',
      }),
    ).toMatchObject({
      userId: 'seller',
      notes: ['name_ambiguous', 'seller_used'],
    });
  });

  it('asks for a person when the name and the seller disagree, offering both', () => {
    expect(
      resolvePerson({
        ...NONE,
        nameGiven: true,
        nameUser: 'jess',
        policyFound: true,
        seller: 'justin',
      }),
    ).toEqual({
      userId: null,
      resolution: 'unmatched',
      notes: ['name_seller_differ'],
      candidates: [
        { userId: 'jess', via: 'name' },
        { userId: 'justin', via: 'policy' },
      ],
    });
  });

  it('asks for a person when nothing matches', () => {
    expect(resolvePerson({ ...NONE, sokGiven: true, nameGiven: true })).toEqual(
      {
        userId: null,
        resolution: 'unmatched',
        notes: ['sok_unknown', 'name_unknown', 'policy_not_found'],
        candidates: [],
      },
    );
  });
});

describe('personNameKey', () => {
  it.each([
    ['Jessica Yates', 'jessica yates'],
    ['  JESSICA   yates ', 'jessica yates'],
    ['Yates, Jessica', 'jessica yates'],
    ['José Núñez', 'jose nunez'],
    ["Shawna O'Neil-Adams", 'shawna o neil adams'],
  ])('%s → %s', (raw, key) => {
    expect(personNameKey(raw)).toBe(key);
  });

  it('is null for a blank name', () => {
    expect(personNameKey('  ')).toBeNull();
    expect(personNameKey(null)).toBeNull();
  });
});
