import { eventType } from 'inngest';
import { z } from 'zod';
import { eventEnvelope } from './envelope';

/**
 * Event contracts for certificate issuance.
 *
 * Obeys the same two rules as `email.events.ts`: no transforms (an event is
 * JSON on the wire, so `z.coerce.*`, `.default()`, `.transform()` and `.pipe()`
 * are all banned), and ids plus display fields only — never documents.
 */

/**
 * A hostname became eligible to serve traffic and needs a certificate.
 *
 * Emitted by `AgencyDomainsService.verify` the moment a domain reaches `active`,
 * and by the platform-host bootstrap on first boot.
 *
 * ## Why the trigger is verification rather than the first request
 * Caddy's on-demand TLS issued at the first HTTPS request for an unknown host,
 * gated by a callback asking whether we serve that name. That works, at the cost
 * of a latency spike on the first visit and of putting certificate issuance on
 * the request path — where a slow CA becomes a slow page load.
 *
 * Issuing at verification instead means the certificate is already in place
 * before anyone visits, the CA is never on a user-facing path, and the
 * "may we serve this name?" question is answered by the same transaction that
 * decided it — no cross-process gate to be misconfigured or unreachable.
 *
 * The tradeoff is a window between "verified" and "certificate ready" in which
 * HTTPS fails. `AgencyDomainsService` closes it by not presenting a domain as
 * live until its certificate exists.
 *
 * ## Why only a hostname
 * No `agencyId`, deliberately. Certificates are a platform-wide routing concern
 * — the platform host needs one and belongs to no agency — and the consumer has
 * no use for the tenant. Passing one would invite a handler that filters or
 * scopes by it, which is the shape of a bug the day the platform host is
 * renewed.
 */
const certificateRequestedSchema = z.object({
  ...eventEnvelope,
  /**
   * Already normalised by the caller (`normalizeHostname`): lowercase, no port,
   * no trailing dot.
   *
   * ⚠ The consumer normalises again rather than trusting this. Not defensive
   * habit — the certificate is stored under this key and looked up by the SNI
   * servername from a TLS handshake, so a single un-normalised row is a
   * hostname that can never be served, and nothing upstream would report it.
   */
  hostname: z.string().min(1),
});

export const certificateRequested = eventType('tls/certificate.requested.v1', {
  schema: certificateRequestedSchema,
});

/** Payload the issuance function receives. */
export type CertificateRequestedData = z.infer<
  typeof certificateRequestedSchema
>;
