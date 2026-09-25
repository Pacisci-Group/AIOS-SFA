import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { normalizeHostname } from '../common/tenancy/hostname';
import { Certificate, CertificateDocument } from './schemas/certificate.schema';

/**
 * Records that a hostname needs a certificate.
 *
 * ## Why this exists, rather than just sending the event
 * `RenewCertificatesFn` sweeps certificate rows whose `renewAfter` has passed,
 * and that sweep is what makes the whole subsystem self-healing — a lost event,
 * a dropped run, a worker that died mid-order all recover on the next tick.
 *
 * But a sweep can only find rows that exist. If the *only* thing that created a
 * row were the issuance function itself, then a verification whose event went
 * missing would leave a domain that is `active`, serves nothing over HTTPS, and
 * is invisible to the mechanism designed to catch exactly that. The failure
 * would surface as one tenant's domain never working, with nothing anywhere
 * saying why.
 *
 * So the row is written synchronously, in the same request that decided the
 * domain may serve. The event that follows is a **latency optimisation** — it
 * gets the certificate in seconds instead of within one sweep interval — and
 * never the guarantee. That inversion is the point: losing the optimisation
 * costs a few minutes, and there is no path that loses the guarantee.
 */
@Injectable()
export class CertificateRegistrationService {
  private readonly logger = new Logger(CertificateRegistrationService.name);

  constructor(
    @InjectModel(Certificate.name)
    private readonly certificates: Model<CertificateDocument>,
  ) {}

  /**
   * Ensure a certificate row exists for this hostname and is due now.
   *
   * Idempotent, and deliberately non-destructive: everything is `$setOnInsert`,
   * so calling it for a hostname that already holds a valid certificate does
   * nothing at all. Setting `renewAfter` unconditionally would drag a perfectly
   * good certificate into the next sweep and re-order it — which is both
   * pointless work and a charge against the CA's duplicate-certificate limit.
   */
  async register(rawHostname: string): Promise<void> {
    const hostname = normalizeHostname(rawHostname);
    if (!hostname) return;

    const now = new Date();
    await this.certificates.updateOne(
      { hostname },
      {
        $setOnInsert: {
          hostname,
          status: 'pending',
          renewAfter: now,
          failureCount: 0,
        },
      },
      { upsert: true },
    );

    this.logger.log(`${hostname} is registered for certificate issuance.`);
  }
}
