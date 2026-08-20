import { Inject, Injectable } from '@nestjs/common';
import {
  INNGEST_CLIENT,
  type InngestClient,
} from '../../inngest/inngest.client';
import {
  inviteRequested,
  type InviteRequestedData,
} from '../../inngest/events';
import {
  MailDeliveryService,
  type SentEmail,
} from '../email/mail-delivery.service';
import {
  InngestFunction,
  type InngestFunctionProvider,
} from '../../inngest/inngest-registry.service';

@Injectable()
@InngestFunction()
export class SendInviteEmailFn implements InngestFunctionProvider {
  constructor(
    @Inject(INNGEST_CLIENT) private readonly inngest: InngestClient,
    private readonly mail: MailDeliveryService,
  ) {}

  build() {
    return this.inngest.createFunction(
      {
        id: 'send-invite-email',
        name: 'Send invite email',
        triggers: [inviteRequested],

        /**
         * Collapses duplicate *events* for 24h.
         *
         * Keyed on the invite URL because the URL contains the token, and the
         * token is what makes one invite distinct from another. That gives
         * exactly the behaviour the invite flow wants: a double-submitted or
         * retried `POST /users/:id/invite` for the same token sends one email,
         * while a genuine **resend** mints a new token, produces a new URL, and
         * correctly sends again — which it must, since resend is the owner's
         * only recovery when the first invite goes astray.
         */
        idempotency: 'event.data.inviteUrl',

        /**
         * Four attempts. Enough to ride out a Resend blip or a brief network
         * partition; not so many that a genuinely bad address sits retrying for
         * an hour. Permanent provider errors short-circuit this entirely by
         * throwing `NonRetriableError` — see `ResendTransport`.
         */
        retries: 4,

        /**
         * Resend's default account limit is 2 requests/second. This cap is
         * per-function across every worker process (Inngest enforces it
         * server-side), which a per-process limit could not do once the worker
         * scales past one container.
         */
        concurrency: { limit: 5 },
      },
      ({ event, step }) => this.handle(event, step),
    );
  }

  /**
   * The handler body, lifted out of `createFunction` so it can be called
   * directly.
   *
   * A handler written inline is only reachable by standing up a real Inngest
   * server and posting an event at it — which tests the platform, not our code.
   * Taking `step` as a parameter lets a test pass `{ run: (_, fn) => fn() }`
   * and exercise exactly the logic we wrote.
   */
  async handle(
    event: { id?: string; name: string; data: InviteRequestedData },
    step: StepLike,
  ): Promise<{ providerMessageId: string }> {
    const context = {
      eventId: event.id ?? '',
      eventType: event.name,
      agencyId: event.data.agencyId,
      branchId: event.data.branchId,
    };

    // Two steps, deliberately. `step.run` memoizes on success, so if the
    // process dies between these two the retry replays the send's stored
    // result instead of re-sending, and only the record is written again.
    // Collapsing them into one step would make a crash after the send but
    // before the write re-send the email.
    //
    // The cast reflects something real rather than papering over a mismatch:
    // a step's return value is **serialised to JSON and parsed back** before
    // the next step sees it, so Inngest types `step.run` as returning
    // `Jsonify<T>`, not `T`. `SentEmail` is entirely strings, so the two are
    // identical here and the cast is sound.
    //
    // ⚠ That is a constraint on what a step may return, not a quirk of this
    // one: put a `Date` in a step result and the next step receives a string.
    const sent = (await step.run('send', () =>
      this.mail.send('invite', event.data, event.data.inviteUrl),
    )) as SentEmail;

    await step.run('record', () => this.mail.record(context, sent));

    return { providerMessageId: sent.providerMessageId };
  }
}

/**
 * The slice of Inngest's step tooling this handler uses.
 *
 * Narrow on purpose: it is the seam a test substitutes, and depending on the
 * full step API would make that substitution a chore for no benefit.
 */
interface StepLike {
  // Returns `unknown` rather than `T` because Inngest returns `Jsonify<T>` —
  // see the note at the call site. Callers narrow with a cast they can justify.
  run<T>(id: string, fn: () => Promise<T> | T): Promise<unknown>;
}
