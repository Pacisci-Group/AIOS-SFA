import { Injectable, Logger } from '@nestjs/common';
import { Resolver } from 'node:dns/promises';

/** Prefix of the TXT record an owner publishes to prove control of a domain. */
export const VERIFICATION_TXT_PREFIX = 'sfa-verify=';

/** Label the TXT record lives under: `_sfa-verify.texasholdings.com`. */
export const VERIFICATION_TXT_LABEL = '_sfa-verify';

export interface DnsVerificationResult {
  ok: boolean;
  /** Shown verbatim to the owner, so it must read as an instruction. */
  detail: string;
}

/**
 * Proves an agency controls a domain before we serve their app on it.
 *
 * ## Why this exists at all
 * `AgencyDomain.hostname` is unique platform-wide. Without proof of control,
 * the first agency to type `competitor.com` takes that hostname away from the
 * agency that actually owns it — permanently, and with no way for the rightful
 * owner to claim it. Verification is what makes a unique index safe.
 *
 * ## What counts as proof
 * A TXT record at `_sfa-verify.<domain>` containing the row's token. Ownership
 * of a subdomain of the zone is proof of control of the zone, which is the
 * standard every ACME and SaaS custom-domain flow uses.
 *
 * **Pointing DNS at us is checked separately and is not proof.** Anyone can
 * CNAME their own domain at our IP; that says nothing about who owns the name.
 * We still check it, because a domain that verifies but does not resolve to us
 * is a domain the owner will report as broken — but the TXT record is the part
 * that grants the claim.
 */
@Injectable()
export class DnsVerifier {
  private readonly logger = new Logger(DnsVerifier.name);

  /**
   * A resolver that talks to public DNS rather than the container's own
   * `/etc/hosts` and search domains.
   *
   * `dns.resolveTxt` (as opposed to `dns.lookup`) already bypasses the hosts
   * file, but an explicit `Resolver` also keeps the check independent of
   * whatever the Docker network's DNS decides to answer for a name — which in
   * a compose network can be "the web container".
   */
  private readonly resolver = new Resolver();

  /**
   * Whether the domain publishes the expected verification token.
   *
   * Treats *any* resolution failure as "not yet", never as an error: a domain
   * whose records have not propagated is the overwhelmingly common case, and
   * an owner who has just added a record needs "not visible yet, try again"
   * rather than a stack trace.
   */
  async hasVerificationToken(
    hostname: string,
    token: string,
  ): Promise<DnsVerificationResult> {
    const name = `${VERIFICATION_TXT_LABEL}.${hostname}`;
    const expected = `${VERIFICATION_TXT_PREFIX}${token}`;

    let records: string[][];
    try {
      records = await this.resolver.resolveTxt(name);
    } catch (err) {
      this.logger.debug(`TXT lookup failed for ${name}: ${String(err)}`);
      return {
        ok: false,
        detail: `No TXT record found at ${name}. DNS changes can take a few minutes to publish — add the record, then try again.`,
      };
    }

    // A TXT record arrives as an array of strings per record: long values are
    // split into 255-byte chunks by the protocol and must be rejoined before
    // comparison, or a token near that boundary silently never matches.
    const values = records.map((chunks) => chunks.join(''));

    if (!values.includes(expected)) {
      return {
        ok: false,
        detail: `Found a TXT record at ${name}, but not the expected value. Set it to exactly: ${expected}`,
      };
    }

    return { ok: true, detail: 'Ownership verified.' };
  }

  /**
   * Whether the domain currently points at `expectedTarget` (by CNAME) or at
   * any of `expectedIps` (by A record).
   *
   * Both are accepted because an **apex domain cannot legally carry a CNAME**
   * (RFC 1034) — `texasholdings.com` has to be an A record while
   * `www.texasholdings.com` can be a CNAME. Checking only one would make the
   * apex case, which is what most agencies actually want, permanently
   * unverifiable.
   *
   * A failure here is advisory: {@link hasVerificationToken} is what grants the
   * claim. This is what turns "it doesn't work" into "your DNS isn't pointing
   * here yet".
   */
  async pointsAtUs(
    hostname: string,
    expectedTarget: string,
    expectedIps: string[],
  ): Promise<DnsVerificationResult> {
    const cname = await this.resolver
      .resolveCname(hostname)
      .catch((): string[] => []);

    if (cname.some((t) => t.replace(/\.$/, '') === expectedTarget)) {
      return {
        ok: true,
        detail: `Points here via CNAME to ${expectedTarget}.`,
      };
    }

    // Only worth an A lookup if we know what to compare against. With no
    // configured IP, say so rather than reporting a failure the owner cannot act
    // on — the deployment is misconfigured, not their DNS.
    if (!expectedIps.length) {
      return {
        ok: false,
        detail: `No CNAME to ${expectedTarget} found, and no server address is configured to check an A record against.`,
      };
    }

    const a = await this.resolver.resolve4(hostname).catch((): string[] => []);
    if (a.some((ip) => expectedIps.includes(ip))) {
      return { ok: true, detail: 'Points here via an A record.' };
    }

    return {
      ok: false,
      detail: `${hostname} does not point here yet. Add a CNAME to ${expectedTarget}, or an A record to ${expectedIps.join(' / ')}.`,
    };
  }
}
