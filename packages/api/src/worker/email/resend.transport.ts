import { Injectable, Logger } from '@nestjs/common';
import { NonRetriableError } from 'inngest';
import { Resend } from 'resend';
import {
  MailTransport,
  type OutboundMessage,
  type SendResult,
} from './mail-transport';

/**
 * Resend error codes that will never succeed on retry.
 *
 * Everything not listed here is treated as transient and rethrown as an
 * ordinary error so Inngest backs off and tries again. Getting this list wrong
 * in the *safe* direction costs a few wasted retries; getting it wrong the other
 * way silently drops a real email, which is why the default is to retry.
 */
const PERMANENT_ERROR_CODES = new Set([
  'validation_error',
  'invalid_from_address',
  'invalid_attachment',
  'invalid_parameter',
  'invalid_region',
  'missing_required_field',
  'invalid_idempotency_key',
  // Key problems are permanent for *this* run: retrying a bad key four more
  // times just delays the alert. They surface loudly in the run's failure.
  'missing_api_key',
  'invalid_api_key',
  'restricted_api_key',
  'not_found',
  'method_not_allowed',
]);

@Injectable()
export class ResendTransport extends MailTransport {
  private readonly logger = new Logger(ResendTransport.name);

  constructor(private readonly resend: Resend) {
    super();
  }

  async send(
    message: OutboundMessage,
    idempotencyKey: string,
  ): Promise<SendResult> {
    // ⚠ The Resend SDK does NOT throw on an API error — it resolves with
    // `{ data: null, error }`. An `await` with no check therefore looks like a
    // successful send and records a delivery that never happened. Every branch
    // below exists because of that.
    const { data, error } = await this.resend.emails.send(
      {
        from: message.from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(message.replyTo ? { replyTo: message.replyTo } : {}),
      },
      // Second idempotency layer. Inngest's `step.run` memoization already
      // prevents a re-send when a *step* completed; this covers the narrower
      // case it cannot see — the request reached Resend but the response was
      // lost, so the step is retried having genuinely sent the mail.
      { idempotencyKey },
    );

    if (error) {
      const detail = `${error.name} (${error.statusCode ?? 'no status'}): ${error.message}`;

      if (PERMANENT_ERROR_CODES.has(error.name)) {
        // NonRetriableError tells Inngest to fail the run now rather than
        // spend four more attempts on a condition that cannot improve.
        throw new NonRetriableError(`Resend rejected the message — ${detail}`);
      }

      // Transient: rate limits, quota, 5xx. A plain throw is what makes Inngest
      // retry with exponential backoff.
      this.logger.warn(`Resend send failed, will retry — ${detail}`);
      throw new Error(`Resend send failed — ${detail}`);
    }

    if (!data?.id) {
      // Shouldn't happen, but a success with no id means we cannot correlate
      // the delivery webhook later — better to fail loudly than to record a
      // message we can never match.
      throw new Error('Resend returned success with no message id.');
    }

    return { providerMessageId: data.id };
  }
}
