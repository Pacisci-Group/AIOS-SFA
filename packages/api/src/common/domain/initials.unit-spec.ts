import { initialsFrom } from './initials';

describe('initialsFrom', () => {
  it('takes first and last initial', () => {
    expect(initialsFrom('Pat Producer')).toBe('PP');
  });

  it('skips middle names', () => {
    expect(initialsFrom('Ada Marie Lovelace')).toBe('AL');
  });

  it('handles a single name', () => {
    expect(initialsFrom('Cher')).toBe('C');
  });

  it('tolerates extra whitespace', () => {
    expect(initialsFrom('  Pat   Producer  ')).toBe('PP');
  });

  it('uppercases a lowercase name', () => {
    expect(initialsFrom('pat producer')).toBe('PP');
  });

  it('falls back rather than throwing on an empty name', () => {
    // An empty avatar reads as a rendering bug, and no caller is equipped to
    // handle a blank here.
    expect(initialsFrom('')).toBe('?');
    expect(initialsFrom('   ')).toBe('?');
  });
});
