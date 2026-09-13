import { Inject, Injectable, Logger } from '@nestjs/common';
import { cron } from 'inngest';
import {
  INNGEST_CLIENT,
  type InngestClient,
} from '../../inngest/inngest.client';
import { CertificateIssuerService } from '../acme/certificate-issuer.service';
import {
  InngestFunction,
  type InngestFunctionProvider,
} from '../../inngest/inngest-registry.service';

/**
 * How many certificates one sweep will attempt.
 *
 * A cap rather than "everything", for the reason `SweepEventLogFn` gives: after
 * an outage the due list could be long, and attempting all of it at once would
 * burst a rate-limited third party at the exact moment things are fragile. The
 * next tick takes the next batch, so nothing is dropped — it drains at a bounded
 * rate.
 */
const RENEW_BATCH_SIZE = 20;

/**
 * Keeps every certificate current, and is the safety net for issuance.
 *
 * ## Why one sweep covers both jobs
 * `renewAfter` is set to *now* when a certificate row is created and to the
 * renewal point when one is issued, so "needs a first certificate" and "needs
 * renewing" are the same query. That is deliberate: it means a hostname whose
 * issuance event was lost — Inngest dropped it, the worker died, the run was
 * deduplicated away — is picked up here without anything having to notice that
 * it went missing.
 *
 * Certificate renewal is the one piece of unattended work where failing quietly
 * for weeks and then breaking every tenant at once is a realistic outcome. The
 * sweep existing, and being the same path as first issuance, is what makes that
 * unlikely rather than merely unlucky.
 *
 * ## Why this is one function and not one per node
 * A cron trigger fires the function once per schedule regardless of how many
 * worker containers are running — Inngest schedules it, the workers merely
 * serve it. Per-node renewal timers (Caddy's model) would have every node in the
 * pool wake up and race for the same certificates, coordinating only through
 * whatever lock the shared store provides.
 */
@Injectable()
@InngestFunction()
export class RenewCertificatesFn implements InngestFunctionProvider {
  private readonly logger = new Logger(RenewCertificatesFn.name);

  constructor(
    @Inject(INNGEST_CLIENT) private readonly inngest: InngestClient,
    private readonly issuer: CertificateIssuerService,
  ) {}

  build() {
    return this.inngest.createFunction(
      {
        id: 'renew-certificates',
        name: 'Renew TLS certificates',

        /**
         * Every fifteen minutes.
         *
         * Far more often than renewal needs — a certificate is due once every
         * couple of months — because this is also the retry path for a failed
         * first issuance. A tenant who has just pointed their DNS at us should
         * see their domain work in minutes, not on tomorrow's sweep. Rows that
         * are not due are excluded by an indexed query, so a tick with nothing
         * to do costs one index scan.
         *
         * Like `SweepEventLogFn`, the schedule survives the disaster it exists
         * for: cron registrations come from the function definitions Inngest
         * syncs at `/api/inngest`, so an Inngest that came back with an empty
         * database re-registers this on its next sync.
         */
        triggers: [cron('*/15 * * * *')],

        /**
         * One sweep at a time. Two overlapping sweeps would read the same due
         * rows; the per-hostname claim in the issuer makes that harmless, but it
         * is wasted work and it doubles the concurrent pressure on the CA.
         */
        concurrency: { limit: 1 },

        /**
         * No retries. The next tick is fifteen minutes away and will find
         * exactly the same rows, so retrying is a slower route to the same
         * place — and a sweep that failed outright usually means the database
         * is unhappy, which retrying does not address.
         */
        retries: 0,
      },
      ({ step }) => this.handle(step),
    );
  }

  async handle(step: StepLike): Promise<{ attempted: number }> {
    const due = (await step.run('find-due', () =>
      this.issuer.findDue(RENEW_BATCH_SIZE),
    )) as string[];

    if (due.length === 0) return { attempted: 0 };

    this.logger.log(
      `${due.length} certificate(s) due` +
        (due.length === RENEW_BATCH_SIZE
          ? ' (batch cap hit — the next sweep takes the rest)'
          : ''),
    );

    // Sequential, each in its own step. `step.run` memoizes on success, so a
    // sweep that dies partway through does not re-attempt what it already did —
    // which matters here more than in most sweeps, because a repeated attempt
    // is a repeated ACME order.
    for (const hostname of due) {
      await step.run(`issue-${hostname}`, () => this.issuer.issue(hostname));
    }

    return { attempted: due.length };
  }
}

/** The slice of Inngest's step tooling this handler uses. */
interface StepLike {
  run<T>(id: string, fn: () => Promise<T> | T): Promise<unknown>;
}
