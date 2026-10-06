import { ServiceUnavailableException } from '@nestjs/common';
import { Resend } from 'resend';
import { normalizeStatus, ResendEmailProvider } from './email-provider.client';

const DOMAIN_ID = 'd91cd9bd-1176-453e-8fc1-35364d380206';

/**
 * A Resend fake whose `domains.get` answers with each status in turn — one per
 * call — so a test can model the provider's state moving between calls.
 */
function providerWith(statuses: string[]) {
  const get = jest.fn();
  for (const status of statuses) {
    get.mockResolvedValueOnce({
      data: { id: DOMAIN_ID, status, records: [] },
      error: null,
    });
  }
  const verify = jest
    .fn()
    .mockResolvedValue({ data: { id: DOMAIN_ID }, error: null });
  const resend = { domains: { get, verify } } as unknown as Resend;
  return { provider: new ResendEmailProvider(resend), get, verify };
}

/**
 * The hazard these pin: **`domains.verify` resets the domain to `pending`
 * regardless of its current status.** Triggering it and reading straight
 * after always reads `pending`, so a domain with correct DNS could never be
 * observed as verified (PAC-151).
 */
describe('ResendEmailProvider.verifyDomain', () => {
  it('reports an already-verified domain without re-triggering the check', async () => {
    const { provider, verify } = providerWith(['verified']);

    await expect(provider.verifyDomain(DOMAIN_ID)).resolves.toMatchObject({
      status: 'verified',
    });
    // Triggering here would knock a verified domain back to `pending`.
    expect(verify).not.toHaveBeenCalled();
  });

  it('treats partially_verified as verified and does not re-trigger', async () => {
    const { provider, verify } = providerWith(['partially_verified']);

    await expect(provider.verifyDomain(DOMAIN_ID)).resolves.toMatchObject({
      status: 'verified',
    });
    expect(verify).not.toHaveBeenCalled();
  });

  it('triggers a re-check while unverified and reports the state after it', async () => {
    const { provider, get, verify } = providerWith(['not_started', 'pending']);

    await expect(provider.verifyDomain(DOMAIN_ID)).resolves.toMatchObject({
      status: 'pending',
    });
    expect(verify).toHaveBeenCalledWith(DOMAIN_ID);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('observes the outcome of the previous press on the next press', async () => {
    // Press 1 starts the check; Resend finishes it in the background; press 2
    // must read that result rather than reset it.
    const { provider, verify } = providerWith([
      'not_started',
      'pending',
      'verified',
    ]);

    await provider.verifyDomain(DOMAIN_ID);
    await expect(provider.verifyDomain(DOMAIN_ID)).resolves.toMatchObject({
      status: 'verified',
    });
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it('throws when Resend refuses to start verification', async () => {
    const { provider, verify } = providerWith(['pending']);
    verify.mockResolvedValueOnce({
      data: null,
      error: { message: 'rate limited' },
    });

    await expect(provider.verifyDomain(DOMAIN_ID)).rejects.toThrow(
      ServiceUnavailableException,
    );
  });
});

describe('normalizeStatus', () => {
  it.each([
    ['verified', 'verified'],
    ['partially_verified', 'verified'],
    ['not_started', 'pending'],
    ['pending', 'pending'],
    ['failed', 'failed'],
    ['temporary_failure', 'failed'],
    [undefined, 'pending'],
  ])('maps %s to %s', (raw, expected) => {
    expect(normalizeStatus(raw)).toBe(expected);
  });
});
