import { apiFetch } from '@/lib/api-client';

export type SendingStatus = 'platform' | 'pending' | 'verified' | 'failed';

/** One DNS record from the email provider, shown verbatim to the owner. */
export interface SendingDnsRecord {
  record: string;
  type: string;
  name: string;
  value: string;
  priority?: number;
  ttl?: string;
}

export interface AgencyEmailSettings {
  fromName: string | null;
  fromLocalPart: string | null;
  replyTo: string | null;
  sendingDomain: string | null;
  sendingStatus: SendingStatus;
  verifiedAt: string | null;
  lastError: string | null;
  /**
   * The address mail is **actually** going out as, right now.
   *
   * Computed server-side with the same helper the worker uses to build the real
   * header, so it cannot drift. Show it prominently: "pending" and "verified"
   * are indistinguishable in a form, and an owner who has added DNS records but
   * not yet passed verification will otherwise believe they are already sending
   * from their own domain.
   */
  effectiveFrom: string;
  dnsRecords: SendingDnsRecord[] | null;
}

export function getEmailSettings(): Promise<AgencyEmailSettings> {
  return apiFetch<AgencyEmailSettings>('/agency/email');
}

export function updateEmailSettings(input: {
  fromName?: string | null;
  fromLocalPart?: string | null;
  replyTo?: string | null;
}): Promise<AgencyEmailSettings> {
  return apiFetch<AgencyEmailSettings>('/agency/email', {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function setSendingDomain(domain: string): Promise<AgencyEmailSettings> {
  return apiFetch<AgencyEmailSettings>('/agency/email/sending-domain', {
    method: 'POST',
    body: JSON.stringify({ domain }),
  });
}

/** Like domain verification, a failure returns 200 with `status: 'failed'`. */
export function verifySendingDomain(): Promise<AgencyEmailSettings> {
  return apiFetch<AgencyEmailSettings>('/agency/email/sending-domain/verify', {
    method: 'POST',
  });
}

export function clearSendingDomain(): Promise<AgencyEmailSettings> {
  return apiFetch<AgencyEmailSettings>('/agency/email/sending-domain', {
    method: 'DELETE',
  });
}
