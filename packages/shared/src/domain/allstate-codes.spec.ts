import {
  bindIdError,
  normalizeBindId,
  normalizeSubProducerCode,
  subProducerCodeError,
} from './allstate-codes';

describe('normalizeBindId', () => {
  it('upper-cases and trims, as Dash prints it', () => {
    expect(normalizeBindId('SOK5pe0t')).toBe('SOK5PE0T');
    expect(normalizeBindId(' sokv4ucq ')).toBe('SOKV4UCQ');
  });

  it('reads blank as null', () => {
    expect(normalizeBindId('   ')).toBeNull();
    expect(normalizeBindId(null)).toBeNull();
    expect(normalizeBindId(undefined)).toBeNull();
  });
});

describe('normalizeSubProducerCode', () => {
  it('pads the digits Excel dropped', () => {
    expect(normalizeSubProducerCode(34)).toBe('034');
    expect(normalizeSubProducerCode('34')).toBe('034');
    expect(normalizeSubProducerCode('7')).toBe('007');
    expect(normalizeSubProducerCode('555')).toBe('555');
  });

  it('reads 000 — Allstate’s “no sub-producer” — and blank as null', () => {
    expect(normalizeSubProducerCode('000')).toBeNull();
    expect(normalizeSubProducerCode(0)).toBeNull();
    expect(normalizeSubProducerCode(' ')).toBeNull();
  });
});

describe('bindIdError', () => {
  it('accepts a login as Dash prints it, in any case, and blank', () => {
    expect(bindIdError('SOK5PE0T')).toBeNull();
    expect(bindIdError('sjm-rcm')).toBeNull();
    expect(bindIdError('')).toBeNull();
  });

  it('refuses spaces and over-long values', () => {
    expect(bindIdError('SOK 5PE0T')).not.toBeNull();
    expect(bindIdError('X'.repeat(33))).not.toBeNull();
  });
});

describe('subProducerCodeError', () => {
  it('accepts up to three digits, and blank', () => {
    expect(subProducerCodeError('034')).toBeNull();
    expect(subProducerCodeError('34')).toBeNull();
    expect(subProducerCodeError('')).toBeNull();
  });

  it('refuses 000 and anything that is not digits', () => {
    expect(subProducerCodeError('000')).toMatch(/no sub-producer/);
    expect(subProducerCodeError('0')).toMatch(/no sub-producer/);
    expect(subProducerCodeError('0345')).not.toBeNull();
    expect(subProducerCodeError('A12')).not.toBeNull();
  });
});
