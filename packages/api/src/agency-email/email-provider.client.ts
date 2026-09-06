import {
  Logger,
  ServiceUnavailableException,
  type Provider,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

/** One DNS record the agency must publish for their sending domain. */
export interface SendingDnsRecord {
  /** What it is for, as the provider labels it: `SPF`, `DKIM`, `Tracking`. */
  record: string;
  type: string;
  name: string;
  value: string;
  priority?: number;
  ttl?: string;
}

/**
 * Provider-side verification state, normalised to our four values.
 *
 * Resend reports `not_started`, `pending`, `verified`, `failed` and
 * `temporary_failure`. We collapse the first two to `pending` and both failure
 * modes to `failed`, because the only decision anything downstream makes is
 * "may we send from this domain?" — and for every value except `verified` the
 * answer is no.
 */
export type SendingDomainStatus = 'pending' | 'verified' | 'failed';

export interface SendingDomain {
  providerDomainId: string;
  status: SendingDomainStatus;
  records: SendingDnsRecord[];
}

/**
 * The provider boundary for **domain administration**, deliberately separate
 * from `MailTransport`, which is the boundary for *sending*.
 *
 * Two boundaries rather than one because they live on opposite sides of the
 * worker split: sending happens in the worker (possibly its own container),
 * while registering a domain is a synchronous thing an agency owner does in the
 * settings UI and must get an answer to. Merging them would drag the worker's
 * transport into the API's request path.
 */
export abstract class EmailProviderClient {
  abstract createDomain(name: string): Promise<SendingDomain>;
  abstract getDomain(providerDomainId: string): Promise<SendingDomain>;
  /** Ask the provider to re-check DNS. Verification is asynchronous. */
  abstract verifyDomain(providerDomainId: string): Promise<SendingDomain>;
  abstract removeDomain(providerDomainId: string): Promise<void>;
}

/**
 * What runs with no `RESEND_API_KEY` — i.e. all of local development.
 *
 * Refuses rather than pretending. A stub that returned "verified" would be
 * actively harmful: `SenderIdentityService` would then build a `From:` on a
 * domain nothing has verified, and the first real send would fail
 * non-retriably. Refusing keeps the agency on the platform sender, which works.
 */
export class UnavailableEmailProvider extends EmailProviderClient {
  private readonly logger = new Logger(UnavailableEmailProvider.name);

  private refuse(): never {
    this.logger.warn(
      'A custom sending domain was requested but RESEND_API_KEY is not set.',
    );
    throw new ServiceUnavailableException(
      'Custom sending domains are not available on this deployment. Email will continue to send from the platform address.',
    );
  }

  createDomain(): Promise<SendingDomain> {
    this.refuse();
  }
  getDomain(): Promise<SendingDomain> {
    this.refuse();
  }
  verifyDomain(): Promise<SendingDomain> {
    this.refuse();
  }
  removeDomain(): Promise<void> {
    this.refuse();
  }
}

/** Resend's shape for a domain, narrowed to what we read. */
interface ResendDomain {
  id: string;
  status?: string;
  records?: SendingDnsRecord[] | null;
}

export class ResendEmailProvider extends EmailProviderClient {
  constructor(private readonly resend: Resend) {
    super();
  }

  async createDomain(name: string): Promise<SendingDomain> {
    const { data, error } = await this.resend.domains.create({ name });
    return this.unwrap(data, error);
  }

  async getDomain(providerDomainId: string): Promise<SendingDomain> {
    const { data, error } = await this.resend.domains.get(providerDomainId);
    return this.unwrap(data, error);
  }

  /**
   * Trigger a re-check, then read the result back.
   *
   * Two calls on purpose: **`domains.verify` is asynchronous** and its response
   * does not carry the outcome. Reporting its return value as the status would
   * tell an owner "still pending" forever, even once DNS was correct — the
   * follow-up `get` is what actually observes the transition.
   */
  async verifyDomain(providerDomainId: string): Promise<SendingDomain> {
    const { error } = await this.resend.domains.verify(providerDomainId);
    if (error) {
      throw new ServiceUnavailableException(
        `Could not start verification: ${error.message}`,
      );
    }
    return this.getDomain(providerDomainId);
  }

  async removeDomain(providerDomainId: string): Promise<void> {
    // A failure here is not worth blocking the owner: the local record is what
    // decides whether we send from the domain, and a leftover row at the
    // provider costs nothing but tidiness.
    await this.resend.domains.remove(providerDomainId).catch(() => undefined);
  }

  /**
   * The Resend SDK **resolves with `{ data: null, error }` on failure rather
   * than throwing** — the same trap `ResendTransport` documents at length. An
   * unchecked `await` here would read as success and store a domain id of
   * `undefined`.
   */
  private unwrap(
    data: ResendDomain | null,
    error: { message: string } | null,
  ): SendingDomain {
    if (error || !data?.id) {
      throw new ServiceUnavailableException(
        error?.message ?? 'The email provider returned no domain.',
      );
    }

    return {
      providerDomainId: data.id,
      status: normalizeStatus(data.status),
      records: data.records ?? [],
    };
  }
}

/** See {@link SendingDomainStatus} for why five values collapse to three. */
function normalizeStatus(raw: string | undefined): SendingDomainStatus {
  if (raw === 'verified') return 'verified';
  if (raw === 'failed' || raw === 'temporary_failure') return 'failed';
  return 'pending';
}

/**
 * Mirrors `mailTransportProvider`: the configured implementation, otherwise one
 * that refuses. Same key, so a deployment that can send can also register
 * domains, and one that cannot does neither.
 */
export const emailProviderClientProvider: Provider = {
  provide: EmailProviderClient,
  inject: [ConfigService],
  useFactory: (config: ConfigService): EmailProviderClient => {
    const apiKey = config.get<string>('RESEND_API_KEY');
    return apiKey
      ? new ResendEmailProvider(new Resend(apiKey))
      : new UnavailableEmailProvider();
  },
};
