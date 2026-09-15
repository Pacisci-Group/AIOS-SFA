import { Inject, Injectable } from '@nestjs/common';
import {
  INNGEST_CLIENT,
  type InngestClient,
} from '../../inngest/inngest.client';
import {
  certificateRequested,
  type CertificateRequestedData,
} from '../../inngest/events';
import {
  CertificateIssuerService,
  type IssuanceOutcome,
} from '../acme/certificate-issuer.service';
import {
  InngestFunction,
  type InngestFunctionProvider,
} from '../../inngest/inngest-registry.service';

/**
 * Obtains a certificate for a hostname that has just become eligible to serve.
 *
 * The first half of the certificate lifecycle; `RenewCertificatesFn` is the
 * other half and shares all the real logic through
 * {@link CertificateIssuerService}.
 */
@Injectable()
@InngestFunction()
export class IssueCertificateFn implements InngestFunctionProvider {
  constructor(
    @Inject(INNGEST_CLIENT) private readonly inngest: InngestClient,
    private readonly issuer: CertificateIssuerService,
  ) {}

  build() {
    return this.inngest.createFunction(
      {
        id: 'issue-certificate',
        name: 'Issue TLS certificate',
        triggers: [certificateRequested],

        /**
         * Collapses duplicate requests for the same hostname for 24h.
         *
         * A domain can be re-verified, and a verification endpoint can be
         * double-submitted; neither should place a second ACME order, because
         * Let's Encrypt counts identical certificates against a limit of five
         * per week and a tenant who clicks "verify" six times would spend it.
         *
         * Swallowing a genuine second request costs nothing, because it is not
         * the only path to issuance: `RenewCertificatesFn` sweeps anything whose
         * `renewAfter` has passed, and a failed first attempt sets that to a
         * backoff a few minutes out. The sweep is the safety net that lets this
         * be aggressive.
         */
        idempotency: 'event.data.hostname',

        /**
         * Two attempts, and they are not the retry mechanism for *issuance*.
         *
         * A failed ACME order does not throw — `issue()` records the failure,
         * schedules a backoff and returns `failed`, so the run completes. These
         * retries cover the narrow case of the database being unreachable while
         * claiming or recording, where retrying seconds later genuinely helps.
         *
         * Issuance backoff deliberately lives in `renewAfter` instead, because
         * it has to survive a process restart and stretch to hours — neither of
         * which an Inngest retry window can do.
         */
        retries: 2,

        /**
         * Two at a time across every worker. Enforced server-side by Inngest,
         * so it holds however many worker containers are running — which a
         * per-process limit could not.
         *
         * Low because the far side is a rate-limited third party whose limits
         * are counted per account. There is no throughput problem to solve here:
         * a burst of domain verifications is a handful of certificates, and
         * taking a minute longer costs nobody anything.
         */
        concurrency: { limit: 2 },
      },
      ({ event, step }) => this.handle(event, step),
    );
  }

  /**
   * Handler body, lifted out of `createFunction` so a test can call it with a
   * stub `step` — same seam and reasoning as `SendInviteEmailFn.handle`.
   */
  async handle(
    event: { data: CertificateRequestedData },
    step: StepLike,
  ): Promise<IssuanceOutcome> {
    const { hostname } = event.data;

    // One step, not several. `step.run` memoizes on success, and an ACME order
    // is emphatically not something to replay: splitting the claim, the order
    // and the store into separate steps would let a crash between them replay
    // the claim against a lock the previous attempt still holds. The service
    // already makes the whole attempt atomic from the caller's point of view.
    return (await step.run('issue', () =>
      this.issuer.issue(hostname),
    )) as IssuanceOutcome;
  }
}

/**
 * The slice of Inngest's step tooling this handler uses. Narrow on purpose —
 * it is the seam a test substitutes.
 */
interface StepLike {
  // `unknown` because Inngest returns `Jsonify<T>`: a step's result is
  // serialised and re-parsed before the next step sees it.
  run<T>(id: string, fn: () => Promise<T> | T): Promise<unknown>;
}
