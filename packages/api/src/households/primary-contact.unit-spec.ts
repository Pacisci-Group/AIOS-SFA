import { pickPrimaryContact } from './primary-contact';

const contact = (id: string, isPrimary = false) => ({ _id: id, isPrimary });

describe('pickPrimaryContact', () => {
  it('prefers the household ref over the flag', () => {
    const roster = [contact('a', true), contact('b')];
    expect(pickPrimaryContact(roster, 'b')).toBe(roster[1]);
  });

  it('falls back to the flag when the household carries no ref', () => {
    const roster = [contact('a'), contact('b', true)];
    expect(pickPrimaryContact(roster, undefined)).toBe(roster[1]);
  });

  /*
   * A migrated household: the SmartSuite import writes no `primaryContactId`,
   * and this is the case the Household page and drawer both rendered as an
   * em dash before the flag fallback existed on this read path.
   */
  it('falls back to the flag when the ref points at a contact outside the roster', () => {
    const roster = [contact('a'), contact('b', true)];
    expect(pickPrimaryContact(roster, 'gone')).toBe(roster[1]);
  });

  it('takes the first flagged contact when legacy flagged them all', () => {
    const roster = [contact('a', true), contact('b', true)];
    expect(pickPrimaryContact(roster, null)).toBe(roster[0]);
  });

  it('matches an ObjectId-like ref against a string id', () => {
    const roster = [contact('a'), contact('b')];
    expect(pickPrimaryContact(roster, { toString: () => 'b' })).toBe(roster[1]);
  });

  it('returns null when nothing names a primary', () => {
    expect(pickPrimaryContact([contact('a'), contact('b')], null)).toBeNull();
  });

  it('returns null for an empty roster', () => {
    expect(pickPrimaryContact([], 'a')).toBeNull();
  });
});
