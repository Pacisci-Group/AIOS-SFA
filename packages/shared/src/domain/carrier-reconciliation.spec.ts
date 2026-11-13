import { RECONCILIATION_PRODUCER_KEY_PATTERN } from './carrier-reconciliation';

describe('RECONCILIATION_PRODUCER_KEY_PATTERN', () => {
  it.each([
    'user:6a95f0c1d2e3f4a5b6c7d8e9',
    'code:034',
    'bind:SOK35W06',
    'bind:SJM-RCM',
    'none',
  ])('accepts %s', (key) => {
    expect(RECONCILIATION_PRODUCER_KEY_PATTERN.test(key)).toBe(true);
  });

  it.each(['user:pat', 'bind:', 'bind:SOK 35W06', 'everyone'])(
    'refuses %s',
    (key) => {
      expect(RECONCILIATION_PRODUCER_KEY_PATTERN.test(key)).toBe(false);
    },
  );
});
