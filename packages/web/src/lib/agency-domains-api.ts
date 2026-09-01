import { apiFetch } from '@/lib/api-client';

export type AgencyDomainKind = 'subdomain' | 'custom';
export type AgencyDomainStatus = 'pending' | 'active' | 'failed';

/** One record the owner has to publish at their DNS provider. */
export interface DnsInstruction {
  type: 'TXT' | 'CNAME' | 'A';
  name: string;
  value: string;
  purpose: string;
}

export interface AgencyDomain {
  id: string;
  hostname: string;
  kind: AgencyDomainKind;
  status: AgencyDomainStatus;
  isPrimary: boolean;
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  /** Present only while a custom domain is not yet active. */
  dnsInstructions: DnsInstruction[] | null;
}

export function listDomains(): Promise<AgencyDomain[]> {
  return apiFetch<AgencyDomain[]>('/agency/domains');
}

export function addDomain(input: {
  hostname: string;
  kind: AgencyDomainKind;
}): Promise<AgencyDomain> {
  return apiFetch<AgencyDomain>('/agency/domains', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/**
 * Re-check DNS.
 *
 * A `failed` result comes back as a **200 with `status: 'failed'`**, not an
 * error — the reason lives in `lastError` and is the whole point of pressing
 * the button. Do not treat a resolved promise as success.
 */
export function verifyDomain(domainId: string): Promise<AgencyDomain> {
  return apiFetch<AgencyDomain>(`/agency/domains/${domainId}/verify`, {
    method: 'POST',
  });
}

export function setPrimaryDomain(domainId: string): Promise<AgencyDomain> {
  return apiFetch<AgencyDomain>(`/agency/domains/${domainId}/primary`, {
    method: 'PATCH',
  });
}

export function removeDomain(domainId: string): Promise<void> {
  return apiFetch<void>(`/agency/domains/${domainId}`, { method: 'DELETE' });
}
