import { z } from 'zod';
import { clearable, trimmedText } from '../../common/dto/clearable';
import type { SendingDnsRecord } from '../email-provider.client';

/**
 * The local part of an address: `hello` in `hello@texasholdings.com`.
 *
 * Deliberately narrower than RFC 5321 allows. The RFC permits quoted strings
 * and a great deal else that no agency wants and that every downstream parser
 * handles differently — and a local part is interpolated into a `From:` header,
 * so the conservative set is the safe one.
 */
const localPart = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(64)
  .regex(
    /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/,
    'Use letters, numbers, dots, hyphens and underscores.',
  );

export const updateAgencyEmailSchema = z.object({
  fromName: clearable(trimmedText(60)),
  fromLocalPart: clearable(localPart),
  replyTo: clearable(z.string().trim().toLowerCase().email().max(160)),
});
export type UpdateAgencyEmailDto = z.infer<typeof updateAgencyEmailSchema>;

export const setSendingDomainSchema = z.object({
  domain: z.string().trim().toLowerCase().min(3).max(253),
});
export type SetSendingDomainDto = z.infer<typeof setSendingDomainSchema>;

/** What the email-settings page renders. */
export interface AgencyEmailView {
  fromName: string | null;
  fromLocalPart: string | null;
  replyTo: string | null;
  sendingDomain: string | null;
  sendingStatus: 'platform' | 'pending' | 'verified' | 'failed';
  verifiedAt: string | null;
  lastError: string | null;
  /**
   * The address mail is **actually** going out as, right now.
   *
   * The single most important field on this screen. "Pending" and "verified"
   * look identical in a form, and an owner who has added DNS records but not
   * yet passed verification will otherwise believe they are sending from their
   * own domain when they are not.
   */
  effectiveFrom: string;
  /** DNS records to publish, or `null` once there is nothing left to do. */
  dnsRecords: SendingDnsRecord[] | null;
}
