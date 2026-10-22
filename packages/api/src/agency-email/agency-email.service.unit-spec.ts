import { ConfigService } from '@nestjs/config';
import type { Model } from 'mongoose';
import type { AgencyDocument } from '../platform/schemas/agency.schema';
import { AgencyEmailService } from './agency-email.service';
import {
  EmailProviderClient,
  type SendingDomain,
  type SendingDomainStatus,
} from './email-provider.client';

const AGENCY_ID = '64b7f0c2a1b2c3d4e5f60718';

/** A minimal stand-in for the agency document the service loads and saves. */
function agencyIn(sendingStatus: string, verifiedAt: Date | null = null) {
  return {
    name: 'Smith Family',
    email: {
      sendingDomain: 'example.com',
      providerDomainId: 'dom-1',
      sendingStatus,
      verifiedAt,
      lastError: null as string | null,
    },
    settings: {},
    markModified: jest.fn(),
    save: jest.fn().mockResolvedValue(undefined),
  };
}

function serviceFor(
  agency: ReturnType<typeof agencyIn>,
  provider: Partial<EmailProviderClient>,
) {
  const model = {
    findById: jest.fn().mockResolvedValue(agency),
  } as unknown as Model<AgencyDocument>;
  const config = { get: () => undefined } as unknown as ConfigService;
  return new AgencyEmailService(model, provider as EmailProviderClient, config);
}

const domain = (status: SendingDomainStatus): SendingDomain => ({
  providerDomainId: 'dom-1',
  status,
  records: [],
});

describe('AgencyEmailService.verifySendingDomain', () => {
  it('says the check is in progress while pending, not that DNS is missing', async () => {
    const agency = agencyIn('pending');
    const service = serviceFor(agency, {
      verifyDomain: jest.fn().mockResolvedValue(domain('pending')),
    });

    const view = await service.verifySendingDomain(AGENCY_ID);

    expect(view.sendingStatus).toBe('pending');
    expect(view.lastError).toMatch(/Checking your DNS records/);
  });

  it('keeps the DNS message for a failed check', async () => {
    const agency = agencyIn('pending');
    const service = serviceFor(agency, {
      verifyDomain: jest.fn().mockResolvedValue(domain('failed')),
    });

    const view = await service.verifySendingDomain(AGENCY_ID);

    expect(view.sendingStatus).toBe('failed');
    expect(view.lastError).toMatch(/not visible yet/);
  });

  it('stamps verifiedAt on the transition and clears the error', async () => {
    const agency = agencyIn('pending');
    const service = serviceFor(agency, {
      verifyDomain: jest.fn().mockResolvedValue(domain('verified')),
    });

    const view = await service.verifySendingDomain(AGENCY_ID);

    expect(view.sendingStatus).toBe('verified');
    expect(view.lastError).toBeNull();
    expect(view.verifiedAt).not.toBeNull();
  });

  it('does not move verifiedAt when an already-verified domain is re-checked', async () => {
    const original = new Date('2026-01-01T00:00:00Z');
    const agency = agencyIn('verified', original);
    const service = serviceFor(agency, {
      verifyDomain: jest.fn().mockResolvedValue(domain('verified')),
    });

    const view = await service.verifySendingDomain(AGENCY_ID);

    expect(view.verifiedAt).toBe(original.toISOString());
  });
});

describe('AgencyEmailService.get', () => {
  it('picks up a check that finished since the last press, without triggering one', async () => {
    const agency = agencyIn('pending');
    const verifyDomain = jest.fn();
    const getDomain = jest.fn().mockResolvedValue(domain('verified'));
    const service = serviceFor(agency, { getDomain, verifyDomain });

    const view = await service.get(AGENCY_ID);

    expect(view.sendingStatus).toBe('verified');
    expect(agency.save).toHaveBeenCalled();
    expect(verifyDomain).not.toHaveBeenCalled();
  });

  it('does not write when the provider is still checking', async () => {
    const agency = agencyIn('pending');
    const service = serviceFor(agency, {
      getDomain: jest.fn().mockResolvedValue(domain('pending')),
    });

    await service.get(AGENCY_ID);

    expect(agency.save).not.toHaveBeenCalled();
  });

  it('serves the stored state when the provider is unreachable', async () => {
    const agency = agencyIn('pending');
    const service = serviceFor(agency, {
      getDomain: jest.fn().mockRejectedValue(new Error('down')),
    });

    await expect(service.get(AGENCY_ID)).resolves.toMatchObject({
      sendingStatus: 'pending',
    });
  });

  it('does not call the provider unless pending', async () => {
    const agency = agencyIn('verified', new Date());
    const getDomain = jest.fn();
    const service = serviceFor(agency, { getDomain });

    await service.get(AGENCY_ID);

    expect(getDomain).not.toHaveBeenCalled();
  });
});
