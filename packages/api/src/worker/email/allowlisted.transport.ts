import { Logger } from '@nestjs/common';
import {
  MailTransport,
  type OutboundMessage,
  type SendResult,
} from './mail-transport';

/**
 * Parse `MAIL_DEV_ALLOWED_RECIPIENTS`: a comma-separated list of addresses
 * (`pat@example.com`) and domain suffixes (`@example.com`), case-insensitive.
 */
export function parseRecipientAllowlist(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

/** Whether `to` is one of the listed addresses, or on one of the listed domains. */
export function recipientAllowed(
  to: string,
  allowed: readonly string[],
): boolean {
  const address = to.trim().toLowerCase();
  return allowed.some((entry) =>
    entry.startsWith('@') ? address.endsWith(entry) : address === entry,
  );
}

/**
 * A real transport that only reaches the people you said it may.
 *
 * Exists for every environment that is not production and has a live
 * `RESEND_API_KEY` in its `.env`: the PR3 Bruno run against a local stack
 * mailed two real platform admins, because the only thing standing between a
 * developer's database and a real inbox was the presence of a key. Outside
 * production the provider wraps Resend in this; a message to anyone not on
 * `MAIL_DEV_ALLOWED_RECIPIENTS` goes to the logging transport instead, with
 * a warning naming the address, so the developer still sees the mail — in
 * the console, where a local mail belongs.
 *
 * Never selected in production. See `mail-transport.provider.ts`.
 */
export class AllowlistedMailTransport extends MailTransport {
  private readonly logger = new Logger(AllowlistedMailTransport.name);

  constructor(
    private readonly real: MailTransport,
    private readonly fallback: MailTransport,
    private readonly allowed: readonly string[],
  ) {
    super();
  }

  send(message: OutboundMessage, idempotencyKey: string): Promise<SendResult> {
    if (recipientAllowed(message.to, this.allowed)) {
      return this.real.send(message, idempotencyKey);
    }
    this.logger.warn(
      `Not sending to ${message.to}: not on MAIL_DEV_ALLOWED_RECIPIENTS. Logged instead.`,
    );
    return this.fallback.send(message, idempotencyKey);
  }
}
