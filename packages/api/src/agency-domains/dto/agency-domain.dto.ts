import { z } from 'zod';

/**
 * A hostname as typed by a human.
 *
 * Length-capped and trimmed here; **not** normalised or syntax-checked here.
 * Both of those need `normalizeHostname` / `isValidHostname`, and doing them in
 * the schema would produce a zod `transform`, which the codebase avoids in DTOs
 * for the same reason the Inngest event schemas ban it — the parsed value would
 * differ from what the caller sent, and the error message would name a value
 * the caller never typed. The service normalises, then reports precisely.
 */
const hostname = z
  .string()
  .trim()
  .min(3, 'Enter a domain.')
  .max(253, 'That is longer than a domain name can be.');

export const createAgencyDomainSchema = z.object({
  hostname,
  /**
   * Which flavour the caller intends.
   *
   * Declared rather than inferred from the string, so a typo in a subdomain
   * (`texasholdings.smithfamily.agencyy`) is rejected as a malformed subdomain
   * instead of silently accepted as a custom domain the owner then has to
   * verify and cannot.
   */
  kind: z.enum(['subdomain', 'custom']),
});

export type CreateAgencyDomainDto = z.infer<typeof createAgencyDomainSchema>;

/** What the settings page renders for one domain. */
export interface AgencyDomainView {
  id: string;
  hostname: string;
  kind: 'subdomain' | 'custom';
  status: 'pending' | 'active' | 'failed';
  isPrimary: boolean;
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  /**
   * The records the owner must publish, or `null` once there is nothing left to
   * do. Present on `pending` and `failed` custom domains only — a subdomain is
   * live the moment it is created and a verified domain has nothing to add.
   */
  dnsInstructions: DnsInstruction[] | null;
}

export interface DnsInstruction {
  type: 'TXT' | 'CNAME' | 'A';
  name: string;
  value: string;
  /** Why this record is needed, in the owner's terms. */
  purpose: string;
}
