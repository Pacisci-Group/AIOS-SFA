import {
  LETS_ENCRYPT_PRODUCTION,
  LETS_ENCRYPT_STAGING,
  acmeContactEmail,
  acmeDirectoryUrl,
  backoffAfterFailure,
  isProductionCa,
  renewalPoint,
} from './acme.config';

describe('acmeDirectoryUrl', () => {
  /**
   * The safety property this whole default exists for. An environment that
   * forgot to opt in must not spend Let's Encrypt's production rate limits —
   * those are counted per registered domain over a rolling week and cannot be
   * given back, and with white-labelling one account holds many domains.
   */
  it('defaults to staging when unset', () => {
    expect(acmeDirectoryUrl(undefined)).toBe(LETS_ENCRYPT_STAGING);
    expect(acmeDirectoryUrl('')).toBe(LETS_ENCRYPT_STAGING);
    expect(acmeDirectoryUrl('   ')).toBe(LETS_ENCRYPT_STAGING);
  });

  it('accepts the friendly aliases', () => {
    expect(acmeDirectoryUrl('staging')).toBe(LETS_ENCRYPT_STAGING);
    expect(acmeDirectoryUrl('production')).toBe(LETS_ENCRYPT_PRODUCTION);
  });

  /** So a private CA (Pebble, step-ca) can be pointed at for local testing. */
  it('passes an explicit URL through', () => {
    expect(acmeDirectoryUrl('https://pebble.test/dir')).toBe(
      'https://pebble.test/dir',
    );
  });

  it('knows which CA issues trusted certificates', () => {
    expect(isProductionCa(LETS_ENCRYPT_PRODUCTION)).toBe(true);
    expect(isProductionCa(LETS_ENCRYPT_STAGING)).toBe(false);
    expect(isProductionCa('https://pebble.test/dir')).toBe(false);
  });
});

describe('acmeContactEmail', () => {
  it('normalises absent values to null', () => {
    expect(acmeContactEmail(undefined)).toBeNull();
    expect(acmeContactEmail('  ')).toBeNull();
  });

  it('trims a supplied address', () => {
    expect(acmeContactEmail(' ops@example.com ')).toBe('ops@example.com');
  });
});

describe('renewalPoint', () => {
  const day = 86_400_000;

  /**
   * A third of the lifetime remaining. On Let's Encrypt's ninety-day
   * certificate that is thirty days of daily attempts that may all fail before
   * anything breaks.
   */
  it('leaves a third of the lifetime as slack', () => {
    const notBefore = new Date('2026-01-01T00:00:00.000Z');
    const notAfter = new Date(notBefore.getTime() + 90 * day);

    const renew = renewalPoint(notBefore, notAfter);

    expect(notAfter.getTime() - renew.getTime()).toBe(30 * day);
    expect(renew.getTime()).toBeGreaterThan(notBefore.getTime());
  });

  /**
   * The reason this is a fraction rather than "thirty days before expiry".
   * Certificate lifetimes are not a constant — shorter ones are already being
   * issued — and a hard-coded thirty days silently becomes "renew after it has
   * expired" the first time we are handed a shorter certificate.
   */
  it('scales with a shorter certificate instead of going negative', () => {
    const notBefore = new Date('2026-01-01T00:00:00.000Z');
    const notAfter = new Date(notBefore.getTime() + 6 * day);

    const renew = renewalPoint(notBefore, notAfter);

    expect(renew.getTime()).toBeGreaterThan(notBefore.getTime());
    expect(renew.getTime()).toBeLessThan(notAfter.getTime());
    expect(notAfter.getTime() - renew.getTime()).toBe(2 * day);
  });
});

describe('backoffAfterFailure', () => {
  const now = new Date('2026-01-01T00:00:00.000Z');
  const minutes = (from: Date) => (from.getTime() - now.getTime()) / 60_000;

  it('waits one base interval after the first failure', () => {
    expect(minutes(backoffAfterFailure(1, now))).toBe(15);
  });

  it('doubles with each consecutive failure', () => {
    expect(minutes(backoffAfterFailure(2, now))).toBe(30);
    expect(minutes(backoffAfterFailure(3, now))).toBe(60);
    expect(minutes(backoffAfterFailure(4, now))).toBe(120);
  });

  /**
   * The cap is what makes a permanently broken domain cost nothing. Without it
   * the doubling would either overflow into absurd delays or, if reset, keep
   * spending the CA's failed-validation allowance — which is per account and
   * per hostname, and blocks retries for hostnames that *would* have worked.
   */
  it('caps at a day however many times it has failed', () => {
    expect(minutes(backoffAfterFailure(20, now))).toBe(1440);
    expect(minutes(backoffAfterFailure(200, now))).toBe(1440);
  });

  /** Defensive: a zero or negative count must not produce a past date. */
  it('never schedules a retry in the past', () => {
    expect(backoffAfterFailure(0, now).getTime()).toBeGreaterThan(
      now.getTime(),
    );
  });
});
