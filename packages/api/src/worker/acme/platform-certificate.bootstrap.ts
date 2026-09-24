import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { platformHost } from '../../config/tenant-host.config';
import { CertificateIssuerService } from './certificate-issuer.service';

/**
 * Gets a certificate for the platform host itself.
 *
 * ## Why this needs its own trigger
 * Every other hostname is registered by `AgencyDomainsService.verify` — an
 * agency adds a domain, proves control, and the act of deciding it may serve is
 * what puts it in line for a certificate.
 *
 * The platform host has no such moment. Nobody adds `app.smithfamily.agency` in
 * Settings; it arrives as an environment variable and is simply expected to
 * work. Under Caddy that was invisible, because on-demand TLS issued for
 * whatever hostname was asked for at the first HTTPS request, platform host
 * included.
 *
 * Without this, the first deploy onto the Node edge would come up with Caddy
 * gone, no certificate for the platform host, and nothing anywhere that would
 * ever create one — the admin app simply unreachable over HTTPS, with the cause
 * being an absence rather than an error.
 *
 * ## Why at boot rather than on a schedule
 * `RenewCertificatesFn` would find the row on its next pass, so registration
 * alone would be enough within fifteen minutes. That is a long time to have no
 * admin app immediately after a deploy, so this also attempts issuance straight
 * away.
 *
 * A boot-time attempt can legitimately fail — the edge may not be listening on
 * port 80 yet, and the CA validates by fetching a URL there. That costs one
 * failed validation, which is bounded and cheap, and the backoff plus the sweep
 * recover it. Registering *first* is what makes the failure safe: the row
 * exists, so the sweep will retry regardless of what happens next.
 */
@Injectable()
export class PlatformCertificateBootstrap implements OnApplicationBootstrap {
  private readonly logger = new Logger(PlatformCertificateBootstrap.name);

  constructor(
    private readonly issuer: CertificateIssuerService,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.issuer.enabled()) return;

    // Resolved exactly the way `HostTenantResolver` resolves it — falling back
    // to the host of APP_BASE_URL — so the certificate is issued for the same
    // name the app answers on. Deriving it differently here would produce a
    // certificate for a hostname nobody visits.
    const host = platformHost(
      this.config.get<string>('PLATFORM_HOST'),
      this.config.get<string>('APP_BASE_URL'),
    );

    const hostname = await this.issuer.ensureRegistered(host);
    if (!hostname) {
      this.logger.warn(
        'PLATFORM_HOST did not resolve to a usable hostname; the platform host will have no certificate.',
      );
      return;
    }

    // `localhost` is the dev default and is not a name any CA will issue for.
    // Attempting it would fail every boot and spend a failed-validation
    // allowance on something that can never succeed.
    if (hostname === 'localhost' || !hostname.includes('.')) {
      this.logger.log(
        `Platform host is "${hostname}" — not a public name, so no certificate is requested.`,
      );
      return;
    }

    const outcome = await this.issuer.issue(hostname);
    if (outcome.status === 'failed') {
      // Not fatal, and deliberately not rethrown: the row is registered, so the
      // renewal sweep retries on its own schedule. A worker that refused to
      // start because a CA was slow would be strictly worse.
      this.logger.warn(
        `Could not obtain a certificate for the platform host ${hostname} at boot ` +
          `(${outcome.error}). The renewal sweep will retry.`,
      );
      return;
    }

    if (outcome.status === 'skipped') {
      // ⚠ Log the REASON, not just the status.
      //
      // "skipped" alone is indistinguishable between "another worker is already
      // doing it, all is well" and "a lock is held by a process that no longer
      // exists and nothing will happen until it expires". Those need completely
      // different responses, and the difference was being discarded one line
      // before it was printed.
      this.logger.warn(
        `Platform host ${hostname}: skipped — ${outcome.reason}`,
      );
      return;
    }

    this.logger.log(`Platform host ${hostname}: ${outcome.status}.`);
  }
}
