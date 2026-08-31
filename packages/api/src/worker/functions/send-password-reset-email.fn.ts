import { Inject, Injectable } from '@nestjs/common';
import {
  INNGEST_CLIENT,
  type InngestClient,
} from '../../inngest/inngest.client';
import {
  passwordResetRequested,
  type PasswordResetRequestedData,
} from '../../inngest/events';
import {
  MailDeliveryService,
  type SentEmail,
} from '../email/mail-delivery.service';
import {
  InngestFunction,
  type InngestFunctionProvider,
} from '../../inngest/inngest-registry.service';

/**
 * Deliver the admin-triggered password-reset email (PAC-79).
 *
 * A near-twin of `SendInviteEmailFn`, kept as a separate function rather than a
 * second trigger on that one so the two can be paused, replayed and
 * rate-limited independently — a reset is how the 14 migrated users get in at
 * all, and it should not be stuck behind a backlog of invites.
 */
@Injectable()
@InngestFunction()
export class SendPasswordResetEmailFn implements InngestFunctionProvider {
  constructor(
    @Inject(INNGEST_CLIENT) private readonly inngest: InngestClient,
    private readonly mail: MailDeliveryService,
  ) {}

  build() {
    return this.inngest.createFunction(
      {
        id: 'send-password-reset-email',
        name: 'Send password reset email',
        triggers: [passwordResetRequested],

        /**
         * Collapses duplicate *events* for 24h.
         *
         * Keyed on the reset URL because the URL carries the token, and the
         * token is what makes one reset distinct from another. A retried or
         * double-submitted `POST /users/:id/password-reset` for the same token
         * sends one email; a genuine second reset mints a new token, produces a
         * new URL, and correctly sends again — which it must, since re-issuing
         * is the owner's only recovery when the first link goes astray.
         */
        idempotency: 'event.data.resetUrl',

        /** Same reasoning as the invite: enough to ride out a Resend blip. */
        retries: 4,

        /** Resend's default account limit is 2 requests/second. */
        concurrency: { limit: 5 },
      },
      ({ event, step }) => this.handle(event, step),
    );
  }

  /**
   * The handler body, lifted out of `createFunction` so a test can call it with
   * an inline `step` instead of standing up a real Inngest server.
   */
  async handle(
    event: { id?: string; name: string; data: PasswordResetRequestedData },
    step: StepLike,
  ): Promise<{ providerMessageId: string }> {
    const context = {
      eventId: event.id ?? '',
      eventType: event.name,
      agencyId: event.data.agencyId,
      branchId: event.data.branchId,
    };

    // Two steps, deliberately — `step.run` memoizes on success, so a crash
    // between them replays the send's stored result and writes only the record.
    // Collapsed into one, a crash after the send would re-send the email, which
    // for a reset means a second live credential in the recipient's inbox.
    //
    // The cast is sound for the same reason it is in the invite function: a
    // step result is serialised to JSON and back, so Inngest types `step.run`
    // as `Jsonify<T>`, and `SentEmail` is entirely strings.
    const sent = (await step.run('send', () =>
      this.mail.send('passwordReset', event.data, event.data.resetUrl),
    )) as SentEmail;

    await step.run('record', () => this.mail.record(context, sent));

    return { providerMessageId: sent.providerMessageId };
  }
}

/**
 * The slice of Inngest's step tooling this handler uses. Narrow on purpose: it
 * is the seam a test substitutes.
 */
interface StepLike {
  // Returns `unknown` rather than `T` because Inngest returns `Jsonify<T>` —
  // see the note at the call site.
  run<T>(id: string, fn: () => Promise<T> | T): Promise<unknown>;
}
